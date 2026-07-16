/**
 * GET /api/portfolio
 * Returns current portfolio state: latest snapshot, holdings, recent transactions.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import {
  portfolioSnapshots,
  holdings,
  portfolioTransactions,
  wealthsimpleConnections,
} from "@/db/schema";
import { eq, desc, gte } from "drizzle-orm";

export async function GET(req: NextRequest) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = session.user.id;

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
    db
      .select()
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
