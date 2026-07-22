/**
 * GET /api/budget?year=2026&month=7
 * Returns budget data for a given month: envelopes, allocations, transactions.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-guard";
import { db } from "@/db";
import {
  budgetEnvelopes,
  envelopeAllocations,
  transactions,
  transactionSplits,
  bankConnections,
} from "@/db/schema";
import { eq, and, gte, lte } from "drizzle-orm";
import {
  summarizeEnvelopes,
  summarizeTotals,
  computeNotableTransactions,
} from "@/lib/budget/summarize";
import { monthElapsedFraction, computeTypicalSpend } from "@/lib/budget/pace";

export async function GET(req: NextRequest) {
  const authed = await requireUser(req);
  if ("response" in authed) return authed.response;

  const userId = authed.userId;
  const { searchParams } = new URL(req.url);
  const now = new Date();
  const year = parseInt(searchParams.get("year") ?? String(now.getFullYear()), 10);
  const month = parseInt(searchParams.get("month") ?? String(now.getMonth() + 1), 10);

  const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
  const endDate = new Date(year, month, 0).toISOString().split("T")[0]; // last day of month

  const [envelopes, allocations, monthTxns, connections, splits, historyTxns] = await Promise.all([
    db
      .select()
      .from(budgetEnvelopes)
      .where(and(eq(budgetEnvelopes.userId, userId), eq(budgetEnvelopes.active, 1))),
    db
      .select()
      .from(envelopeAllocations)
      .where(
        and(
          eq(envelopeAllocations.userId, userId),
          eq(envelopeAllocations.year, year),
          eq(envelopeAllocations.month, month)
        )
      ),
    db
      .select()
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, userId),
          gte(transactions.date, startDate),
          lte(transactions.date, endDate)
        )
      ),
    db
      .select({
        institution: bankConnections.institutionName,
        status: bankConnections.status,
        lastSyncedAt: bankConnections.lastSyncedAt,
      })
      .from(bankConnections)
      .where(eq(bankConnections.userId, userId)),
    // All of the user's splits; attributeSpend only applies those whose parent
    // transaction is in this month's set, so no date filter is needed here.
    db
      .select({
        transactionId: transactionSplits.transactionId,
        category: transactionSplits.category,
        amount: transactionSplits.amount,
      })
      .from(transactionSplits)
      .where(eq(transactionSplits.userId, userId)),
    // Full history, for the "typical monthly spend" the 6d envelope detail
    // compares this month against. Only the fields budgetRows/attributeSpend
    // read are selected.
    db
      .select({
        id: transactions.id,
        accountId: transactions.accountId,
        date: transactions.date,
        description: transactions.description,
        merchantName: transactions.merchantName,
        amount: transactions.amount,
        category: transactions.category,
        transferSource: transactions.transferSource,
        coverage: transactions.coverage,
      })
      .from(transactions)
      .where(eq(transactions.userId, userId)),
  ]);

  // 6d — pace against the elapsed month (default view) and each category's own
  // typical monthly spend (the deeper dig on tap).
  const pace = {
    monthFraction: monthElapsedFraction(year, month, new Date()),
    typicalByCategory: computeTypicalSpend(historyTxns, splits, year, month),
  };

  const summaries = summarizeEnvelopes(envelopes, allocations, monthTxns, splits, pace);
  const totals = summarizeTotals(summaries, monthTxns, splits);
  const notableByCategory = computeNotableTransactions(summaries, monthTxns, splits);

  // `splits` is already loaded for the budget math; reuse it to tell the feed
  // which rows are split (and into what), so a split reads as visibly done here
  // too, not only on the account screen where it was made.
  const splitsByTxn = new Map<string, string[]>();
  for (const s of splits) {
    const arr = splitsByTxn.get(s.transactionId) ?? [];
    arr.push(s.category);
    splitsByTxn.set(s.transactionId, arr);
  }

  return NextResponse.json({
    year,
    month,
    envelopes: summaries,
    transactions: monthTxns.map((t) => ({ ...t, splitCategories: splitsByTxn.get(t.id) ?? null })),
    notableTransactions: notableByCategory,
    summary: totals,
    bankConnections: connections,
  });
}
