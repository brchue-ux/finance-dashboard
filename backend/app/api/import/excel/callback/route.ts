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
import { closePage } from "@/lib/close-page";
import { sanitizeForLog } from "@/lib/log-safe";

const TITLE = "Excel connected";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const oauthError = searchParams.get("error");
  // The provider's own error string is deliberately NOT reflected in the
  // response, in any form: it tells the user nothing they can act on, and
  // reflecting attacker-controlled text into an unauthenticated text/html
  // response on the session-cookie origin is how this route grew an XSS. It
  // goes to the server log only, CR/LF-stripped and length-capped, because a
  // log line is a text sink an untrusted value can forge too.
  if (oauthError) {
    console.warn(
      `[import/excel/callback] Microsoft returned an OAuth error: ${sanitizeForLog(oauthError)}`
    );
    return closePage(TITLE, "Microsoft authorization was cancelled. You can close this window.");
  }
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

  return closePage(TITLE, "Excel connected. You can close this window.");
}
