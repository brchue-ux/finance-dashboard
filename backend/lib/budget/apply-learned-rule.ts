/**
 * Re-file the stored rows a pattern touches, under a given categorization
 * context. This is what makes saving a learned rule take effect on the history
 * you already have — and, run with the rule removed from the context, what
 * makes deleting one reversible. Saving and undoing are the same operation with
 * a different learned set.
 *
 * Only rows the pattern catches can change: adding or removing one learned rule
 * leaves every other row's `categorize()` result identical, so re-deriving just
 * the caught rows is both correct and the smallest change that can be. Within
 * that set the full context decides the winner, so a broad rule cannot steal
 * rows a more specific learned rule already claims.
 *
 * Two rows are never touched, matching the recategorize contract exactly: a
 * hand-set category (`category_source = "manual"`) is the user's own decision
 * and outranks any rule, and a split parent's category comes from its splits,
 * so rewriting it would move no money while changing what the row claims.
 */
import { db } from "@/db";
import { transactions, transactionSplits } from "@/db/schema";
import { categorize, ruleCatches } from "@/lib/categorization";
import type { CategorizationContext } from "@/lib/budget/categorization-context";
import { eq } from "drizzle-orm";

export async function refileRowsMatching(
  userId: string,
  pattern: string,
  ctx: CategorizationContext
): Promise<number> {
  const rows = await db
    .select({
      id: transactions.id,
      description: transactions.description,
      category: transactions.category,
      categorySource: transactions.categorySource,
    })
    .from(transactions)
    .where(eq(transactions.userId, userId));

  const splitParents = new Set(
    (
      await db
        .selectDistinct({ transactionId: transactionSplits.transactionId })
        .from(transactionSplits)
        .where(eq(transactionSplits.userId, userId))
    ).map((s) => s.transactionId)
  );

  const changes: { id: string; to: string }[] = [];
  for (const r of rows) {
    if (!ruleCatches(pattern, r.description)) continue;
    if (r.categorySource === "manual") continue;
    if (splitParents.has(r.id)) continue;
    const next = categorize(r.description, ctx.envelopes, ctx.learnedRules);
    if (next !== r.category) changes.push({ id: r.id, to: next });
  }

  // One transaction, same reason recategorize uses one: a re-file that dies
  // partway must not leave the categories in a state that is neither before
  // nor after.
  await db.transaction(async (tx) => {
    for (const c of changes) {
      await tx.update(transactions).set({ category: c.to }).where(eq(transactions.id, c.id));
    }
  });

  return changes.length;
}
