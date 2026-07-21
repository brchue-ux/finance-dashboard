/**
 * POST /api/snaptrade/sync
 * Syncs Wealthsimple portfolio via SnapTrade for the authenticated user.
 * Thin wrapper over lib/sync/snaptrade (shared with the nightly 2am job).
 */
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-guard";
import { syncSnapTradeForUser } from "@/lib/sync/snaptrade";

export async function POST(req: NextRequest) {
  const authed = await requireUser(req);
  if ("response" in authed) return authed.response;

  const result = await syncSnapTradeForUser(authed.userId);
  if (result.skipped === "no_connection") {
    return NextResponse.json({ error: "No Wealthsimple connection" }, { status: 404 });
  }
  if (result.skipped === "debounce") {
    return NextResponse.json({ ok: true, skipped: true, reason: "debounce" });
  }
  return NextResponse.json({
    ok: true,
    totalValue: result.totalValue,
    holdingsCount: result.holdingsCount,
  });
}
