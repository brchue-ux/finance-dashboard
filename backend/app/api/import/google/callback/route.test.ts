/**
 * F1 regression — reflected XSS in the Google OAuth callback.
 *
 * Same defect and same fix as the Excel callback. This route sits behind
 * requireUser, which is stubbed here so the test exercises the reflection path
 * rather than the auth guard.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth-guard", () => ({
  requireUser: vi.fn(async () => ({ userId: "user-1" })),
}));

const { GET } = await import("./route");

const PAYLOAD = "<script>alert(document.domain)</script>";

function callbackRequest(query: string): NextRequest {
  return new NextRequest(`http://localhost:3021/api/import/google/callback?${query}`);
}

describe("GET /api/import/google/callback — error parameter", () => {
  it("does not reflect a script payload into the response body", async () => {
    const res = await GET(callbackRequest(`error=${encodeURIComponent(PAYLOAD)}`));
    const body = await res.text();

    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(body).not.toContain(PAYLOAD);
    expect(body).not.toContain("alert(document.domain)");
    expect(body).not.toContain("&lt;script&gt;");
    expect(body).toContain("Google authorization was cancelled.");
  });

  it("leaves only the page's own auto-close script in the output", async () => {
    const res = await GET(callbackRequest(`error=${encodeURIComponent(PAYLOAD)}`));
    const body = await res.text();
    expect(body.match(/<script/g)).toHaveLength(1);
  });
});

describe("GET /api/import/google/callback — error logging", () => {
  afterEach(() => vi.restoreAllMocks());

  it("logs the provider's error server-side, sanitized, and never in the body", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await GET(callbackRequest(`error=${encodeURIComponent("a\r\ndenied")}`));
    const logged = warn.mock.calls[0][0] as string;
    expect(logged).toContain("denied");
    expect(logged).not.toMatch(/[\r\n]/);
    expect(await res.text()).not.toContain("denied");
  });

  it("length-caps the logged value", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await GET(callbackRequest(`error=${"z".repeat(5000)}`));
    expect((warn.mock.calls[0][0] as string).length).toBeLessThan(300);
  });
});

describe("GET /api/import/google/callback — state handling", () => {
  it("returns 400 when code and state are absent", async () => {
    const res = await GET(callbackRequest(""));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "Missing code or state" });
  });

  it("returns 400 when the state cookie does not match", async () => {
    const res = await GET(callbackRequest("code=abc&state=mismatched"));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "Invalid OAuth state" });
  });
});
