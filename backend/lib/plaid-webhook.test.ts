/**
 * F2 regression — Plaid webhook signature verification.
 *
 * No Plaid credentials are needed or used: a P-256 key pair is generated here
 * and handed to the verifier through its injectable `fetchKey` seam, so these
 * tests exercise the real ES256 verification, the real body-hash binding and
 * the real replay window against tokens this file signs itself.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHash, generateKeyPairSync, sign as signWith } from "crypto";

const webhookVerificationKeyGet = vi.fn();
vi.mock("@/lib/plaid", () => ({
  plaidClient: { webhookVerificationKeyGet: (...a: unknown[]) => webhookVerificationKeyGet(...a) },
}));

import {
  verifyPlaidWebhook,
  fetchPlaidVerificationKey,
  clearPlaidKeyCacheForTests,
  plaidKeyCacheSizeForTests,
  plaidVerifiedKeyCountForTests,
  isPlausiblePlaidKid,
  PLAID_VERIFIED_KEY_TTL_MS,
  type PlaidVerificationJwk,
} from "./plaid-webhook";

const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const jwk = publicKey.export({ format: "jwk" }) as unknown as PlaidVerificationJwk;

const KID = "test-kid";
const fetchKey = vi.fn(async (kid: string) => (kid === KID ? jwk : null));

function b64url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/**
 * Builds a token the way Plaid does. `overrides` lets each test break exactly
 * one property, so a failure names the property that stopped being checked.
 */
function makeToken(opts: {
  body: string;
  iat?: number;
  kid?: string;
  alg?: string;
  bodyHash?: string;
  tamperSignature?: boolean;
  omitClaim?: "iat" | "request_body_sha256";
}): string {
  const header = { alg: opts.alg ?? "ES256", kid: opts.kid ?? KID, typ: "JWT" };
  const payload: Record<string, unknown> = {
    iat: opts.iat ?? Math.floor(Date.now() / 1000),
    request_body_sha256: opts.bodyHash ?? sha256Hex(opts.body),
  };
  if (opts.omitClaim) delete payload[opts.omitClaim];

  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const signature = signWith("sha256", Buffer.from(signingInput, "utf8"), {
    key: privateKey,
    dsaEncoding: "ieee-p1363",
  });
  if (opts.tamperSignature) signature[0] ^= 0xff;

  return `${signingInput}.${b64url(signature)}`;
}

const BODY = JSON.stringify({
  webhook_type: "TRANSACTIONS",
  webhook_code: "ITEM_LOGIN_REQUIRED",
  item_id: "item-123",
});

