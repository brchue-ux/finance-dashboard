/**
 * PATCH  /api/budget/envelopes/:id — edit name/target/rules/order/active
 * DELETE /api/budget/envelopes/:id — deactivate (soft)
 *
 * Delete is soft on purpose: envelope_allocations rows reference the envelope,
 * and past transactions carry the envelope *name* as their category, so a hard
 * delete would orphan allocations and silently rewrite spending history.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-guard";
import { db } from "@/db";
import { budgetEnvelopes, transactions, transactionSplits } from "@/db/schema";
import { and, eq } from "drizzle-orm";

async function ownedEnvelope(req: NextRequest, id: string) {
  const authed = await requireUser(req);
  if ("response" in authed) return authed;

  const [row] = await db
    .select()
    .from(budgetEnvelopes)
    .where(and(eq(budgetEnvelopes.id, id), eq(budgetEnvelopes.userId, authed.userId)));

  if (!row) return { response: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  return { row, userId: authed.userId };
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const found = await ownedEnvelope(req, id);
  if ("response" in found) return found.response;

  const body = await req.json().catch(() => null);
  const patch: Partial<typeof budgetEnvelopes.$inferInsert> = {};

  if (typeof body?.name === "string" && body.name.trim()) {
    patch.name = body.name.trim();
  }
  if (body?.monthlyTarget !== undefined) {
    const t = Number(body.monthlyTarget);
    if (!Number.isFinite(t) || t < 0) {
      return NextResponse.json(
        { error: "monthlyTarget must be a non-negative number" },
        { status: 400 }
      );
    }
    patch.monthlyTarget = t;
  }
  if (Array.isArray(body?.categoryRules)) {
    patch.categoryRules = JSON.stringify(
      body.categoryRules.filter((r: unknown): r is string => typeof r === "string")
    );
  }
  if (body?.active !== undefined) patch.active = body.active ? 1 : 0;
  if (Number.isFinite(Number(body?.sortOrder))) {
    patch.sortOrder = Number(body.sortOrder);
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "No supported fields to update" }, { status: 400 });
  }

  // A rename must carry history with it. transactions.category and
  // transaction_splits.category both store the envelope NAME, so updating the
  // envelope alone orphans every past row: they keep the old name, match no
  // active envelope, and silently drop out of budget math. Verified before
  // fixing — renaming an envelope with $400 of spend reported $0 afterwards.
  // The schema comment already promised past rows survive a rename; this makes
  // that true. Renaming is how a user makes the app fit their own categories,
  // so it must not cost them their history.
  const oldName = found.row.name;
  const newName = patch.name;
  const renaming = typeof newName === "string" && newName !== oldName;

  await db.transaction(async (tx) => {
    await tx.update(budgetEnvelopes).set(patch).where(eq(budgetEnvelopes.id, id));
    if (renaming) {
      await tx
        .update(transactions)
        .set({ category: newName })
        .where(and(eq(transactions.userId, found.userId), eq(transactions.category, oldName)));
      await tx
        .update(transactionSplits)
        .set({ category: newName })
        .where(and(eq(transactionSplits.userId, found.userId), eq(transactionSplits.category, oldName)));
    }
  });

  return NextResponse.json({ ok: true, renamedFrom: renaming ? oldName : undefined });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const found = await ownedEnvelope(req, id);
  if ("response" in found) return found.response;

  await db
    .update(budgetEnvelopes)
    .set({ active: 0 })
    .where(eq(budgetEnvelopes.id, id));

  return NextResponse.json({ ok: true, deactivated: true });
}
