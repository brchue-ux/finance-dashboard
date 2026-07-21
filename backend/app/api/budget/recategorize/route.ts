/**
 * POST /api/budget/recategorize — re-run categorization over stored transactions.
 *
 * categorize() only runs at write time (CSV import, Plaid sync), so rows
 * ingested before an envelope existed keep whatever category they got then —
 * "uncategorized" for everything imported while budget_envelopes was empty.
 * Editing an envelope's rules has the same problem going backwards. This
 * re-derives categories for existing rows.
 *
 * Body: { onlyUncategorized?: boolean } — defaults true, so a re-run cannot
 * silently overwrite a category the user set by hand. Pass false to force a
 * full re-derive after a rules change.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-guard";
import { db } from "@/db";
import { budgetEnvelopes, transactions } from "@/db/schema";
import { categorize } from "@/lib/categorization";
import { and, eq } from "drizzle-orm";
import { withJobRun } from "@/lib/jobs/job-runs";

export async function POST(req: NextRequest) {
  const authed = await requireUser(req);
  if ("response" in authed) return authed.response;

  const userId = authed.userId;
  const body = await req.json().catch(() => null);
  const onlyUncategorized = body?.onlyUncategorized !== false;

  const envelopes = await db
    .select({
      name: budgetEnvelopes.name,
      categoryRules: budgetEnvelopes.categoryRules,
      sortOrder: budgetEnvelopes.sortOrder,
    })
    .from(budgetEnvelopes)
    .where(and(eq(budgetEnvelopes.userId, userId), eq(budgetEnvelopes.active, 1)));

  if (envelopes.length === 0) {
    return NextResponse.json(
      { error: "No active envelopes — create envelopes before recategorizing" },
      { status: 409 }
    );
  }

  const parsedEnvelopes = envelopes.map((e) => ({
    ...e,
    categoryRules: JSON.parse(e.categoryRules) as string[],
  }));

  const summary = await withJobRun(
    "recategorize",
    async () => {
      const rows = await db
        .select({
          id: transactions.id,
          description: transactions.description,
          category: transactions.category,
        })
        .from(transactions)
        .where(eq(transactions.userId, userId));

      const changes: { id: string; to: string }[] = [];
      for (const t of rows) {
        if (onlyUncategorized && t.category && t.category !== "uncategorized") continue;
        const next = categorize(t.description, parsedEnvelopes);
        if (next !== t.category) changes.push({ id: t.id, to: next });
      }

      for (const c of changes) {
        await db
          .update(transactions)
          .set({ category: c.to })
          .where(eq(transactions.id, c.id));
      }

      const byCategory: Record<string, number> = {};
      for (const c of changes) byCategory[c.to] = (byCategory[c.to] ?? 0) + 1;

      const result = { scanned: rows.length, updated: changes.length, byCategory };
      return { result, metadata: { ...result, onlyUncategorized } };
    },
    userId
  );

  return NextResponse.json(summary);
}
