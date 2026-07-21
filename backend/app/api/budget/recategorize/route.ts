/**
 * POST /api/budget/recategorize — re-run categorization over stored transactions.
 *
 * categorize() only runs at write time (CSV import, Plaid sync), so rows
 * ingested before an envelope existed keep whatever category they got then —
 * "uncategorized" for everything imported while budget_envelopes was empty.
 * Editing an envelope's rules has the same problem going backwards. This
 * re-derives categories for existing rows.
 *
 * Body: { onlyUncategorized?: boolean } — defaults true. Pass false to force a
 * full re-derive after a rules change.
 *
 * Two kinds of row are never touched, on either path:
 *
 *   - anything the user categorized by hand (`category_source = "manual"`).
 *     The `onlyUncategorized` default used to be the only thing protecting
 *     those, which meant the documented promise held on the default path and
 *     quietly broke on the one you reach for precisely when rules changed.
 *   - split transactions. Their budget attribution comes from their splits
 *     (lib/budget/summarize.ts), so rewriting the parent's category changes
 *     what the row claims and moves no money.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-guard";
import { db } from "@/db";
import { budgetEnvelopes, transactionSplits, transactions } from "@/db/schema";
import { UNCATEGORIZED, categorize } from "@/lib/categorization";
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
          categorySource: transactions.categorySource,
        })
        .from(transactions)
        .where(eq(transactions.userId, userId));

      // One query rather than a per-row lookup: this loop runs over every
      // transaction the user has (1,762 in real data).
      const splitParents = new Set(
        (
          await db
            .selectDistinct({ transactionId: transactionSplits.transactionId })
            .from(transactionSplits)
            .where(eq(transactionSplits.userId, userId))
        ).map((s) => s.transactionId)
      );

      const changes: { id: string; to: string }[] = [];
      let skippedManual = 0;
      let skippedSplit = 0;

      for (const t of rows) {
        if (t.categorySource === "manual") {
          skippedManual++;
          continue;
        }
        if (splitParents.has(t.id)) {
          skippedSplit++;
          continue;
        }
        if (onlyUncategorized && t.category && t.category !== UNCATEGORIZED) continue;
        const next = categorize(t.description, parsedEnvelopes);
        if (next !== t.category) changes.push({ id: t.id, to: next });
      }

      // One transaction, not N autocommits: a re-derive that dies partway
      // through used to leave the user's categories in a state that is neither
      // the old set nor the new one, with nothing recording where it stopped.
      await db.transaction(async (tx) => {
        for (const c of changes) {
          await tx
            .update(transactions)
            .set({ category: c.to })
            .where(eq(transactions.id, c.id));
        }
      });

      const byCategory: Record<string, number> = {};
      for (const c of changes) byCategory[c.to] = (byCategory[c.to] ?? 0) + 1;

      const result = {
        scanned: rows.length,
        updated: changes.length,
        skippedManual,
        skippedSplit,
        byCategory,
      };
      return { result, metadata: { ...result, onlyUncategorized } };
    },
    userId
  );

  return NextResponse.json(summary);
}
