/**
 * Plaid webhook verification.
 *
 * Plaid's webhook endpoint is necessarily unauthenticated — it has no session
 * and no shared secret — so the JWT in the `Plaid-Verification` header is the
 * ONLY thing separating a real Plaid event from anyone who can reach the host.
 * Without it, one unauthenticated POST can flip a bank connection to
 * `relink_required` and persistently break a user's sync.
 *
 * The flow is Plaid's documented one, and every step is load-bearing:
 *
 *   1. The header is a JWS. Its `alg` MUST be pinned to ES256 — accepting the
 *      algorithm the token names is the classic JWT confusion bug (`none`, or
 *      HS256 verified against the public key as an HMAC secret).
 *   2. The `kid` names a key fetched from `/webhook_verification_key/get`.
 *      Keys are looked up per `kid` and cached; Plaid rotates them.
 *   3. The signature is verified against that key.
 *   4. `iat` must be recent, so a captured webhook cannot be replayed forever.
 *   5. The body's SHA-256 must equal the `request_body_sha256` claim. Steps 1-4
 *      only prove the *token* is Plaid's; this is what binds it to THIS body.
 *      Skipping it would let an attacker replay a genuine token with a
 *      substituted payload.
 *
 * `fetchKey` is injectable so the whole verifier is unit-testable against a
 * locally generated P-256 key pair, with no Plaid credentials involved.
 */
import { createHash, createPublicKey, timingSafeEqual, verify as verifySignature } from "crypto";
import { plaidClient } from "@/lib/plaid";

/** The subset of Plaid's verification-key JWK that Node needs to import it. */
export interface PlaidVerificationJwk {
  kty: string;
  crv: string;
  x: string;
  y: string;
  /** Plaid marks rotated-out keys with an expiry; an expired key must not verify. */
  expired_at?: number | null;
}

export type PlaidKeyFetcher = (kid: string) => Promise<PlaidVerificationJwk | null>;

export interface PlaidWebhookClaims {
  iat: number;
  request_body_sha256: string;
}

export type PlaidWebhookVerification =
  | { ok: true; claims: PlaidWebhookClaims }
  | { ok: false; error: string };

/**
 * Plaid's guidance is to reject tokens older than five minutes. This is what
 * bounds the replay window once a token has been observed in transit.
 */
const MAX_TOKEN_AGE_SECONDS = 5 * 60;

function decodeBase64Url(segment: string): Buffer {
  return Buffer.from(segment, "base64url");
}