describe("verifyPlaidWebhook", () => {
  it("accepts a correctly signed token whose hash matches the body", async () => {
    const result = await verifyPlaidWebhook({
      header: makeToken({ body: BODY }),
      rawBody: BODY,
      fetchKey,
    });
    expect(result.ok).toBe(true);
  });

  it("rejects a missing Plaid-Verification header", async () => {
    const result = await verifyPlaidWebhook({ header: null, rawBody: BODY, fetchKey });
    expect(result).toEqual({ ok: false, error: "Missing Plaid-Verification header" });
  });

  it("rejects a token that is not three segments", async () => {
    const result = await verifyPlaidWebhook({ header: "not.a-jwt", rawBody: BODY, fetchKey });
    expect(result).toEqual({ ok: false, error: "Malformed Plaid-Verification token" });
  });

  it("rejects a tampered signature", async () => {
    const result = await verifyPlaidWebhook({
      header: makeToken({ body: BODY, tamperSignature: true }),
      rawBody: BODY,
      fetchKey,
    });
    expect(result).toEqual({ ok: false, error: "Invalid webhook signature" });
  });

  it("rejects a token signed by a different key", async () => {
    const other = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const header = b64url(JSON.stringify({ alg: "ES256", kid: KID, typ: "JWT" }));
    const payload = b64url(
      JSON.stringify({ iat: Math.floor(Date.now() / 1000), request_body_sha256: sha256Hex(BODY) })
    );
    const sig = signWith("sha256", Buffer.from(`${header}.${payload}`, "utf8"), {
      key: other.privateKey,
      dsaEncoding: "ieee-p1363",
    });

    const result = await verifyPlaidWebhook({
      header: `${header}.${payload}.${b64url(sig)}`,
      rawBody: BODY,
      fetchKey,
    });
    expect(result).toEqual({ ok: false, error: "Invalid webhook signature" });
  });

  it("rejects a body that does not match the request_body_sha256 claim", async () => {
    // The exact replay this claim exists to stop: a genuine token, a swapped body.
    const tamperedBody = JSON.stringify({
      webhook_type: "TRANSACTIONS",
      webhook_code: "ITEM_LOGIN_REQUIRED",
      item_id: "someone-elses-item",
    });
    const result = await verifyPlaidWebhook({
      header: makeToken({ body: BODY }),
      rawBody: tamperedBody,
      fetchKey,
    });
    expect(result).toEqual({ ok: false, error: "Body does not match token hash" });
  });

  it("rejects an unknown key id", async () => {
    const result = await verifyPlaidWebhook({
      header: makeToken({ body: BODY, kid: "no-such-kid" }),
      rawBody: BODY,
      fetchKey,
    });
    expect(result).toEqual({ ok: false, error: "Unknown verification key" });
  });

  it("rejects a token with no key id", async () => {
    const header = b64url(JSON.stringify({ alg: "ES256", typ: "JWT" }));
    const payload = b64url(JSON.stringify({ iat: 1, request_body_sha256: sha256Hex(BODY) }));
    const result = await verifyPlaidWebhook({
      header: `${header}.${payload}.${b64url("sig")}`,
      rawBody: BODY,
      fetchKey,
    });
    expect(result).toEqual({ ok: false, error: "Token has no key id" });
  });

  it("rejects alg: none — the algorithm is pinned, not read from the token", async () => {
    const header = b64url(JSON.stringify({ alg: "none", kid: KID, typ: "JWT" }));
    const payload = b64url(
      JSON.stringify({ iat: Math.floor(Date.now() / 1000), request_body_sha256: sha256Hex(BODY) })
    );
    const result = await verifyPlaidWebhook({
      header: `${header}.${payload}.`,
      rawBody: BODY,
      fetchKey,
    });
    expect(result).toEqual({ ok: false, error: "Unsupported token algorithm" });
  });

  it("rejects HS256 so the public key cannot be used as an HMAC secret", async () => {
    const result = await verifyPlaidWebhook({
      header: makeToken({ body: BODY, alg: "HS256" }),
      rawBody: BODY,
      fetchKey,
    });
    expect(result).toEqual({ ok: false, error: "Unsupported token algorithm" });
  });

  it("rejects a token older than the replay window", async () => {
    const iat = Math.floor(Date.now() / 1000) - 600;
    const result = await verifyPlaidWebhook({
      header: makeToken({ body: BODY, iat }),
      rawBody: BODY,
      fetchKey,
    });
    expect(result).toEqual({ ok: false, error: "Token has expired" });
  });

  it("accepts a token inside the replay window", async () => {
    const iat = Math.floor(Date.now() / 1000) - 60;
    const result = await verifyPlaidWebhook({
      header: makeToken({ body: BODY, iat }),
      rawBody: BODY,
      fetchKey,
    });
    expect(result.ok).toBe(true);
  });

  it("rejects a token with no iat claim", async () => {
    const result = await verifyPlaidWebhook({
      header: makeToken({ body: BODY, omitClaim: "iat" }),
      rawBody: BODY,
      fetchKey,
    });
    expect(result).toEqual({ ok: false, error: "Token has no issued-at claim" });
  });

  it("rejects a token with no body-hash claim", async () => {
    const result = await verifyPlaidWebhook({
      header: makeToken({ body: BODY, omitClaim: "request_body_sha256" }),
      rawBody: BODY,
      fetchKey,
    });
    expect(result).toEqual({ ok: false, error: "Token has no body hash claim" });
  });

  it("rejects a rotated-out key even when the signature checks", async () => {
    const expiredKeyFetcher = async () => ({ ...jwk, expired_at: 1_700_000_000 });
    const result = await verifyPlaidWebhook({
      header: makeToken({ body: BODY }),
      rawBody: BODY,
      fetchKey: expiredKeyFetcher,
    });
    expect(result).toEqual({ ok: false, error: "Verification key has expired" });
  });

  it("binds to the exact bytes received, not to equivalent JSON", async () => {
    // Re-serializing the body before hashing would make this pass — it must not.
    const reserialized = JSON.stringify(JSON.parse(BODY), null, 2);
    const result = await verifyPlaidWebhook({
      header: makeToken({ body: BODY }),
      rawBody: reserialized,
      fetchKey,
    });
    expect(result).toEqual({ ok: false, error: "Body does not match token hash" });
  });

  it("rejects a token dated in the future, so the replay window is two-sided", async () => {
    const iat = Math.floor(Date.now() / 1000) + 86_400;
    const result = await verifyPlaidWebhook({
      header: makeToken({ body: BODY, iat }),
      rawBody: BODY,
      fetchKey,
    });
    expect(result).toEqual({ ok: false, error: "Token is dated in the future" });
  });

  it("tolerates clock skew of a few seconds", async () => {
    const iat = Math.floor(Date.now() / 1000) + 5;
    const result = await verifyPlaidWebhook({
      header: makeToken({ body: BODY, iat }),
      rawBody: BODY,
      fetchKey,
    });
    expect(result.ok).toBe(true);
  });
});

