/**
 * GET /api/import/excel/callback — Microsoft OAuth redirect target. Verifies the
 * CSRF state cookie, exchanges the code, and persists the MSAL token cache.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-guard";
import { exchangeExcelCode } from "@/lib/import/excel";

function closePage(message: string): NextResponse {
  return new NextResponse(
    `<!doctype html><meta charset="utf-8"><title>Excel connected</title><body style="font-family:system-ui;padding:2rem">${message}<script>setTimeout(()=>window.close(),1500)</script></body>`,
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
  if (oauthError) return closePage(`Microsoft authorization was cancelled (${oauthError}).`);
  if (!code || !state) return NextResponse.json({ error: "Missing code or state" }, { status: 400 });

  const expectedState = req.cookies.get("ms_oauth_state")?.value;
  if (!expectedState || expectedState !== state) {
    return NextResponse.json({ error: "Invalid OAuth state" }, { status: 400 });
  }

  await exchangeExcelCode(authed.userId, code);

  const res = closePage("Excel connected. You can close this window.");
  res.cookies.delete("ms_oauth_state");
  return res;
}
