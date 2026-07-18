/**
 * CORS (spec §2 Auth row): credentialed, explicit-origin allowlist — never a
 * wildcard, since cookies are involved. Only the Expo WEB build needs CORS
 * (native isn't a browser). Allowed origins: localhost dev defaults + the
 * comma-separated CORS_ALLOWED_ORIGINS env var (Vercel prod + preview URLs).
 */
import { NextRequest, NextResponse } from "next/server";

const DEV_ORIGINS = [
  "http://localhost:8081", // expo start (web)
  "http://localhost:19006", // legacy expo web port
];

function allowedOrigins(): Set<string> {
  const extra = (process.env.CORS_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  return new Set([...DEV_ORIGINS, ...extra]);
}

function withCorsHeaders(res: NextResponse, origin: string): NextResponse {
  res.headers.set("Access-Control-Allow-Origin", origin);
  res.headers.set("Access-Control-Allow-Credentials", "true");
  res.headers.set("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS");
  res.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.headers.set("Vary", "Origin");
  return res;
}

export function middleware(req: NextRequest) {
  const origin = req.headers.get("origin");
  // Non-browser callers (native app, curl, webhooks) send no Origin — no CORS needed
  if (!origin) return NextResponse.next();
  if (!allowedOrigins().has(origin)) {
    // Disallowed origin: let the browser's CORS enforcement block it by
    // returning the response without CORS headers (don't 403 same-origin tools)
    return NextResponse.next();
  }

  if (req.method === "OPTIONS") {
    return withCorsHeaders(new NextResponse(null, { status: 204 }), origin);
  }
  return withCorsHeaders(NextResponse.next(), origin);
}

export const config = {
  matcher: "/api/:path*",
};