describe("verifyPlaidWebhook — key-id shape gate", () => {
  it("accepts the shape a real Plaid key id has", () => {
    expect(isPlausiblePlaidKid("6c5516e1-92dc-479e-a8ff-5a51992e0001")).toBe(true);
  });

  it.each([
    ["an over-long kid", "a".repeat(65)],
    ["a kid carrying separators", "abc/../def"],
    ["a kid carrying whitespace", "abc def"],
    ["a kid carrying newlines", "abc\ndef"],
  ])("rejects %s", (_label, kid) => {
    expect(isPlausiblePlaidKid(kid)).toBe(false);
  });

  it("rejects an implausible kid before the fetcher is ever called", async () => {
    const spy = vi.fn(async () => jwk);
    const result = await verifyPlaidWebhook({
      header: makeToken({ body: BODY, kid: "x".repeat(4096) }),
      rawBody: BODY,
      fetchKey: spy,
    });
    expect(result).toEqual({ ok: false, error: "Token has an implausible key id" });
    expect(spy).not.toHaveBeenCalled();
  });
});

/**
 * The cache is reachable by unauthenticated callers who choose both the key and
 * its length, so growth and outbound amplification are what these cover.
 */
describe("fetchPlaidVerificationKey — cache and lookup bounds", () => {
  beforeEach(() => {
    clearPlaidKeyCacheForTests();
    webhookVerificationKeyGet.mockReset();
    webhookVerificationKeyGet.mockResolvedValue({ data: { key: jwk } });
  });

  afterEach(() => {
    vi.useRealTimers();
    clearPlaidKeyCacheForTests();
  });

  it("never calls Plaid for an implausible kid", async () => {
    await expect(fetchPlaidVerificationKey("y".repeat(4096))).resolves.toBeNull();
    expect(webhookVerificationKeyGet).not.toHaveBeenCalled();
    expect(plaidKeyCacheSizeForTests()).toBe(0);
  });

  it("serves a repeated kid from cache instead of re-fetching", async () => {
    await fetchPlaidVerificationKey(KID);
    await fetchPlaidVerificationKey(KID);
    expect(webhookVerificationKeyGet).toHaveBeenCalledTimes(1);
  });

  it("caps outbound lookups across a flood of UNIQUE kids", async () => {
    for (let i = 0; i < 200; i += 1) await fetchPlaidVerificationKey(`bogus-kid-${i}`);
    expect(webhookVerificationKeyGet.mock.calls.length).toBeLessThanOrEqual(20);
  });

  it("keeps the cache bounded across many windows of unique kids", async () => {
    vi.useFakeTimers();
    for (let window = 0; window < 20; window += 1) {
      for (let i = 0; i < 20; i += 1) {
        await fetchPlaidVerificationKey(`kid-${window}-${i}`);
      }
      await vi.advanceTimersByTimeAsync(61_000);
    }
    expect(plaidKeyCacheSizeForTests()).toBeLessThanOrEqual(32);
  });
});

