/**
 * F2 regression at the route boundary.
 *
 * The proof-of-concept in the review was a single unauthenticated curl that
 * flipped a bank connection to `relink_required`. These tests replay that exact
 * request and assert it is now rejected, then assert a properly signed one
 * still works — so the fix is verified as a gate, not as a wall.
 *
 * Plaid's key endpoint and the database are stubbed; the ES256 verification
 * itself is real.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { createHash, generateKeyPairSync, sign as signWith } from "crypto";

const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const jwk = publicKey.export({ format: "jwk" });
const KID = "route-test-kid";

const webhookVerificationKeyGet = vi.fn(async ({ key_id }: { key_id: string }) => {
  if (key_id !== KID) throw new Error("key not found");
  return { data: { key: jwk } };
});

vi.mock("@/lib/plaid", () => ({
  plaidClient: {
    webhookVerificationKeyGet: (args: { key_id: string }) => webhookVerificationKeyGet(args),
  },
}));

/** Rows the stubbed `select` will return, and every `update` that was applied. */
const state = {
  connections: [] as { id: string }[],
  updates: [] as unknown[],
};

vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({ where: () => ({ limit: async () => state.connections }) }),
    }),
    update: () => ({
      set: (values: unknown) => ({
        where: async () => {
          state.updates.push(values);
        },
      }),
    }),
  },
}));

const { POST } = await import("./route");
const { clearPlaidKeyCacheForTests } = await import("@/lib/plaid-webhook");

function b64url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

function signToken(body: string, kid = KID): string {
  const header = b64url(JSON.stringify({ alg: "ES256", kid, typ: "JWT" }));
  const payload = b64url(
    JSON.stringify({
      iat: Math.floor(Date.now() / 1000),
      request_body_sha256: createHash("sha256").update(body, "utf8").digest("hex"),
    })
  );
  const sig = signWith("sha256", Buffer.from(`${header}.${payload}`, "utf8"), {
    key: privateKey,
    dsaEncoding: "ieee-p1363",
  });
  return `${header}.${payload}.${b64url(sig)}`;
}

function webhookRequest(body: string, verification?: string): NextRequest {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (verification) headers["plaid-verification"] = verification;
  return new NextRequest("http://localhost:3021/api/plaid/webhook", {
    method: "POST",
    headers,
    body,
  });
}

const LOGIN_REQUIRED = JSON.stringify({
  webhook_type: "TRANSACTIONS",
  webhook_code: "ITEM_LOGIN_REQUIRED",
  item_id: "item-known",
});

beforeEach(() => {
  state.connections = [{ id: "conn-1" }];
  state.updates = [];
  clearPlaidKeyCacheForTests();
  webhookVerificationKeyGet.mockClear();
});

describe("POST /api/plaid/webhook", () => {
  it("rejects the review's unauthenticated proof-of-concept with 401", async () => {
    const res = await POST(webhookRequest(LOGIN_REQUIRED));
    expect(res.status).toBe(401);
    expect(state.updates).toEqual([]);
  });

  it("rejects a forged signature with 401 and writes nothing", async () => {
    const other = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const header = b64url(JSON.stringify({ alg: "ES256", kid: KID, typ: "JWT" }));
    const payload = b64url(
      JSON.stringify({
        iat: Math.floor(Date.now() / 1000),
        request_body_sha256: createHash("sha256").update(LOGIN_REQUIRED, "utf8").digest("hex"),
      })
    );
    const sig = signWith("sha256", Buffer.from(`${header}.${payload}`, "utf8"), {
      key: other.privateKey,
      dsaEncoding: "ieee-p1363",
    });

    const res = await POST(
      webhookRequest(LOGIN_REQUIRED, `${header}.${payload}.${b64url(sig)}`)
    );
    expect(res.status).toBe(401);
    expect(state.updates).toEqual([]);
  });

  it("rejects a valid token replayed against a different body with 401", async () => {
    const token = signToken(LOGIN_REQUIRED);
    const swapped = JSON.stringify({
      webhook_type: "TRANSACTIONS",
      webhook_code: "ITEM_LOGIN_REQUIRED",
      item_id: "item-someone-else",
    });

    const res = await POST(webhookRequest(swapped, token));
    expect(res.status).toBe(401);
    expect(state.updates).toEqual([]);
  });

  it("rejects an unknown key id with 401", async () => {
    const res = await POST(webhookRequest(LOGIN_REQUIRED, signToken(LOGIN_REQUIRED, "bogus-kid")));
    expect(res.status).toBe(401);
    expect(state.updates).toEqual([]);
  });

  it("accepts a correctly signed webhook and marks the connection relink_required", async () => {
    const res = await POST(webhookRequest(LOGIN_REQUIRED, signToken(LOGIN_REQUIRED)));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(state.updates).toEqual([{ status: "relink_required" }]);
  });

  it("rejects a signed webhook for an item_id no connection owns", async () => {
    state.connections = [];
    const res = await POST(webhookRequest(LOGIN_REQUIRED, signToken(LOGIN_REQUIRED)));
    expect(res.status).toBe(404);
    expect(state.updates).toEqual([]);
  });

  it("returns 400 for a signed body that is not a JSON object", async () => {
    const body = '"just-a-string"';
    const res = await POST(webhookRequest(body, signToken(body)));
    expect(res.status).toBe(400);
    expect(state.updates).toEqual([]);
  });

  it("returns 400 when a signed body omits the required fields", async () => {
    const body = JSON.stringify({ webhook_type: "TRANSACTIONS" });
    const res = await POST(webhookRequest(body, signToken(body)));
    expect(res.status).toBe(400);
    expect(state.updates).toEqual([]);
  });

  it("caches the verification key instead of fetching it per request", async () => {
    const token = signToken(LOGIN_REQUIRED);
    await POST(webhookRequest(LOGIN_REQUIRED, token));
    await POST(webhookRequest(LOGIN_REQUIRED, token));
    expect(webhookVerificationKeyGet).toHaveBeenCalledTimes(1);
  });

  it("leaves a signed SYNC_UPDATES_AVAILABLE event as a no-op write", async () => {
    const body = JSON.stringify({
      webhook_type: "TRANSACTIONS",
      webhook_code: "SYNC_UPDATES_AVAILABLE",
      item_id: "item-known",
    });
    const res = await POST(webhookRequest(body, signToken(body)));
    expect(res.status).toBe(200);
    expect(state.updates).toEqual([]);
  });
});
