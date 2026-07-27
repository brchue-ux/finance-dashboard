/**
 * F1 regression. The escaping lives in the shared helper precisely so that a
 * future caller who *does* interpolate untrusted text still cannot produce an
 * executable response — these tests pin that property at the helper, and the
 * route tests pin that the OAuth callbacks no longer reflect at all.
 */
import { describe, it, expect } from "vitest";
import { escapeHtml, closePageHtml, closePage } from "./close-page";

const PAYLOAD = "<script>alert(document.domain)</script>";

describe("escapeHtml", () => {
  it("escapes all five HTML-significant characters", () => {
    expect(escapeHtml(`<>&"'`)).toBe("&lt;&gt;&amp;&quot;&#39;");
  });

  it("escapes & first so replacements are not double-encoded", () => {
    expect(escapeHtml("&lt;")).toBe("&amp;lt;");
  });

  it("neutralises a script payload", () => {
    const out = escapeHtml(PAYLOAD);
    expect(out).not.toContain("<script");
    expect(out).toBe("&lt;script&gt;alert(document.domain)&lt;/script&gt;");
  });
});

describe("closePageHtml", () => {
  it("cannot be made to emit caller-supplied markup in the message", () => {
    const html = closePageHtml("Excel connected", PAYLOAD);
    expect(html).not.toContain(PAYLOAD);
    expect(html).toContain("&lt;script&gt;alert(document.domain)&lt;/script&gt;");
  });

  it("escapes the title as well as the message", () => {
    const html = closePageHtml(PAYLOAD, "ok");
    expect(html).not.toContain(PAYLOAD);
    expect(html).toContain("<title>&lt;script&gt;");
  });

  it("still emits exactly one real script tag — its own auto-close", () => {
    const html = closePageHtml("t", PAYLOAD);
    expect(html.match(/<script/g)).toHaveLength(1);
    expect(html).toContain("setTimeout(()=>window.close(),1500)");
  });
});

describe("closePage", () => {
  it("returns an HTML response with the escaped body", async () => {
    const res = closePage("Excel connected", PAYLOAD);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    await expect(res.text()).resolves.not.toContain(PAYLOAD);
  });
});
