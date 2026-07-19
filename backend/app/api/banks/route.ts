/**
 * GET /api/banks — the Banks tab landing (spec §9 / Ticket 011): one entry per
 * bank account (chequing/savings/credit + the manual/CSV account if present),
 * with current balance, mask, institution, connection status and last-synced.
 *
 * Balances are returned raw — the tap-to-reveal masking is a frontend concern.
 * Investment accounts are not here (those live under /api/portfolio).
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { bankAccounts, bankConnections } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function GET(req: NextRequest) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // LEFT JOIN: manual accounts have connectionId = NULL and no connection row.
  const rows = await db
    .select({
      id: bankAccounts.id,
      name: bankAccounts.name,
      type: bankAccounts.type,
      mask: bankAccounts.mask,
      institution: bankAccounts.institution,
      balanceCurrent: bankAccounts.balanceCurrent,
      balanceAvailable: bankAccounts.balanceAvailable,
      balanceLimit: bankAccounts.balanceLimit,
      isoCurrencyCode: bankAccounts.isoCurrencyCode,
      connectionStatus: bankConnections.status,
      lastSyncedAt: bankConnections.lastSyncedAt,
    })
    .from(bankAccounts)
    .leftJoin(bankConnections, eq(bankAccounts.connectionId, bankConnections.id))
    .where(eq(bankAccounts.userId, session.user.id));

  const accounts = rows.map((r) => ({
    ...r,
    // Manual/CSV accounts aren't synced — surface that explicitly rather than null
    connectionStatus: r.connectionStatus ?? (r.type === "manual" ? "manual" : "unknown"),
  }));

  return NextResponse.json({ accounts });
}
