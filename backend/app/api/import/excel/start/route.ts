/**
 * GET /api/import/excel/start — begin the Microsoft (Excel/Graph) OAuth flow.
 *
 * State lives server-side in oauth_states (single-use, 10-minute expiry), so
 * the callback authenticates by state alone and can arrive from ANY browser —
 * the app's system-browser handoff carries no session cookie, and the manual
 * paste-back flow shouldn't need cookie surgery either.
 *
 * Two response modes:
 *   default   → 307 redirect to Microsoft's consent screen (browser use)
 *   ?json=1   → { url } for the app, whose fetch client must not follow a
 *               redirect into Microsoft's HTML and try to parse it as JSON
 *
 * The consent URL uses the /consumers authority: personal Microsoft accounts
 * are the ones with OneDrive here, and /common routes picker-ambiguous accounts
 * to their org identity — seen live as "Tenant does not have a SPO license".
 */
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { requireUser } from "@/lib/auth-guard";
import { db } from "@/db";
import { oauthStates } from "@/db/schema";
import { and, eq, lt } from "drizzle-orm";
import { excelConsentUrl, excelConfigured } from "@/lib/import/excel";

const STATE_TTL_SECONDS = 600;

export async function GET(req: NextRequest) {
  const authed = await requireUser(req);
  if ("response" in authed) return authed.response;
  if (!excelConfigured()) {
    return NextResponse.json({ error: "Microsoft OAuth not configured" }, { status: 503 });
  }

  const state = randomUUID();
  const now = Math.floor(Date.now() / 1000);

  // Opportunistic cleanup of this user's expired states, then record the new one.
  await db
    .delete(oauthStates)
    .where(and(eq(oauthStates.userId, authed.userId), lt(oauthStates.expiresAt, now)));
  await db.insert(oauthStates).values({
    state,
    userId: authed.userId,
    provider: "excel",
    createdAt: now,
    expiresAt: now + STATE_TTL_SECONDS,
  });

  const url = (await excelConsentUrl(state)).replace("/common/", "/consumers/");

  if (new URL(req.url).searchParams.get("json") === "1") {
    return NextResponse.json({ url });
  }
  return NextResponse.redirect(url);
}
