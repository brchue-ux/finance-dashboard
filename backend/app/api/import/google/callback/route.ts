/**
 * GET /api/import/google/callback — OAuth redirect target. Verifies the CSRF
 * state cookie, exchanges the code for tokens, and stores the connection.
 * Returns a minimal self-closing page (the native app deep-links back; web just
 * closes the popup). The frontend replaces this with its own success handling.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-guard";
import { exchangeGoogleCode } from "@/lib/import/google";

function closePage(message: string): NextResponse {
  return new NextResponse(
    `<!doctype html><meta charset="utf-8"><title>Google connected</title><body style="font-family:system-ui;padding:2rem">${message}<script>setTimeout(()=>window.close(),1500)</script></body>`,
    { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }
  );
}

export async function GET(req: NextRequest) {
  const authed = await requireUser(req);
  if ("response" in authed) return authed.response;

  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const oauthError = searchParams.get("error");
  if (oauthError) return closePage(`Google authorization was cancelled (${oauthError}).`);
  if (!code || !state) return NextResponse.json({ error: "Missing code or state" }, { status: 400 });

  const expectedState = req.cookies.get("g_oauth_state")?.value;
  if (!expectedState || expectedState !== state) {
    return NextResponse.json({ error: "Invalid OAuth state" }, { status: 400 });
  }

  await exchangeGoogleCode(authed.userId, code);

  const res = closePage("Google Sheets connected. You can close this window.");
  res.cookies.delete("g_oauth_state");
  return res;
}
