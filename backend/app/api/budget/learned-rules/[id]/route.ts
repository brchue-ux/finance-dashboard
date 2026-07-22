/**
 * DELETE /api/budget/learned-rules/:id — remove a learned rule and undo it.
 *
 * build-reminders 6b. Deleting is the counterpart to saving: propose-don't-
 * impose is only true if the user can take a rule back, and taking it back has
 * to mean the rows it captured are re-derived without it — otherwise the rule
 * lives on in the categories it already stamped, invisible, with nothing to
 * point at. So this deletes the rule and re-files the rows it matched against
 * the remaining context (other learned rules, then the seed rules). Manual and
 * split rows are left alone, same as everywhere else.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-guard";
import { db } from "@/db";
import { learnedRules } from "@/db/schema";
import { loadCategorizationContext } from "@/lib/budget/categorization-context";
import { refileRowsMatching } from "@/lib/budget/apply-learned-rule";
import { and, eq } from "drizzle-orm";

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const authed = await requireUser(req);
  if ("response" in authed) return authed.response;
  const userId = authed.userId;
  const { id } = await ctx.params;

  // Ownership enforced in the query — an id that isn't yours reads as not found.
  const [rule] = await db
    .select({ pattern: learnedRules.pattern })
    .from(learnedRules)
    .where(and(eq(learnedRules.id, id), eq(learnedRules.userId, userId)))
    .limit(1);
  if (!rule) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await db.delete(learnedRules).where(and(eq(learnedRules.id, id), eq(learnedRules.userId, userId)));

  // Reloaded AFTER the delete, so the rule is gone from the learned set and the
  // caught rows fall back to whatever now claims them.
  const refiled = await refileRowsMatching(userId, rule.pattern, await loadCategorizationContext(userId));

  return NextResponse.json({ ok: true, deleted: id, refiled });
}
