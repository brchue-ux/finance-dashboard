/**
 * POST /api/plaid/sync
 * Syncs transactions for all active bank connections for the authenticated
 * user. Thin wrapper over lib/sync/plaid (shared with the nightly 2am job).
 */
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-guard";
import { syncPlaidForUser } from "@/lib/sync/plaid";

export async function POST(req: NextRequest) {
  const authed = await requireUser(req);
  if ("response" in authed) return authed.response;

  const result = await syncPlaidForUser(authed.userId);
  return NextResponse.json({ ok: true, transactionsProcessed: result.transactionsProcessed });
}
