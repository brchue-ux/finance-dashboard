/**
 * The self-closing HTML page both OAuth callbacks return.
 *
 * Shared for one reason: these are the only routes in the app that answer with
 * `text/html`, and they do it *unauthenticated* on the origin that holds the
 * session cookie. An unescaped value reflected here is a same-origin XSS with
 * the user's whole financial history behind it — the cookie is HttpOnly, but a
 * top-level GET navigation is SameSite=Lax-eligible, so injected script can
 * simply `fetch("/api/budget", { credentials: "include" })`.
 *
 * Escaping therefore lives *inside* the helper rather than at each call site,
 * so a future caller cannot reintroduce the class by forgetting it. Callers
 * pass plain text; this module owns turning it into HTML.
 */
import { NextResponse } from "next/server";

/**
 * Escapes the five characters that can break out of HTML text or an attribute
 * value. `&` must be replaced first or the later replacements would be
 * double-encoded into it.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Renders the page body. Both `title` and `message` are treated as untrusted
 * plain text and escaped — there is no way to pass markup through this.
 */
export function closePageHtml(title: string, message: string): string {
  return (
    `<!doctype html><meta charset="utf-8"><title>${escapeHtml(title)}</title>` +
    `<body style="font-family:system-ui;padding:2rem">${escapeHtml(message)}` +
    `<script>setTimeout(()=>window.close(),1500)</script></body>`
  );
}

export function closePage(title: string, message: string): NextResponse {
  return new NextResponse(closePageHtml(title, message), {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
