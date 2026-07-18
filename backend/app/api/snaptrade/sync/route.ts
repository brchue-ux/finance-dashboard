/**
 * POST /api/snaptrade/sync
 * Syncs Wealthsimple portfolio via SnapTrade for the authenticated user.
 * Thin wrapper over lib/sync/snaptrade (shared with the nightly 2am job).
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { syncSnapTradeForUser } from "@/lib/sync/snaptrade";

export async function POST(req: NextRequest) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const result = await syncSnapTradeForUser(session.user.id);
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