/**
 * The availability half of F2: a caller who can only choose kids must not be
 * able to reach a key that has actually verified a webhook — not evict it, not
 * starve its refresh — and a key Plaid has retired must stop verifying promptly.
 */
describe("plaid key stores — verified keys are isolated from speculative floods", () => {
  /** Only KID resolves; every other kid gets a JWK the importer will reject. */
  function keyServer() {
    webhookVerificationKeyGet.mockImplementation(async (req: unknown) => {
      const keyId = (req as { key_id: string }).key_id;
      return { data: { key: keyId === KID ? jwk : {} } };
    });
  }

  function callsForKid(kid: string): number {
    return webhookVerificationKeyGet.mock.calls.filter(
      (call) => (call[0] as { key_id: string }).key_id === kid
    ).length;
  }

  beforeEach(() => {
    clearPlaidKeyCacheForTests();
    webhookVerificationKeyGet.mockReset();
    keyServer();
  });

  afterEach(() => {
    vi.useRealTimers();
    clearPlaidKeyCacheForTests();
  });

  it("survives a sustained flood of fresh kids spanning the verified TTL", async () => {
    vi.useFakeTimers();

    // A real webhook first — the ONLY way a key enters the verified store.
    const first = await verifyPlaidWebhook({ header: makeToken({ body: BODY }), rawBody: BODY });
    expect(first.ok).toBe(true);
    expect(plaidVerifiedKeyCountForTests()).toBe(1);

    // Twelve minutes of unique bogus kids, refilling and re-spending the
    // speculative budget every window, and running past the verified TTL.
    for (let window = 0; window < 12; window += 1) {
      for (let i = 0; i < 30; i += 1) {
        const bogus = await verifyPlaidWebhook({
          header: makeToken({ body: BODY, kid: `flood-${window}-${i}` }),
          rawBody: BODY,
        });
        expect(bogus).toEqual({ ok: false, error: "Unknown verification key" });
      }
      if (window < 11) await vi.advanceTimersByTimeAsync(61_000);
    }

    // No advance since the last burst: the speculative budget is spent right
    // now, and the verified key is past its TTL so it needs a refresh.
    expect(plaidVerifiedKeyCountForTests()).toBe(1);
    const after = await verifyPlaidWebhook({ header: makeToken({ body: BODY }), rawBody: BODY });
    expect(after.ok).toBe(true);

    // One initial lookup plus exactly one refresh — never starved, never delayed
    // into a rejection by the flood that ran alongside it.
    expect(callsForKid(KID)).toBe(2);
  });

  it("stops verifying once Plaid reports the key retired on re-fetch", async () => {
    vi.useFakeTimers();

    const before = await verifyPlaidWebhook({ header: makeToken({ body: BODY }), rawBody: BODY });
    expect(before.ok).toBe(true);

    // Retired at Plaid AFTER it was cached: only a re-fetch can see this.
    webhookVerificationKeyGet.mockResolvedValue({
      data: { key: { ...jwk, expired_at: 1_700_000_000 } },
    });

    // Still inside the freshness bound — the cached copy is used, as designed.
    await vi.advanceTimersByTimeAsync(PLAID_VERIFIED_KEY_TTL_MS - 1_000);
    const stillCached = await verifyPlaidWebhook({
      header: makeToken({ body: BODY }),
      rawBody: BODY,
    });
    expect(stillCached.ok).toBe(true);

    await vi.advanceTimersByTimeAsync(2_000);
    const retired = await verifyPlaidWebhook({ header: makeToken({ body: BODY }), rawBody: BODY });
    expect(retired).toEqual({ ok: false, error: "Verification key has expired" });
    expect(callsForKid(KID)).toBe(2);
  });
});
