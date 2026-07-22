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
        accountNames: wealthsimpleConnections.accountNames,
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

  // User names applied at read time (snapshots are append-only history — a
  // rename must retitle every past snapshot's view, so it can't live there).
  const accountNames: Record<string, string> = wsConn[0]?.accountNames
    ? JSON.parse(wsConn[0].accountNames)
    : {};
  const parsedAccounts = latestSnapshot ? JSON.parse(latestSnapshot.accounts) : null;
  if (Array.isArray(parsedAccounts)) {
    for (const group of parsedAccounts) {
      for (const a of group.accounts ?? []) a.name = accountNames[a.id] ?? null;
    }
  }
  // Strip the names map from the connection object — the client gets names
  // in place on the accounts, not as a raw map.
  const { accountNames: _names, ...connection } = wsConn[0] ?? {};

  return NextResponse.json({
    connection: wsConn[0] ? connection : null,
    latestSnapshot: latestSnapshot
      ? { ...latestSnapshot, accounts: parsedAccounts }
      : null,
    holdings: currentHoldings,
    snapshotHistory: snapshots.map((s) => ({
      snapshotAt: s.snapshotAt,
      totalValue: s.totalValue,
    })),
    recentTransactions: recentTxns,
  });
}