function parseJsonSegment(segment: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(decodeBase64Url(segment).toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Equal-length hex compare that does not leak how far it matched. */
function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * Key cache. Plaid signs with one of a small rotating set of keys, so fetching
 * per request would add a round trip to every webhook and put the endpoint's
 * availability at the mercy of Plaid's own API latency.
 *
 * Failures get a short negative TTL of their own: without it, a flood of
 * requests bearing a bogus `kid` would turn into a flood of outbound calls.
 */
const KEY_TTL_MS = 24 * 60 * 60 * 1000;
const NEGATIVE_TTL_MS = 60 * 1000;

interface CacheEntry {
  key: PlaidVerificationJwk | null;
  expiresAt: number;
}

const keyCache = new Map<string, CacheEntry>();

/** Exported for tests; production code never needs to clear the cache. */
export function clearPlaidKeyCacheForTests(): void {
  keyCache.clear();
}

/**
 * The real fetcher: `/webhook_verification_key/get`, memoized per `kid`.
 * A network/credential failure returns null, which the verifier turns into a
 * rejection — failing closed is correct for a write path.
 */
export const fetchPlaidVerificationKey: PlaidKeyFetcher = async (kid) => {
  const cached = keyCache.get(kid);
  if (cached && cached.expiresAt > Date.now()) return cached.key;

  let key: PlaidVerificationJwk | null = null;
  try {
    const res = await plaidClient.webhookVerificationKeyGet({ key_id: kid });
    const jwk = res.data.key as unknown as PlaidVerificationJwk | undefined;
    if (jwk && jwk.kty && jwk.crv && jwk.x && jwk.y) key = jwk;
  } catch (err) {
    console.error(`[plaid-webhook] verification key lookup failed for kid ${kid}:`, err);
    key = null;
  }

  keyCache.set(kid, {
    key,
    expiresAt: Date.now() + (key ? KEY_TTL_MS : NEGATIVE_TTL_MS),
  });
  return key;
};

export async function verifyPlaidWebhook(params: {
  /** Raw `Plaid-Verification` header value, or null when absent. */
  header: string | null;
  /** The request body EXACTLY as received — re-serializing would change the hash. */
  rawBody: string;
  fetchKey?: PlaidKeyFetcher;
  /** Unix seconds; injectable so tests can pin token age. */
  now?: number;
  maxAgeSeconds?: number;
}): Promise<PlaidWebhookVerification> {
  const {
    header,
    rawBody,
    fetchKey = fetchPlaidVerificationKey,
    now = Math.floor(Date.now() / 1000),
    maxAgeSeconds = MAX_TOKEN_AGE_SECONDS,
  } = params;

  if (!header) return { ok: false, error: "Missing Plaid-Verification header" };

  const parts = header.split(".");
  if (parts.length !== 3) return { ok: false, error: "Malformed Plaid-Verification token" };
  const [headerSegment, payloadSegment, signatureSegment] = parts;

  const jwtHeader = parseJsonSegment(headerSegment);
  if (!jwtHeader) return { ok: false, error: "Malformed Plaid-Verification token" };

  // Pinned, not read from the token: see the note at the top of this file.
  if (jwtHeader.alg !== "ES256") return { ok: false, error: "Unsupported token algorithm" };
  const kid = jwtHeader.kid;
  if (typeof kid !== "string" || !kid) return { ok: false, error: "Token has no key id" };

  const jwk = await fetchKey(kid);
  if (!jwk) return { ok: false, error: "Unknown verification key" };
  if (jwk.expired_at != null) return { ok: false, error: "Verification key has expired" };

  let publicKey;
  try {
    publicKey = createPublicKey({
      // Only the four fields that define the point — Plaid's JWK carries extra
      // metadata Node's importer does not accept.
      key: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y },
      format: "jwk",
    });
  } catch {
    return { ok: false, error: "Unusable verification key" };
  }

  const signingInput = Buffer.from(`${headerSegment}.${payloadSegment}`, "utf8");
  const signature = decodeBase64Url(signatureSegment);

  let signatureValid = false;
  try {
    signatureValid = verifySignature(
      "sha256",
      signingInput,
      // JWS ES256 signatures are raw r||s, not the DER encoding Node defaults to.
      { key: publicKey, dsaEncoding: "ieee-p1363" },
      signature
    );
  } catch {
    signatureValid = false;
  }
  if (!signatureValid) return { ok: false, error: "Invalid webhook signature" };

  const payload = parseJsonSegment(payloadSegment);
  if (!payload) return { ok: false, error: "Malformed token payload" };

  const iat = payload.iat;
  if (typeof iat !== "number" || !Number.isFinite(iat)) {
    return { ok: false, error: "Token has no issued-at claim" };
  }
  if (now - iat > maxAgeSeconds) return { ok: false, error: "Token has expired" };

  const claimedHash = payload.request_body_sha256;
  if (typeof claimedHash !== "string" || !claimedHash) {
    return { ok: false, error: "Token has no body hash claim" };
  }

  const actualHash = createHash("sha256").update(rawBody, "utf8").digest("hex");
  if (!constantTimeEquals(claimedHash.toLowerCase(), actualHash)) {
    return { ok: false, error: "Body does not match token hash" };
  }

  return { ok: true, claims: { iat, request_body_sha256: claimedHash } };
}
