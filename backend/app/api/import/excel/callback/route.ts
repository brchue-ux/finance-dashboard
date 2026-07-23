/**
 * GET /api/import/excel/callback — Microsoft OAuth redirect target.
 *
 * Authenticates by the server-side oauth_states row alone (single-use,
 * expiring): the state maps back to the user who started the flow, so this
 * works from any browser — the device's system browser and the manual
 * paste-back flow carry no app session, and must not need one.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { oauthStates } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { exchangeExcelCode } from "@/lib/import/excel";

function closePage(message: string): NextResponse {
  return new NextResponse(
    `<!doctype html><meta charset="utf-8"><title>Excel connected</title><body style="font-family:system-ui;padding:2rem">${message}<script>setTimeout(()=>window.close(),1500)</script></body>`,
    { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }
  );
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const oauthError = searchParams.get("error");
  if (oauthError) return closePage(`Microsoft authorization was cancelled (${oauthError}).`);
  if (!code || !state) return NextResponse.json({ error: "Missing code or state" }, { status: 400 });

  const [row] = await db
    .select()
    .from(oauthStates)
    .where(and(eq(oauthStates.state, state), eq(oauthStates.provider, "excel")))
    .limit(1);
  if (!row || row.expiresAt < Math.floor(Date.now() / 1000)) {
    return NextResponse.json({ error: "Invalid or expired OAuth state" }, { status: 400 });
  }
  // Single-use: burn the state before the exchange so a replayed callback with
  // the same state can never race a second exchange.
  await db.delete(oauthStates).where(eq(oauthStates.state, state));

  await exchangeExcelCode(row.userId, code);

  return closePage("Excel connected. You can close this window.");
}
