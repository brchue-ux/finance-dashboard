/**
 * GET /api/budget/envelopes/proposal — build-reminders item 6c.
 *
 * Derives a proposed category set from the user's OWN spending instead of
 * shipping a taxonomy. Returns the categories their transactions actually fall
 * into (with real monthly averages), and the merchants no seed rule could place
 * — the gap a fixed default list would hide. The client turns each into an
 * editable "keep / rename / skip" choice; nothing is created here.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-guard";
import { db } from "@/db";
import { budgetEnvelopes, transactions } from "@/db/schema";
import { eq } from "drizzle-orm";
import { budgetRows } from "@/lib/budget/transfers";
import { proposeEnvelopes } from "@/lib/budget/envelope-proposal";

export async function GET(req: NextRequest) {
  const authed = await requireUser(req);
  if ("response" in authed) return authed.response;
  const userId = authed.userId;

  const [txns, envelopes] = await Promise.all([
    db
      .select({
        id: transactions.id,
        description: transactions.description,
        amount: transactions.amount,
        date: transactions.date,
        transferSource: transactions.transferSource,
        coverage: transactions.coverage,
      })
      .from(transactions)
      .where(eq(transactions.userId, userId)),
    db
      .select({ name: budgetEnvelopes.name })
      .from(budgetEnvelopes)
      .where(eq(budgetEnvelopes.userId, userId)),
  ]);

  // Transfers and out-of-coverage rows are neither spending nor a category; the
  // proposal must reflect real household outflow, the same rows the budget math
  // counts. budgetRows drops both, identically to summarize.ts.
  const spendable = budgetRows(txns);

  const proposal = proposeEnvelopes(
    spendable.map((t) => ({ description: t.description, amount: t.amount, date: t.date })),
    envelopes.map((e) => e.name)
  );

  return NextResponse.json(proposal);
}
