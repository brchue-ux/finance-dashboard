/**
 * GET /api/import/google/start — begin the Google Sheets OAuth flow. Redirects
 * the browser to Google's consent screen. A random state is stored in an
 * httpOnly cookie and checked on callback (CSRF guard).
 */
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { requireUser } from "@/lib/auth-guard";
import { googleConsentUrl } from "@/lib/import/google";

export async function GET(req: NextRequest) {
  const authed = await requireUser(req);
  if ("response" in authed) return authed.response;

  if (!process.env.GOOGLE_OAUTH_CLIENT_ID || !process.env.GOOGLE_OAUTH_CLIENT_SECRET) {
    return NextResponse.json({ error: "Google OAuth not configured" }, { status: 503 });
  }

  const state = randomUUID();
  const res = NextResponse.redirect(googleConsentUrl(state));
  res.cookies.set("g_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax", // must survive the top-level redirect back from Google
    secure: process.env.NODE_ENV === "production",
    maxAge: 600, // 10 minutes to complete consent
    path: "/",
  });
  return res;
}
