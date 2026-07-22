/**
 * Pace and "typical" math — build-reminders item 6d.
 *
 * Two framings, because a target derived from a 17-month average makes "over
 * budget" the normal state (half of all months are above their own average by
 * definition), so pass/fail is the wrong default:
 *
 *   - PACE (the default budget view): within the current month, is spend ahead
 *     of or behind the straight-line burn of the target? A $600 target on day 15
 *     of 30 "expects" $300 by now; $400 spent is ahead of pace, $200 is behind.
 *     For a completed past month the fraction is 1, so this degrades exactly to
 *     spent-vs-target.
 *
 *   - TYPICAL (the deeper dig, on tapping an envelope): is this month running
 *     hotter or cooler than the user's OWN normal for that category, measured
 *     from their real history rather than a set limit.
 *
 * Pure and deterministic; the clock is injected so pace is testable.
 */
import { budgetRows } from "@/lib/budget/transfers";
import { attributeSpend, type TransactionRow, type SplitRow } from "@/lib/budget/summarize";
import { effectiveMonth, type RefundAssignment } from "@/lib/budget/refunds";

/**
 * Fraction of the given month that has elapsed as of `now`, in [0, 1].
 *   - a month entirely in the past → 1 (fully elapsed)
 *   - a month entirely in the future → 0
 *   - the current month → day-of-month / days-in-month (the current day counts,
 *     so day 15 of a 30-day month is 0.5)
 */
export function monthElapsedFraction(year: number, month: number, now: Date): number {
  const nowY = now.getFullYear();
  const nowM = now.getMonth() + 1; // 1-based to match `month`
  if (nowY > year || (nowY === year && nowM > month)) return 1;
  if (nowY < year || (nowY === year && nowM < month)) return 0;
  const daysInMonth = new Date(year, month, 0).getDate();
  return now.getDate() / daysInMonth;
}

export interface TypicalSpend {
  /** Average monthly spend for this category over the observed window. */
  monthlyAverage: number;
  /** How many distinct months of history back that average — a confidence hint. */
  monthsObserved: number;
}

/**
 * Per-category "typical" monthly spend from the user's real history.
 *
 * Averaged over the distinct months present in the window, EXCLUDING the month
 * being viewed — comparing a month against an average that includes itself would
 * blunt exactly the signal we want. Uses the same divisor (all observed months)
 * for every category, matching how the user's targets were derived, so "typical"
 * and "target" are the same kind of number and the comparison is honest.
 *
 * @param allTxns every stored transaction; transfers / out-of-coverage removed here
 * @param splits  per-envelope attribution, so a split month counts per category
 */
export function computeTypicalSpend(
  allTxns: TransactionRow[],
  splits: SplitRow[],
  excludeYear: number,
  excludeMonth: number,
  refunds: Map<string, RefundAssignment> = new Map()
): Map<string, TypicalSpend> {
  const spendable = budgetRows(allTxns);
  const excludeKey = `${excludeYear}-${String(excludeMonth).padStart(2, "0")}`;

  const months = new Set<string>();
  const totals = new Map<string, number>();

  for (const a of attributeSpend(spendable, splits)) {
    // Outflows add; refunds subtract, in their PURCHASE's month — otherwise a
    // returned $240 order permanently inflates that category's "typical".
    const isRefund = refunds.has(a.transaction.id);
    if (a.amount >= 0 && !isRefund) continue;
    const month = effectiveMonth(a.transaction, refunds);
    if (month === excludeKey) continue;
    if (a.category === null) continue;
    months.add(month);
    totals.set(a.category, (totals.get(a.category) ?? 0) - a.amount);
  }

  const monthCount = months.size;
  const out = new Map<string, TypicalSpend>();
  if (monthCount === 0) return out; // no history to compare against

  for (const [category, total] of totals) {
    out.set(category, { monthlyAverage: total / monthCount, monthsObserved: monthCount });
  }
  return out;
}
