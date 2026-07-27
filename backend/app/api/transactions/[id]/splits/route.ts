/**
 * GET    /api/transactions/:id/splits — this transaction's splits (empty if none)
 * PUT    /api/transactions/:id/splits — replace the whole set
 * DELETE /api/transactions/:id/splits — clear, reverting to the single category
 *
 * PUT replaces rather than patching individual rows because the invariant
 * (splits sum to the transaction amount) is only meaningful across the complete
 * set — a per-row edit would necessarily pass through an invalid state.
 */
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { db } from "@/db";
import { transactionSplits } from "@/db/schema";
import { validateSplits } from "@/lib/budget/splits";
import { ownedTransaction } from "@/lib/transaction-access";
import { readJsonObject } from "@/lib/request-body";
import { eq } from "drizzle-orm";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const found = await ownedTransaction(req, id);
  if ("response" in found) return found.response;

  const rows = await db
    .select()
    .from(transactionSplits)
    .where(eq(transactionSplits.transactionId, id));

  return NextResponse.json({
    transactionAmount: found.row.amount,
    splits: rows.map((s) => ({
      id: s.id,
      category: s.category,
      amount: s.amount,
      note: s.note,
    })),
  });
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const found = await ownedTransaction(req, id);
  if ("response" in found) return found.response;

  // A malformed body is answered as such, rather than falling through to
  // validateSplits and reporting it as "splits must be a non-empty array".
  const body = await readJsonObject(req);
  if (!body) {
    return NextResponse.json({ error: "Body must be a JSON object" }, { status: 400 });
  }

  const validation = validateSplits(found.row.amount, body.splits);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const now = Date.now();
  const rows = validation.splits.map((s) => ({
    id: randomUUID(),
    transactionId: id,
    userId: found.userId,
    category: s.category,
    amount: s.amount,
    note: s.note ?? null,
    createdAt: now,
  }));

  // Replace atomically: a partial write would leave the transaction attributed
  // to a set that doesn't sum to its amount, skewing every budget total until
  // someone noticed.
  await db.transaction(async (tx) => {
    await tx.delete(transactionSplits).where(eq(transactionSplits.transactionId, id));
    await tx.insert(transactionSplits).values(rows);
  });

  return NextResponse.json({
    ok: true,
    splits: rows.map((s) => ({ id: s.id, category: s.category, amount: s.amount, note: s.note })),
  });
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const found = await ownedTransaction(req, id);
  if ("response" in found) return found.response;

  await db.delete(transactionSplits).where(eq(transactionSplits.transactionId, id));

  // The transaction's own category applies again from here.
  return NextResponse.json({ ok: true, cleared: true });
}
