/**
 * Assembles per-user LLM context from Turso at request time.
 * Context rollup threshold: switch from row-level to monthly summaries
 * for months older than 12 when total transactions exceed 5,000.
 */
import { db } from "@/db";
import {
  transactions,
  transactionSplits,
  budgetEnvelopes,
  envelopeAllocations,
  portfolioSnapshots,
  holdings,
  portfolioTransactions,
  bankConnections,
  wealthsimpleConnections,
} from "@/db/schema";
import { eq, and, gte, desc } from "drizzle-orm";
import { attributeSpend, type SplitRow } from "@/lib/budget/summarize";
import { currentAllocation } from "@/lib/budget/reallocate";

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

  const splits: SplitRow[] = await db
    .select({
      transactionId: transactionSplits.transactionId,
      category: transactionSplits.category,
      amount: transactionSplits.amount,
    })
    .from(transactionSplits)
    .where(eq(transactionSplits.userId, userId));

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

  const splitsByTxn = new Map<string, SplitRow[]>();
  for (const sp of splits) {
    const list = splitsByTxn.get(sp.transactionId);
    if (list) list.push(sp);
    else splitsByTxn.set(sp.transactionId, [sp]);
  }

  const recentTxns = allTxns.filter((t) => t.date >= cutoffDate);
  const olderTxns = useRollup ? allTxns.filter((t) => t.date < cutoffDate) : [];

  // Monthly summaries for older data when rollup is active
  const olderSummaries = useRollup
    ? summarizeByMonth(olderTxns, splits)
    : [];

  return JSON.stringify({
    currentDate: now.toISOString(),
    amountConvention: "Transaction amounts are signed: negative = money out (spending), positive = money in (income/refund). The 'direction' field on each transaction states this explicitly.",
    bankConnections: bankConns,
    // Each envelope carries its *effective* budget for the current month:
    // monthlyTarget unless an allocation row overrides it. Raw allocation rows
    // were previously passed alongside, but they key on envelope UUIDs that
    // never appear in this payload, so the model had no way to join them and
    // would reason from a stale monthlyTarget after any reallocation.
    envelopes: envelopes.map((e) => ({
      name: e.name,
      monthlyTarget: e.monthlyTarget,
      budgetedThisMonth: currentAllocation(
        e,
        allocations.filter(
          (a) => a.year === now.getFullYear() && a.month === now.getMonth() + 1
        )
      ),
      sortOrder: e.sortOrder,
    })),
    envelopeConvention:
      "'budgetedThisMonth' is the amount actually budgeted for the current month and is what reallocations move; 'monthlyTarget' is the standing default it started from. Reason about the current month with budgetedThisMonth.",
    // Label each row's direction so the model never has to infer it from the sign
    splitConvention:
      "A transaction with a non-empty 'splits' array is divided across several envelopes. Its parts REPLACE its own 'category' — count the splits, never both, or you will double-count the spend.",
    recentTransactions: recentTxns.map((t) => {
      const parts = splitsByTxn.get(t.id);
      return {
        ...t,
        direction: t.amount < 0 ? "outflow" : "inflow",
        ...(parts
          ? { splits: parts.map((p) => ({ category: p.category, amount: p.amount })) }
          : {}),
      };
    }),
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
  txns: { id: string; date: string; amount: number; category: string | null }[],
  splits: SplitRow[] = []
): Array<{ yearMonth: string; summaries: Record<string, number> }> {
  const map = new Map<string, Record<string, number>>();
  // Rolled-up months are the model's only view of older spending, so they have
  // to attribute splits the same way the live months do.
  for (const a of attributeSpend(txns, splits)) {
    const ym = a.transaction.date.slice(0, 7); // "YYYY-MM"
    if (!map.has(ym)) map.set(ym, {});
    const cat = a.category ?? "uncategorized";
    map.get(ym)![cat] = (map.get(ym)![cat] ?? 0) + a.amount;
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([yearMonth, summaries]) => ({ yearMonth, summaries }));
}
