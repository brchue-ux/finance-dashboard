/**
 * Everything `categorize()` needs for one user, loaded once: the active
 * envelopes (the shipped seed rules) and the user's learned rules (Layer 2).
 *
 * There is exactly one place that assembles this, because every path that files
 * a transaction — CSV/Plaid import at write time, and the bulk recategorize —
 * must see the SAME inputs. When only the import path knew about seed rules and
 * recategorize was the durability net, a rules change silently disagreed with
 * itself; learned rules would reintroduce that class of bug the moment one
 * caller forgot them. Sharing the loader is what keeps every categorization
 * path honest about the learned set.
 */
import { db } from "@/db";
import { budgetEnvelopes, learnedRules } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { UNCATEGORIZED, type Envelope, type LearnedRule } from "@/lib/categorization";

export interface CategorizationContext {
  envelopes: Envelope[];
  learnedRules: LearnedRule[];
}

export async function loadCategorizationContext(
  userId: string
): Promise<CategorizationContext> {
  const envelopeRows = await db
    .select({
      name: budgetEnvelopes.name,
      categoryRules: budgetEnvelopes.categoryRules,
      sortOrder: budgetEnvelopes.sortOrder,
    })
    .from(budgetEnvelopes)
    .where(and(eq(budgetEnvelopes.userId, userId), eq(budgetEnvelopes.active, 1)));

  const envelopes: Envelope[] = envelopeRows.map((e) => ({
    ...e,
    categoryRules: JSON.parse(e.categoryRules) as string[],
  }));

  const ruleRows = await db
    .select({ pattern: learnedRules.pattern, category: learnedRules.category })
    .from(learnedRules)
    .where(eq(learnedRules.userId, userId));

  // A learned rule whose target envelope was since deactivated must stop firing,
  // the same way that envelope's own seed rules already do (inactive envelopes
  // aren't loaded above). Left in, it would keep filing rows under a name that
  // no longer rolls up to anything — a silent leak, not a categorization. The
  // rule row survives in the table so reactivating the envelope revives it.
  const activeNames = new Set(envelopes.map((e) => e.name.trim().toLowerCase()));
  const usable = ruleRows.filter(
    (r) => r.category === UNCATEGORIZED || activeNames.has(r.category.trim().toLowerCase())
  );

  return { envelopes, learnedRules: usable };
}
