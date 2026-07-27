/**
 * F1 regression — reflected XSS in the Microsoft OAuth callback.
 *
 * This route is unauthenticated, returns text/html, and lives on the origin
 * that holds the session cookie, so anything it reflects executes with
 * same-origin access to the user's financial data. The `error` query parameter
 * is fully attacker-controlled (it is just a redirect URL someone can hand a
 * victim), so the only safe answer is not to echo it.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";

const PAYLOAD = "<script>alert(document.domain)</script>";

function callbackRequest(query: string): NextRequest {
  return new NextRequest(`http://localhost:3021/api/import/excel/callback?${query}`);
}

describe("GET /api/import/excel/callback — error parameter", () => {
  it("does not reflect a script payload into the response body", async () => {
    const res = await GET(callbackRequest(`error=${encodeURIComponent(PAYLOAD)}`));
    const body = await res.text();

    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(body).not.toContain(PAYLOAD);
    expect(body).not.toContain("alert(document.domain)");
    // Not even in escaped form — the provider's error string is dropped entirely.
    expect(body).not.toContain("&lt;script&gt;");
    expect(body).toContain("Microsoft authorization was cancelled.");
  });

  it("leaves only the page's own auto-close script in the output", async () => {
    const res = await GET(callbackRequest(`error=${encodeURIComponent(PAYLOAD)}`));
    const body = await res.text();
    expect(body.match(/<script/g)).toHaveLength(1);
  });

  it("does not reflect an attribute-breaking payload either", async () => {
    const attr = `" onload="alert(1)`;
    const res = await GET(callbackRequest(`error=${encodeURIComponent(attr)}`));
    const body = await res.text();
    expect(body).not.toContain("onload=");
    expect(body).not.toContain("alert(1)");
  });
});

describe("GET /api/import/excel/callback — error logging", () => {
  afterEach(() => vi.restoreAllMocks());

  it("logs the provider's error server-side so it stays diagnosable", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await GET(callbackRequest("error=access_denied"));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("access_denied"));
  });

  it("strips CR/LF from the logged value so a log line cannot be forged", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await GET(callbackRequest(`error=${encodeURIComponent("a\r\nFAKE LOG LINE")}`));
    const logged = warn.mock.calls[0][0] as string;
    expect(logged).not.toMatch(/[\r\n]/);
    expect(logged).toContain("FAKE LOG LINE");
  });

  it("length-caps the logged value", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await GET(callbackRequest(`error=${"z".repeat(5000)}`));
    const logged = warn.mock.calls[0][0] as string;
    expect(logged.length).toBeLessThan(300);
  });

  it("still keeps the logged value out of the response body", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await GET(callbackRequest("error=access_denied"));
    expect(await res.text()).not.toContain("access_denied");
  });
});

describe("GET /api/import/excel/callback — missing parameters", () => {
  it("returns 400 JSON when code and state are absent", async () => {
    const res = await GET(callbackRequest(""));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "Missing code or state" });
  });
});
