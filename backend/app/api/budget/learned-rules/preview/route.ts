/**
 * POST /api/budget/learned-rules/preview — what would this rule catch?
 *
 * build-reminders 6b, the read side of the learning loop. Two modes:
 *
 *   { transactionId }  → the default proposal for a just-corrected row: the
 *                        normalized description, and what it catches.
 *   { pattern }        → a preview for a pattern the user has widened or
 *                        narrowed by hand.
 *
 * Nothing is written. This is the count the user approves against before
 * ./route.ts POST commits anything — `byCurrentCategory` is the safety signal
 * that separates "fills uncategorized rows" from "moves rows already filed
 * elsewhere." The corpus is every transaction the user has, so the count is the
 * real one, not a sample.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-guard";
import { db } from "@/db";
import { transactions } from "@/db/schema";
import { normalizeDescription } from "@/lib/categorization";
import { previewPattern, proposeRule } from "@/lib/budget/rule-proposal";
import { and, eq } from "drizzle-orm";

export async function POST(req: NextRequest) {
  const authed = await requireUser(req);
  if ("response" in authed) return authed.response;
  const userId = authed.userId;

  const body = await req.json().catch(() => null);

  const corpus = await db
    .select({ description: transactions.description, category: transactions.category })
    .from(transactions)
    .where(eq(transactions.userId, userId));

  // Explicit pattern wins — a user who is actively widening/narrowing has typed
  // one, and re-previewing that is the whole point of the box.
  if (typeof body?.pattern === "string") {
    const pattern = normalizeDescription(body.pattern);
    if (pattern === "") {
      return NextResponse.json({ error: "pattern must not be empty" }, { status: 400 });
    }
    return NextResponse.json({ pattern, ...previewPattern(pattern, corpus) });
  }

  if (typeof body?.transactionId === "string") {
    const [txn] = await db
      .select({ description: transactions.description })
      .from(transactions)
      .where(and(eq(transactions.id, body.transactionId), eq(transactions.userId, userId)))
      .limit(1);
    // 404, never 403: same rule as the rest of the transaction routes — an id
    // that isn't yours is indistinguishable from one that doesn't exist.
    if (!txn) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(proposeRule(txn.description, corpus));
  }

  return NextResponse.json(
    { error: "provide a pattern to preview or a transactionId to propose from" },
    { status: 400 }
  );
}
