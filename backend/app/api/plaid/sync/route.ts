/**
 * POST /api/plaid/sync
 * Syncs transactions for all active bank connections for the authenticated
 * user. Thin wrapper over lib/sync/plaid (shared with the nightly 2am job).
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { syncPlaidForUser } from "@/lib/sync/plaid";

export async function POST(req: NextRequest) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const result = await syncPlaidForUser(session.user.id);
  return NextResponse.json({ ok: true, transactionsProcessed: result.transactionsProcessed });
}
