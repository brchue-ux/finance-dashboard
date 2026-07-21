/**
 * GET /api/portfolio
 * Returns current portfolio state: latest snapshot, holdings, recent transactions.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-guard";
import { db } from "@/db";
import {
  portfolioSnapshots,
  holdings,
  portfolioTransactions,
  wealthsimpleConnections,
} from "@/db/schema";
import { eq, desc, gte } from "drizzle-orm";

export async function GET(req: NextRequest) {
  const authed = await requireUser(req);
  if ("response" in authed) return authed.response;

  const userId = authed.userId;

  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
  const cutoffDate = ninetyDaysAgo.toISOString().split("T")[0];

  const [snapshots, wsConn] = await Promise.all([
    db
      .select()
      .from(portfolioSnapshots)
      .where(eq(portfolioSnapshots.userId, userId))
      .orderBy(desc(portfolioSnapshots.snapshotAt))
      .limit(365), // up to 1 year of daily snapshots for chart
    // Explicit projection — the full row includes the encrypted SnapTrade
    // credential, which must never reach the client (spec: contract-gap item 8)
    db
      .select({
        id: wealthsimpleConnections.id,
        status: wealthsimpleConnections.status,
        lastSyncedAt: wealthsimpleConnections.lastSyncedAt,
        createdAt: wealthsimpleConnections.createdAt,
      })
      .from(wealthsimpleConnections)
      .where(eq(wealthsimpleConnections.userId, userId))
      .limit(1),
  ]);

  const latestSnapshot = snapshots[0] ?? null;

  const [currentHoldings, recentTxns] = latestSnapshot
    ? await Promise.all([
        db
          .select()
          .from(holdings)
          .where(eq(holdings.snapshotId, latestSnapshot.id)),
        db
          .select()
          .from(portfolioTransactions)
          .where(
            eq(portfolioTransactions.userId, userId)
          )
          .orderBy(desc(portfolioTransactions.date))
          .limit(50),
      ])
    : [[], []];

  return NextResponse.json({
    connection: wsConn[0] ?? null,
    latestSnapshot: latestSnapshot
      ? { ...latestSnapshot, accounts: JSON.parse(latestSnapshot.accounts) }
      : null,
    holdings: currentHoldings,
    snapshotHistory: snapshots.map((s) => ({
      snapshotAt: s.snapshotAt,
      totalValue: s.totalValue,
    })),
    recentTransactions: recentTxns,
  });
}
