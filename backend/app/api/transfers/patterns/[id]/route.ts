/**
 * DELETE /api/transfers/patterns/:id — remove a saved pattern and unmark the
 * rule-marked rows it alone claimed. Rows another saved pattern still matches
 * stay marked; manual marks are never unmarked by pattern changes. Save and
 * delete are the same operation run in opposite directions — the learned-rules
 * contract.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-guard";
import { db } from "@/db";
import { transactions, transferPatterns } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { rowsToUnmark } from "@/lib/budget/transfers";

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const authed = await requireUser(req);
  if ("response" in authed) return authed.response;
  const { id } = await ctx.params;

  const [target] = await db
    .select()
    .from(transferPatterns)
    .where(and(eq(transferPatterns.id, id), eq(transferPatterns.userId, authed.userId)))
    .limit(1);
  if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const remaining = (
    await db
      .select({ pattern: transferPatterns.pattern })
      .from(transferPatterns)
      .where(eq(transferPatterns.userId, authed.userId))
  )
    .map((p) => p.pattern)
    .filter((p) => p !== target.pattern);

  const rows = await db
    .select({
      id: transactions.id,
      description: transactions.description,
      transferSource: transactions.transferSource,
    })
    .from(transactions)
    .where(eq(transactions.userId, authed.userId));

  const toUnmark = rowsToUnmark(rows, target.pattern, remaining);

  await db.delete(transferPatterns).where(eq(transferPatterns.id, id));
  if (toUnmark.length > 0) {
    await db
      .update(transactions)
      .set({ transferSource: null })
      .where(inArray(transactions.id, toUnmark.map((r) => r.id)));
  }

  return NextResponse.json({ ok: true, deleted: target.pattern, unmarked: toUnmark.length });
}
