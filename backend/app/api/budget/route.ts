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

  // Build envelope summaries
  const allocationMap = new Map(
    allocations.map((a) => [a.envelopeId, a.allocated])
  );

  const summaries = envelopes.map((env) => {
    const allocated =
      allocationMap.get(env.id) ?? env.monthlyTarget;
    const spent = monthTxns
      .filter((t) => t.category === env.name && t.amount < 0)
      .reduce((sum, t) => sum + Math.abs(t.amount), 0);
    return {
      ...env,
      categoryRules: JSON.parse(env.categoryRules) as string[],
      allocated,
      spent,
      remaining: allocated - spent,
      overBudget: spent > allocated,
    };
  });

  const totalSpent = summaries.reduce((s, e) => s + e.spent, 0);
  const totalAllocated = summaries.reduce((s, e) => s + e.allocated, 0);
  const totalIncome = monthTxns
    .filter((t) => t.amount > 0)
    .reduce((s, t) => s + t.amount, 0);

  return NextResponse.json({
    year,
    month,
    envelopes: summaries,
    transactions: monthTxns,
    summary: {
      totalSpent,
      totalAllocated,
      totalIncome,
      remaining: totalAllocated - totalSpent,
      saved: totalIncome - totalSpent,
    },
    bankConnections: connections,
  });
}
