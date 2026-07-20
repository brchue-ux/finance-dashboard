/**
 * Budget math, extracted from /api/budget so it can be tested directly.
 *
 * This is the money logic: it decides what counts as spent, what counts as over
 * budget, and which transactions get surfaced as notable. A wrong answer here
 * is plausible-looking rather than obviously broken, which is exactly why it
 * needs tests rather than eyeballing.
 */

/** Envelope row as stored — categoryRules is still JSON text at this point. */
export interface EnvelopeRow {
  id: string;
  name: string;
  monthlyTarget: number;
  categoryRules: string;
  [key: string]: unknown;
}

export interface AllocationRow {
  envelopeId: string;
  allocated: number;
}

export interface TransactionRow {
  id: string;
  accountId: string;
  date: string;
  description: string;
  merchantName: string | null;
  amount: number;
  category: string | null;
}

export interface SplitRow {
  transactionId: string;
  category: string;
  amount: number;
}

/**
 * Resolves each transaction into the (category, amount) pairs that actually
 * count against envelopes.
 *
 * A split transaction is replaced entirely by its splits — never counted both
 * ways, which would double-count the spend. An unsplit transaction keeps its
 * own category, so nothing existing changes behaviour.
 */
export function attributeSpend<
  T extends { id: string; amount: number; category: string | null },
>(
  monthTxns: T[],
  splits: SplitRow[]
): { transaction: T; category: string | null; amount: number }[] {
  const byTransaction = new Map<string, SplitRow[]>();
  for (const s of splits) {
    const list = byTransaction.get(s.transactionId);
    if (list) list.push(s);
    else byTransaction.set(s.transactionId, [s]);
  }

  const out: { transaction: T; category: string | null; amount: number }[] = [];
  for (const t of monthTxns) {
    const rows = byTransaction.get(t.id);
    if (rows && rows.length > 0) {
      for (const s of rows) out.push({ transaction: t, category: s.category, amount: s.amount });
    } else {
      out.push({ transaction: t, category: t.category, amount: t.amount });
    }
  }
  return out;
}

export interface EnvelopeSummary {
  id: string;
  name: string;
  monthlyTarget: number;
  categoryRules: string[];
  allocated: number;
  spent: number;
  /** No target set — distinct from "budgeted zero and overspent". */
  unconfigured: boolean;
  remaining: number;
  overBudget: boolean;
  [key: string]: unknown;
}

/** Starting constant; expected to be tuned once there's real usage to tune against. */
export const NOTABLE_SHARE = 0.15;
export const NOTABLE_CAP_PER_CATEGORY = 3;

export function summarizeEnvelopes(
  envelopes: EnvelopeRow[],
  allocations: AllocationRow[],
  monthTxns: TransactionRow[],
  splits: SplitRow[] = []
): EnvelopeSummary[] {
  // A per-month allocation overrides the envelope's standing target, which is
  // how reallocation works without rewriting the envelope itself.
  const allocationMap = new Map(allocations.map((a) => [a.envelopeId, a.allocated]));
  const attributed = attributeSpend(monthTxns, splits);

  return envelopes.map((env) => {
    const allocated = allocationMap.get(env.id) ?? env.monthlyTarget;
    const spent = attributed
      .filter((a) => a.category === env.name && a.amount < 0)
      .reduce((sum, a) => sum + Math.abs(a.amount), 0);

    // A 0 target means "not set up yet". Reporting that as over budget makes
    // every fresh envelope look breached the moment it has any spending.
    const unconfigured = allocated <= 0;

    return {
      ...env,
      categoryRules: JSON.parse(env.categoryRules) as string[],
      allocated,
      spent,
      unconfigured,
      remaining: unconfigured ? 0 : allocated - spent,
      overBudget: !unconfigured && spent > allocated,
    };
  });
}

export interface NotableCategory {
  category: string;
  allocated: number;
  transactions: {
    id: string;
    accountId: string;
    date: string;
    description: string;
    merchantName: string | null;
    amount: number;
    shareOfAllocation: number;
  }[];
}

/**
 * One card per category, capped per category, biggest first. Share is measured
 * against that envelope's own allocation so it scales by bucket size on its own
 * — 15% of a $2,000 grocery budget and 15% of a $100 entertainment budget are
 * naturally different dollar amounts, with no separate formula.
 */
export function computeNotableTransactions(
  summaries: EnvelopeSummary[],
  monthTxns: TransactionRow[],
  splits: SplitRow[] = []
): NotableCategory[] {
  // Measured per split, not per transaction: a $200 shop split 50/50 across two
  // envelopes is two ordinary charges, not one outsized one. Using the parent
  // total would flag it in both.
  const attributed = attributeSpend(monthTxns, splits);

  return summaries
    .filter((env) => env.allocated > 0)
    .map((env) => ({
      category: env.name,
      allocated: env.allocated,
      transactions: attributed
        .filter(
          (a) =>
            a.category === env.name &&
            a.amount < 0 &&
            Math.abs(a.amount) / env.allocated >= NOTABLE_SHARE
        )
        .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
        .slice(0, NOTABLE_CAP_PER_CATEGORY)
        .map((a) => ({
          id: a.transaction.id,
          accountId: a.transaction.accountId,
          date: a.transaction.date,
          description: a.transaction.description,
          merchantName: a.transaction.merchantName,
          amount: a.amount,
          shareOfAllocation: Math.abs(a.amount) / env.allocated,
        })),
    }))
    .filter((c) => c.transactions.length > 0);
}

export function summarizeTotals(summaries: EnvelopeSummary[], monthTxns: TransactionRow[]) {
  const totalSpent = summaries.reduce((s, e) => s + e.spent, 0);
  const totalAllocated = summaries.reduce((s, e) => s + e.allocated, 0);
  const totalIncome = monthTxns.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0);

  return {
    totalSpent,
    totalAllocated,
    totalIncome,
    remaining: totalAllocated - totalSpent,
    saved: totalIncome - totalSpent,
    // Lets the client distinguish "nothing budgeted yet" from "budgeted zero",
    // instead of rendering -Spent as if it were overspend.
    configuredEnvelopes: summaries.filter((e) => !e.unconfigured).length,
    totalEnvelopes: summaries.length,
  };
}
