/**
 * GET /api/budget?year=2026&month=7
 * Returns budget data for a given month: envelopes, allocations, transactions.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import {
  budgetEnvelopes,
  envelopeAllocations,
  transactions,
  bankConnections,
} from "@/db/schema";
import { eq, and, gte, lte } from "drizzle-orm";
import {
  summarizeEnvelopes,
  summarizeTotals,
  computeNotableTransactions,
} from "@/lib/budget/summarize";

export async function GET(req: NextRequest) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = session.user.id;
  const { searchParams } = new URL(req.url);
  const now = new Date();
  const year = parseInt(searchParams.get("year") ?? String(now.getFullYear()), 10);
  const month = parseInt(searchParams.get("month") ?? String(now.getMonth() + 1), 10);

  const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
  const endDate = new Date(year, month, 0).toISOString().split("T")[0]; // last day of month

  const [envelopes, allocations, monthTxns, connections] = await Promise.all([
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
  ]);

  const summaries = summarizeEnvelopes(envelopes, allocations, monthTxns);
  const totals = summarizeTotals(summaries, monthTxns);
  const notableByCategory = computeNotableTransactions(summaries, monthTxns);

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
