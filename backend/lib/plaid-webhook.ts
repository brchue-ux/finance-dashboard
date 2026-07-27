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
 *      Keys are looked up per `kid` and cached; Plaid rotates them. The `kid` is
 *      attacker-controlled and is read BEFORE anything is verified, so it is
 *      shape-checked first and both the cache and the outbound lookup rate are
 *      bounded — otherwise a flood of unique bogus kids would grow the cache
 *      without limit and amplify into Plaid's API.
 *   3. The signature is verified against that key.
 *   4. `iat` must be recent AND not meaningfully in the future, so the replay
 *      window is bounded on both sides.
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

/**
 * The other half of the window: a token dated in the future would otherwise
 * satisfy the max-age check forever. Only clock skew is allowed for.
 */
const MAX_TOKEN_SKEW_SECONDS = 60;

/**
 * Plaid key ids are short opaque tokens. Anything outside this shape cannot be
 * a real kid, so it is rejected before it is ever used as a cache key or sent
 * upstream — that is what keeps an unauthenticated caller from choosing both
 * the key and the length of a cache entry.
 */
const KID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export function isPlausiblePlaidKid(kid: string): boolean {
  return KID_PATTERN.test(kid);
}

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
 * That TTL is per-kid, so it only rate-limits repeats of the SAME kid; the
 * cache cap and the cross-kid lookup budget below are what bound a flood of
 * UNIQUE ones, which is the shape an unauthenticated caller actually controls.
 */
const KEY_TTL_MS = 24 * 60 * 60 * 1000;
const NEGATIVE_TTL_MS = 60 * 1000;

/** Only a handful of real Plaid keys ever exist; anything past this is noise. */
const MAX_CACHE_ENTRIES = 32;

/** Cross-kid ceiling on outbound `/webhook_verification_key/get` calls. */
const LOOKUP_WINDOW_MS = 60 * 1000;
const MAX_LOOKUPS_PER_WINDOW = 20;

interface CacheEntry {
  key: PlaidVerificationJwk | null;
  expiresAt: number;
}

const keyCache = new Map<string, CacheEntry>();

let lookupWindowStart = 0;
let lookupsInWindow = 0;

/** Exported for tests; production code never needs to clear the cache. */
export function clearPlaidKeyCacheForTests(): void {
  keyCache.clear();
  lookupWindowStart = 0;
  lookupsInWindow = 0;
}

/** Exported for tests so the cache cap is assertable without internals. */
export function plaidKeyCacheSizeForTests(): number {
  return keyCache.size;
}

/**
 * Insertion order is eviction order, and a re-set moves an entry to the back,
 * so the cap behaves as an LRU over a set that is only ever a few keys deep in
 * real use.
 */
function rememberKey(kid: string, entry: CacheEntry): void {
  const now = Date.now();
  for (const [cachedKid, cached] of keyCache) {
    if (cached.expiresAt <= now) keyCache.delete(cachedKid);
  }
  keyCache.delete(kid);
  keyCache.set(kid, entry);
  while (keyCache.size > MAX_CACHE_ENTRIES) {
    const oldest = keyCache.keys().next();
    if (oldest.done) break;
    keyCache.delete(oldest.value);
  }
}

/** False once the window's budget is spent, so the caller fails closed. */
function claimLookupBudget(): boolean {
  const now = Date.now();
  if (now - lookupWindowStart >= LOOKUP_WINDOW_MS) {
    lookupWindowStart = now;
    lookupsInWindow = 0;
  }
  if (lookupsInWindow >= MAX_LOOKUPS_PER_WINDOW) return false;
  lookupsInWindow += 1;
  return true;
}

/**
 * The real fetcher: `/webhook_verification_key/get`, memoized per `kid`.
 * A network/credential failure returns null, which the verifier turns into a
 * rejection — failing closed is correct for a write path.
 */
export const fetchPlaidVerificationKey: PlaidKeyFetcher = async (kid) => {
  if (!isPlausiblePlaidKid(kid)) return null;

  const cached = keyCache.get(kid);
  if (cached && cached.expiresAt > Date.now()) {
    keyCache.delete(kid);
    keyCache.set(kid, cached);
    return cached.key;
  }

  if (!claimLookupBudget()) {
    console.warn("[plaid-webhook] verification key lookup budget exhausted; rejecting");
    return null;
  }

  let key: PlaidVerificationJwk | null = null;
  try {
    const res = await plaidClient.webhookVerificationKeyGet({ key_id: kid });
    const jwk = res.data.key as unknown as PlaidVerificationJwk | undefined;
    if (jwk && jwk.kty && jwk.crv && jwk.x && jwk.y) key = jwk;
  } catch (err) {
    console.error(`[plaid-webhook] verification key lookup failed for kid ${kid}:`, err);
    key = null;
  }

  rememberKey(kid, {
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
  maxSkewSeconds?: number;
}): Promise<PlaidWebhookVerification> {
  const {
    header,
    rawBody,
    fetchKey = fetchPlaidVerificationKey,
    now = Math.floor(Date.now() / 1000),
    maxAgeSeconds = MAX_TOKEN_AGE_SECONDS,
    maxSkewSeconds = MAX_TOKEN_SKEW_SECONDS,
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
  // Gated here, not only in the fetcher, so no injected seam can be handed an
  // unbounded attacker-chosen string either.
  if (!isPlausiblePlaidKid(kid)) return { ok: false, error: "Token has an implausible key id" };

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
  if (iat - now > maxSkewSeconds) return { ok: false, error: "Token is dated in the future" };

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
