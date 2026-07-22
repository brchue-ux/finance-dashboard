/**
 * GET  /api/budget/learned-rules — the user's learned rules.
 * POST /api/budget/learned-rules — save one (the learning loop's write side).
 *
 * build-reminders 6b. A learned rule is a correction the user promoted to a
 * standing rule. Saving one does two things that must not come apart: it records
 * the rule so future imports and recategorizes honour it, and it re-files the
 * matching rows the user already has, so the correction takes effect on history
 * immediately rather than only going forward. Both happen here.
 *
 * Nothing is imposed. The caller sends a pattern the user approved against a
 * live count (see ./preview), and the response reports exactly what moved —
 * `catches` (every row the pattern matches) and `refiled` (how many actually
 * changed, manual and split rows left alone) — so the effect is auditable, not
 * a silent sweep.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-guard";
import { db } from "@/db";
import { learnedRules, transactions } from "@/db/schema";
import { normalizeDescription } from "@/lib/categorization";
import { resolveCategoryAssignment } from "@/lib/budget/category-assignment";
import { loadCategorizationContext } from "@/lib/budget/categorization-context";
import { previewPattern } from "@/lib/budget/rule-proposal";
import { refileRowsMatching } from "@/lib/budget/apply-learned-rule";
import { and, desc, eq } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";

export async function GET(req: NextRequest) {
  const authed = await requireUser(req);
  if ("response" in authed) return authed.response;

  const rules = await db
    .select({
      id: learnedRules.id,
      pattern: learnedRules.pattern,
      category: learnedRules.category,
      learnedFromTransactionId: learnedRules.learnedFromTransactionId,
      catchesAtCreation: learnedRules.catchesAtCreation,
      createdAt: learnedRules.createdAt,
    })
    .from(learnedRules)
    .where(eq(learnedRules.userId, authed.userId))
    .orderBy(desc(learnedRules.createdAt));

  return NextResponse.json({ rules });
}

export async function POST(req: NextRequest) {
  const authed = await requireUser(req);
  if ("response" in authed) return authed.response;
  const userId = authed.userId;

  const body = await req.json().catch(() => null);

  // The pattern is stored in its normalized form — the same shape the matcher
  // and the proposal engine produce — so "tim hortons" and "TIM HORTONS " are
  // one rule, not two that fight over the same rows under the unique index.
  if (typeof body?.pattern !== "string") {
    return NextResponse.json({ error: "pattern must be a string" }, { status: 400 });
  }
  const pattern = normalizeDescription(body.pattern);
  if (pattern === "") {
    return NextResponse.json({ error: "pattern must not be empty" }, { status: 400 });
  }

  const ctx = await loadCategorizationContext(userId);
  const resolved = resolveCategoryAssignment(body.category, ctx.envelopes);
  if (!resolved.ok) {
    return NextResponse.json({ error: resolved.error }, { status: 400 });
  }

  // Validate the provenance id if one was sent: it must be one of the user's own
  // transactions, so a saved rule can never point at a row that isn't theirs.
  let learnedFrom: string | null = null;
  if (typeof body?.learnedFromTransactionId === "string") {
    const [owned] = await db
      .select({ id: transactions.id })
      .from(transactions)
      .where(and(eq(transactions.id, body.learnedFromTransactionId), eq(transactions.userId, userId)))
      .limit(1);
    if (!owned) {
      return NextResponse.json(
        { error: "learnedFromTransactionId is not one of your transactions" },
        { status: 400 }
      );
    }
    learnedFrom = owned.id;
  }

  // The count the user is agreeing to, computed the same way ./preview showed
  // it — the corpus is every transaction, so it reflects the whole history.
  const corpus = await db
    .select({ description: transactions.description, category: transactions.category })
    .from(transactions)
    .where(eq(transactions.userId, userId));
  const preview = previewPattern(pattern, corpus);

  const now = Math.floor(Date.now() / 1000);
  await db
    .insert(learnedRules)
    .values({
      id: uuidv4(),
      userId,
      pattern,
      category: resolved.category,
      learnedFromTransactionId: learnedFrom,
      catchesAtCreation: preview.catches,
      createdAt: now,
    })
    // Re-teaching the same pattern updates its target rather than duplicating —
    // the unique (user, pattern) index guarantees one rule per pattern.
    .onConflictDoUpdate({
      target: [learnedRules.userId, learnedRules.pattern],
      set: {
        category: resolved.category,
        learnedFromTransactionId: learnedFrom,
        catchesAtCreation: preview.catches,
      },
    });

  const [saved] = await db
    .select({ id: learnedRules.id })
    .from(learnedRules)
    .where(and(eq(learnedRules.userId, userId), eq(learnedRules.pattern, pattern)))
    .limit(1);

  // Re-file with the context RELOADED so the new rule is in the learned set and
  // precedence (most-specific-wins across learned rules) is applied correctly.
  const refiled = await refileRowsMatching(userId, pattern, await loadCategorizationContext(userId));

  return NextResponse.json({
    ok: true,
    id: saved.id,
    pattern,
    category: resolved.category,
    catches: preview.catches,
    byCurrentCategory: preview.byCurrentCategory,
    samples: preview.samples,
    refiled,
  });
}
