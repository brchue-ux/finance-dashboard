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

  const [envelopes, allocations, monthTxns, connections, splits] = await Promise.all([
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
  ]);

  const summaries = summarizeEnvelopes(envelopes, allocations, monthTxns, splits);
  const totals = summarizeTotals(summaries, monthTxns, splits);
  const notableByCategory = computeNotableTransactions(summaries, monthTxns, splits);

  return NextResponse.json({
    year,
    month,
    envelopes: summaries,
    transactions: monthTxns,
    notableTransactions: notableByCategory,
    summary: totals,
    bankConnections: connections,
  });
}
