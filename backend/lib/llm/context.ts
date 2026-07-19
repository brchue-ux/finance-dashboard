/**
 * Assembles per-user LLM context from Turso at request time.
 * Context rollup threshold: switch from row-level to monthly summaries
 * for months older than 12 when total transactions exceed 5,000.
 */
import { db } from "@/db";
import {
  transactions,
  budgetEnvelopes,
  envelopeAllocations,
  portfolioSnapshots,
  holdings,
  portfolioTransactions,
  bankConnections,
  wealthsimpleConnections,
} from "@/db/schema";
import { eq, and, gte, desc } from "drizzle-orm";

const ROLLUP_THRESHOLD = 5_000; // named constant per spec §8

export async function assembleBudgetContext(userId: string): Promise<string> {
  const now = new Date();
  const twelveMonthsAgo = new Date(now);
  twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);
  const cutoffDate = twelveMonthsAgo.toISOString().split("T")[0];

  // Check total transaction count for rollup decision
  const allTxns = await db
    .select({ id: transactions.id, date: transactions.date, amount: transactions.amount, category: transactions.category, description: transactions.description, merchantName: transactions.merchantName })
    .from(transactions)
    .where(eq(transactions.userId, userId))
    .orderBy(desc(transactions.date));

  const envelopes = await db
    .select()
    .from(budgetEnvelopes)
    .where(and(eq(budgetEnvelopes.userId, userId), eq(budgetEnvelopes.active, 1)));

  const allocations = await db
    .select()
    .from(envelopeAllocations)
    .where(eq(envelopeAllocations.userId, userId));

  const bankConns = await db
    .select({ institution: bankConnections.institutionName, status: bankConnections.status, lastSyncedAt: bankConnections.lastSyncedAt })
    .from(bankConnections)
    .where(eq(bankConnections.userId, userId));

  const useRollup = allTxns.length > ROLLUP_THRESHOLD;

  const recentTxns = allTxns.filter((t) => t.date >= cutoffDate);
  const olderTxns = useRollup ? allTxns.filter((t) => t.date < cutoffDate) : [];

  // Monthly summaries for older data when rollup is active
  const olderSummaries = useRollup
    ? summarizeByMonth(olderTxns)
    : [];

  return JSON.stringify({
    currentDate: now.toISOString(),
    amountConvention: "Transaction amounts are signed: negative = money out (spending), positive = money in (income/refund). The 'direction' field on each transaction states this explicitly.",
    bankConnections: bankConns,
    envelopes: envelopes.map((e) => ({
      name: e.name,
      monthlyTarget: e.monthlyTarget,
      sortOrder: e.sortOrder,
    })),
    allocations,
    // Label each row's direction so the model never has to infer it from the sign
    recentTransactions: recentTxns.map((t) => ({
      ...t,
      direction: t.amount < 0 ? "outflow" : "inflow",
    })),
    olderMonthlySummaries: olderSummaries,
    rollupActive: useRollup,
  }, null, 2);
}

export async function assemblePortfolioContext(userId: string): Promise<string> {
  const now = new Date();
  const ninetyDaysAgo = new Date(now);
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
  const cutoffDate = ninetyDaysAgo.toISOString().split("T")[0];

  const snapshots = await db
    .select()
    .from(portfolioSnapshots)
    .where(eq(portfolioSnapshots.userId, userId))
    .orderBy(desc(portfolioSnapshots.snapshotAt));

  // Latest snapshot's holdings = current holdings
  const latestSnapshot = snapshots[0];
  const currentHoldings = latestSnapshot
    ? await db
        .select()
        .from(holdings)
        .where(eq(holdings.snapshotId, latestSnapshot.id))
    : [];

  const recentPortfolioTxns = await db
    .select()
    .from(portfolioTransactions)
    .where(and(eq(portfolioTransactions.userId, userId), gte(portfolioTransactions.date, cutoffDate)))
    .orderBy(desc(portfolioTransactions.date));

  const wsConn = await db
    .select({ status: wealthsimpleConnections.status, lastSyncedAt: wealthsimpleConnections.lastSyncedAt })
    .from(wealthsimpleConnections)
    .where(eq(wealthsimpleConnections.userId, userId))
    .limit(1);

  return JSON.stringify({
    currentDate: now.toISOString(),
    wealthsimpleConnection: wsConn[0] ?? null,
    portfolioSnapshots: snapshots.map((s) => ({
      snapshotAt: s.snapshotAt,
      totalValue: s.totalValue,
      cashValue: s.cashValue,
      accounts: JSON.parse(s.accounts),
    })),
    currentHoldings,
    recentPortfolioTransactions: recentPortfolioTxns,
  }, null, 2);
}

function summarizeByMonth(
  txns: { date: string; amount: number; category: string | null }[]
): Array<{ yearMonth: string; summaries: Record<string, number> }> {
  const map = new Map<string, Record<string, number>>();
  for (const t of txns) {
    const ym = t.date.slice(0, 7); // "YYYY-MM"
    if (!map.has(ym)) map.set(ym, {});
    const cat = t.category ?? "uncategorized";
    map.get(ym)![cat] = (map.get(ym)![cat] ?? 0) + t.amount;
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([yearMonth, summaries]) => ({ yearMonth, summaries }));
}
