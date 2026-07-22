/**
 * Refunds — money a merchant gives back.
 *
 * The app used to treat every positive non-transfer row as income, so a $240
 * Amazon return read as $240 earned. On this household's real data that was
 * $2,717 of phantom income (and $554 of genuinely-earned interest tangled into
 * the same population). A refund is negative spending, not earning: it must
 * reduce the envelope the purchase came out of, ideally in the month the
 * purchase was budgeted — a July payback of a June purchase belongs to June's
 * budget, which is recomputed on the fly, so reassigning the month reconciles
 * the past summary with no stored state.
 *
 * Classification of a positive, envelope-attributed row, in order:
 *   1. The merchant has NO outflow anywhere in history → income, not a refund.
 *      You can only be refunded by somewhere you spend; this is what keeps
 *      Wealthsimple "Interest received" (filed under Fees & Interest by the
 *      "INTEREST" keyword rule) counting as plain income instead of silently
 *      shrinking that envelope's spend.
 *   2. An outflow at the same merchant for the same amount within the lookback
 *      window → a matched refund, effective in the PURCHASE's month. Each
 *      purchase is consumed at most once, nearest-first, so two identical $21
 *      refunds pair with two distinct $21 charges rather than the same one.
 *   3. Outflows exist but none match exactly (a partial refund, or the
 *      purchase predates our data) → still a refund, effective in the month it
 *      landed — we know it's money back, we just can't prove which month's
 *      budget it belongs to.
 *
 * Pure and deterministic: rows are processed in (date, id) order so the same
 * history always yields the same pairing.
 */
import { normalizeDescription } from "@/lib/categorization";
import { budgetRows } from "@/lib/budget/transfers";

/** The fields classification actually reads — structural, so both the budget
 *  route's full rows and the reports route's narrower select qualify. */
export interface RefundSourceRow {
  id: string;
  date: string;
  description: string;
  amount: number;
  category: string | null;
  transferSource?: string | null;
  coverage?: string | null;
}

/** How far back a refund may reach for its originating purchase. */
export const REFUND_MATCH_WINDOW_DAYS = 90;

export interface RefundAssignment {
  /** "YYYY-MM" the refund counts against — the purchase's month when matched. */
  effectiveMonth: string;
  /** The consumed purchase row, when one matched; absent for fallback refunds. */
  matchedTxnId?: string;
}

/** Cent-safe equality for amounts that arrive as floats. */
function sameAmount(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.005;
}

function daysBetween(earlier: string, later: string): number {
  return (Date.parse(later) - Date.parse(earlier)) / 86_400_000;
}

/**
 * Classifies every refund in the history. Returns a map keyed by transaction
 * id; a positive envelope-attributed row NOT in the map was judged income.
 *
 * @param allTxns       full transaction history (transfers/coverage removed here)
 * @param envelopeNames the user's ACTIVE envelope names — a positive row only
 *                      nets against a budget that exists
 */
export function classifyRefunds(
  allTxns: RefundSourceRow[],
  envelopeNames: Set<string>
): Map<string, RefundAssignment> {
  const spendable = budgetRows(allTxns);

  // Outflows indexed by normalized merchant, oldest-first for the scan below.
  const outflowsByMerchant = new Map<
    string,
    { id: string; date: string; absAmount: number; consumed: boolean }[]
  >();
  for (const t of spendable) {
    if (t.amount >= 0) continue;
    const merchant = normalizeDescription(t.description);
    const list = outflowsByMerchant.get(merchant);
    const row = { id: t.id, date: t.date, absAmount: Math.abs(t.amount), consumed: false };
    if (list) list.push(row);
    else outflowsByMerchant.set(merchant, [row]);
  }
  for (const list of outflowsByMerchant.values()) {
    list.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : 1));
  }

  const candidates = spendable
    .filter((t) => t.amount > 0 && t.category !== null && envelopeNames.has(t.category))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : 1));

  const out = new Map<string, RefundAssignment>();
  for (const refund of candidates) {
    const outflows = outflowsByMerchant.get(normalizeDescription(refund.description));
    // Rule 1: no outflows at this merchant, ever → income, not a refund.
    if (!outflows || outflows.length === 0) continue;

    // Rule 2: nearest unconsumed same-amount purchase inside the window.
    let match: (typeof outflows)[number] | undefined;
    for (const purchase of outflows) {
      if (purchase.consumed) continue;
      if (purchase.date > refund.date) break; // sorted; nothing later can precede
      if (!sameAmount(purchase.absAmount, refund.amount)) continue;
      if (daysBetween(purchase.date, refund.date) > REFUND_MATCH_WINDOW_DAYS) continue;
      match = purchase; // keep scanning — later rows are nearer the refund
    }

    if (match) {
      match.consumed = true;
      out.set(refund.id, {
        effectiveMonth: match.date.slice(0, 7),
        matchedTxnId: match.id,
      });
    } else {
      // Rule 3: money back from a real merchant, month unprovable → lands here.
      out.set(refund.id, { effectiveMonth: refund.date.slice(0, 7) });
    }
  }
  return out;
}

/**
 * The month a row counts in: its refund's effective month, else its own date.
 */
export function effectiveMonth(
  t: { id: string; date: string },
  refunds: Map<string, RefundAssignment>
): string {
  return refunds.get(t.id)?.effectiveMonth ?? t.date.slice(0, 7);
}
