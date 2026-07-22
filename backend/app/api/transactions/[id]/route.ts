/**
 * PATCH /api/transactions/:id — set this transaction's category by hand.
 *
 * build-reminders 6a. Until now the engine's guess was final: the only recourse
 * for a mis-filed transaction was to edit an envelope's rules and re-run a bulk
 * recategorize, which is a global change made to fix one row. That is the
 * sharpest form of the rigidity the user objected to — the app deciding what a
 * purchase *was* and offering no way to disagree.
 *
 * Writing `categorySource: "manual"` is the point of the whole route, not
 * bookkeeping: it is what stops a later full recategorize from erasing the
 * correction, and it is the record of user intent that a learning loop
 * (build-reminders 6b) consumes.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { budgetEnvelopes, transactionSplits, transactions } from "@/db/schema";
import { ownedTransaction } from "@/lib/transaction-access";
import { resolveCategoryAssignment } from "@/lib/budget/category-assignment";
import { recordCategorizationEvent } from "@/lib/budget/categorization-events";
import { and, eq } from "drizzle-orm";

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const found = await ownedTransaction(req, id);
  if ("response" in found) return found.response;

  const body = await req.json().catch(() => null);

  // A split transaction is replaced entirely by its splits in every budget
  // total (lib/budget/summarize.ts). Setting the parent's category would
  // change what the row displays and move no money at all — a silent
  // disagreement between the screen and the budget. Refuse and point at the
  // route that does work.
  const [existingSplit] = await db
    .select({ id: transactionSplits.id })
    .from(transactionSplits)
    .where(eq(transactionSplits.transactionId, id))
    .limit(1);

  if (existingSplit) {
    return NextResponse.json(
      {
        error:
          "This transaction is split; its categories come from its splits. Edit them at /api/transactions/:id/splits.",
        code: "TRANSACTION_IS_SPLIT",
      },
      { status: 409 }
    );
  }

  const envelopes = await db
    .select({ name: budgetEnvelopes.name })
    .from(budgetEnvelopes)
    .where(and(eq(budgetEnvelopes.userId, found.userId), eq(budgetEnvelopes.active, 1)));

  const resolved = resolveCategoryAssignment(body?.category, envelopes);
  if (!resolved.ok) {
    return NextResponse.json({ error: resolved.error }, { status: 400 });
  }

  await db
    .update(transactions)
    .set({ category: resolved.category, categorySource: "manual" })
    .where(eq(transactions.id, id));

  // The label this correction represents — captured append-only so it survives
  // a later re-correction, an envelope rename, or the row being deleted. This is
  // the training example; the category we just wrote is only current state.
  await recordCategorizationEvent({
    userId: found.userId,
    eventType: "manual_correction",
    transactionId: id,
    rawDescription: found.row.description,
    category: resolved.category,
    previousCategory: found.row.category,
  });

  return NextResponse.json({
    ok: true,
    id,
    category: resolved.category,
    categorySource: "manual",
    previousCategory: found.row.category,
  });
}
