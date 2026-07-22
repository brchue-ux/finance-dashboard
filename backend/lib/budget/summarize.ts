/**
 * Budget math, extracted from /api/budget so it can be tested directly.
 *
 * This is the money logic: it decides what counts as spent, what counts as over
 * budget, and which transactions get surfaced as notable. A wrong answer here
 * is plausible-looking rather than obviously broken, which is exactly why it
 * needs tests rather than eyeballing.
 */
import { budgetRows } from "@/lib/budget/transfers";

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
  /** Either being non-null holds this row out of every figure here — a transfer
   *  between the user's own accounts, or a period we lack other accounts for.
   *  See lib/budget/transfers.ts. */
  transferSource?: string | null;
  coverage?: string | null;
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
  /** 6d pace/typical fields — present only when the caller supplies the context
   *  (the budget route does; unit callers and tests stay unchanged). */
  monthFraction?: number;
  /** allocated × monthFraction — the straight-line spend expected by now. */
  expectedByNow?: number;
  /** The user's own average monthly spend for this category; null with no history. */
  typicalMonthly?: number | null;
  /** How many months of history that average rests on. */
  typicalMonths?: number;
  [key: string]: unknown;
}

/** Optional 6d context: how far through the month, and per-category history. */
export interface PaceContext {
  monthFraction: number;
  typicalByCategory: Map<string, { monthlyAverage: number; monthsObserved: number }>;
}

/** Starting constant; expected to be tuned once there's real usage to tune against. */
export const NOTABLE_SHARE = 0.15;
export const NOTABLE_CAP_PER_CATEGORY = 3;

export function summarizeEnvelopes(
  envelopes: EnvelopeRow[],
  allocations: AllocationRow[],
  monthTxns: TransactionRow[],
  splits: SplitRow[] = [],
  pace?: PaceContext,
  refundIds: Set<string> = new Set()
): EnvelopeSummary[] {
  // A per-month allocation overrides the envelope's standing target, which is
  // how reallocation works without rewriting the envelope itself.
  const allocationMap = new Map(allocations.map((a) => [a.envelopeId, a.allocated]));
  const attributed = attributeSpend(budgetRows(monthTxns), splits);

  return envelopes.map((env) => {
    const allocated = allocationMap.get(env.id) ?? env.monthlyTarget;
    // Outflows count toward spent; a refund (a positive row lib/budget/refunds
    // classified) counts AGAINST it — negative spending, not income. Netted
    // here, at the one place spent is defined, so a refund-heavy month can go
    // below zero honestly rather than being floored into fiction.
    const spent = attributed
      .filter((a) => a.category === env.name && (a.amount < 0 || refundIds.has(a.transaction.id)))
      .reduce((sum, a) => sum - a.amount, 0);

    // "Unconfigured" must mean "never set up", NOT "budgeted $0 this month".
    // A 0 standing target means not set up yet, and reporting that as over
    // budget makes every fresh envelope look breached the moment it has any
    // spending. But once reallocation can write an allocation row, $0 becomes
    // a deliberate choice — and treating that as unconfigured suppressed the
    // overBudget flag below, hiding real overspend behind a neutral "not set
    // up" chip. An explicit allocation row is configuration, even at zero.
    const hasAllocation = allocationMap.has(env.id);
    const unconfigured = !hasAllocation && allocated <= 0;

    // 6d — attached only when the caller passes pace context. Kept off the base
    // shape so unit callers and existing tests are untouched.
    const paceFields = pace
      ? (() => {
          const typical = pace.typicalByCategory.get(env.name);
          return {
            monthFraction: pace.monthFraction,
            expectedByNow: allocated * pace.monthFraction,
            typicalMonthly: typical?.monthlyAverage ?? null,
            typicalMonths: typical?.monthsObserved ?? 0,
          };
        })()
      : {};

    return {
      ...env,
      categoryRules: JSON.parse(env.categoryRules) as string[],
      allocated,
      spent,
      unconfigured,
      remaining: unconfigured ? 0 : allocated - spent,
      overBudget: !unconfigured && spent > allocated,
      ...paceFields,
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
  const attributed = attributeSpend(budgetRows(monthTxns), splits);

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

export function summarizeTotals(
  summaries: EnvelopeSummary[],
  monthTxns: TransactionRow[],
  splits: SplitRow[] = [],
  refundIds: Set<string> = new Set()
) {
  // Removed once, here, rather than subtracted from each total below: income,
  // outflow, unattributed spend and `saved` all derive from these same rows, so
  // one filter makes every figure correct by construction instead of by four
  // separate edits that have to agree.
  const spendable = budgetRows(monthTxns);
  const attributed = attributeSpend(spendable, splits);
  const envelopeNames = new Set(summaries.map((e) => e.name));

  // Spend that landed in an envelope. Excludes anything the categorization
  // engine could not place, by construction.
  const totalSpent = summaries.reduce((s, e) => s + e.spent, 0);

  // Spend that landed nowhere: no category at all, "uncategorized", or a
  // category naming no envelope (a bank's own label from a CSV import, or an
  // envelope that was renamed out from under it). Every outflow is in exactly
  // one of these two buckets.
  const unattributedSpent = attributed
    .filter((a) => a.amount < 0 && !(a.category !== null && envelopeNames.has(a.category)))
    .reduce((s, a) => s + Math.abs(a.amount), 0);

  // Computed independently rather than as totalSpent + unattributedSpent, so
  // the two halves are cross-checkable instead of reconciling by definition.
  // Refunds net against outflow with the same sign convention as in
  // summarizeEnvelopes, so `totalOutflow - unattributedSpent === totalSpent`
  // stays a checkable identity.
  const totalOutflow = attributed
    .filter((a) => a.amount < 0 || refundIds.has(a.transaction.id))
    .reduce((s, a) => s - a.amount, 0);

  const totalAllocated = summaries.reduce((s, e) => s + e.allocated, 0);
  // A refund is not earning — it already reduced its envelope above. Positive
  // rows that are NOT refunds (paycheques, and interest received even when a
  // keyword rule filed it under an envelope) are the income. Both sides of
  // `saved` move by the same amount, so it is unchanged by construction.
  const totalIncome = spendable
    .filter((t) => t.amount > 0 && !refundIds.has(t.id))
    .reduce((s, t) => s + t.amount, 0);

  return {
    totalSpent,
    unattributedSpent,
    totalOutflow,
    totalAllocated,
    totalIncome,
    remaining: totalAllocated - totalSpent,
    // Against ALL money that left, not just the part that reached an envelope.
    // This used to be totalIncome - totalSpent, which silently treated every
    // uncategorized dollar as saved: with 925 uncategorized transactions worth
    // $72.7k on real data, the home screen reported a large positive net
    // position for a month that was actually negative. Categorization coverage
    // is a display concern; it must not change what the arithmetic says left
    // the account.
    saved: totalIncome - totalOutflow,
    // Lets the client distinguish "nothing budgeted yet" from "budgeted zero",
    // instead of rendering -Spent as if it were overspend.
    configuredEnvelopes: summaries.filter((e) => !e.unconfigured).length,
    totalEnvelopes: summaries.length,
  };
}
