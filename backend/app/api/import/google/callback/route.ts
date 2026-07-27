/**
 * GET /api/import/google/callback — OAuth redirect target. Verifies the CSRF
 * state cookie, exchanges the code for tokens, and stores the connection.
 * Returns a minimal self-closing page (the native app deep-links back; web just
 * closes the popup). The frontend replaces this with its own success handling.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-guard";
import { exchangeGoogleCode } from "@/lib/import/google";
import { closePage } from "@/lib/close-page";
import { sanitizeForLog } from "@/lib/log-safe";

const TITLE = "Google connected";

export async function GET(req: NextRequest) {
  const authed = await requireUser(req);
  if ("response" in authed) return authed.response;

  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const oauthError = searchParams.get("error");
  // Never reflected — see the note in the Excel callback. The provider's error
  // string is attacker-controllable and useless to the user; it goes to the
  // server log only, sanitized.
  if (oauthError) {
    console.warn(
      `[import/google/callback] Google returned an OAuth error: ${sanitizeForLog(oauthError)}`
    );
    return closePage(TITLE, "Google authorization was cancelled. You can close this window.");
  }
  if (!code || !state) return NextResponse.json({ error: "Missing code or state" }, { status: 400 });

  const expectedState = req.cookies.get("g_oauth_state")?.value;
  if (!expectedState || expectedState !== state) {
    return NextResponse.json({ error: "Invalid OAuth state" }, { status: 400 });
  }

  await exchangeGoogleCode(authed.userId, code);

  const res = closePage(TITLE, "Google Sheets connected. You can close this window.");
  res.cookies.delete("g_oauth_state");
  return res;
}
