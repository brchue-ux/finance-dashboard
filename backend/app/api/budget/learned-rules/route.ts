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
import { bankAccounts, learnedRules, transactions } from "@/db/schema";
import { normalizeDescription } from "@/lib/categorization";
import { resolveCategoryAssignment } from "@/lib/budget/category-assignment";
import { loadCategorizationContext } from "@/lib/budget/categorization-context";
import { previewPattern } from "@/lib/budget/rule-proposal";
import { refileRowsMatching } from "@/lib/budget/apply-learned-rule";
import { recordCategorizationEvent } from "@/lib/budget/categorization-events";
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
      accountId: learnedRules.accountId,
      effectiveFrom: learnedRules.effectiveFrom,
      // Resolved here so the manage screen can label scope without a second call.
      accountName: bankAccounts.name,
    })
    .from(learnedRules)
    .leftJoin(bankAccounts, eq(learnedRules.accountId, bankAccounts.id))
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

  // Scope (rules are SCOPED, not catch-all — user decision 2026-07-22).
  // accountId: rule fires only in that account; validated as the user's own so
  // a rule can never be scoped to someone else's account.
  let scopeAccountId: string | null = null;
  if (typeof body?.accountId === "string" && body.accountId !== "") {
    const [acct] = await db
      .select({ id: bankAccounts.id })
      .from(bankAccounts)
      .where(and(eq(bankAccounts.id, body.accountId), eq(bankAccounts.userId, userId)))
      .limit(1);
    if (!acct) {
      return NextResponse.json({ error: "accountId is not one of your accounts" }, { status: 400 });
    }
    scopeAccountId = acct.id;
  }
  // futureOnly: the rule applies from today forward and history is never
  // re-filed — stored as a date bound, not a flag, so later bulk recategorizes
  // can't drag it backward. LOCAL date, not toISOString(): the server runs in
  // the household's timezone, and the UTC date flips at ~8pm ET — a rule saved
  // in the evening would silently skip transactions dated "today".
  const d = new Date();
  const effectiveFrom =
    body?.futureOnly === true
      ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
      : null;

  // Validate the provenance id if one was sent: it must be one of the user's own
  // transactions, so a saved rule can never point at a row that isn't theirs.
  let learnedFrom: string | null = null;
  let sourceDescription: string | null = null;
  if (typeof body?.learnedFromTransactionId === "string") {
    const [owned] = await db
      .select({ id: transactions.id, description: transactions.description })
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
    sourceDescription = owned.description;
  }

  // The count the user is agreeing to, computed the same way ./preview showed
  // it. The corpus honours the account scope so an account-scoped rule's
  // recorded count is the count it can actually touch.
  const corpus = await db
    .select({ description: transactions.description, category: transactions.category })
    .from(transactions)
    .where(
      scopeAccountId
        ? and(eq(transactions.userId, userId), eq(transactions.accountId, scopeAccountId))
        : eq(transactions.userId, userId)
    );
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
      accountId: scopeAccountId,
      effectiveFrom,
    })
    // Re-teaching the same pattern updates its target rather than duplicating —
    // the unique (user, pattern) index guarantees one rule per pattern. Scope is
    // part of what was re-taught, so it updates too.
    .onConflictDoUpdate({
      target: [learnedRules.userId, learnedRules.pattern],
      set: {
        category: resolved.category,
        learnedFromTransactionId: learnedFrom,
        catchesAtCreation: preview.catches,
        accountId: scopeAccountId,
        effectiveFrom,
      },
    });

  const [saved] = await db
    .select({ id: learnedRules.id })
    .from(learnedRules)
    .where(and(eq(learnedRules.userId, userId), eq(learnedRules.pattern, pattern)))
    .limit(1);

  // The label this rule represents, append-only. rawDescription is the source
  // transaction when the rule came from a correction, and the pattern itself
  // otherwise (a rule saved straight from the widen/narrow box) — either way the
  // (input, category) pair is preserved as training data.
  await recordCategorizationEvent({
    userId,
    eventType: "rule_saved",
    transactionId: learnedFrom,
    rawDescription: sourceDescription ?? pattern,
    category: resolved.category,
    pattern,
  });

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
