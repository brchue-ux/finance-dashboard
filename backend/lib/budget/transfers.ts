/**
 * Transfers — money moving between the user's own accounts.
 *
 * The app used to decide what a transaction *was* from one fact: whether the
 * amount was positive or negative. Positive meant income, negative meant
 * spending. That is wrong for a whole class of transaction, and on real data it
 * was wrong about most of the money:
 *
 *   - Paying a credit card appears as a positive row on the card (looks like
 *     income) and a negative row on the chequing account (looks like spending).
 *     One real event, counted twice, on opposite sides. On this household's
 *     real data that single pattern was $90,197 of phantom "income".
 *   - Moving cash into an investment account is not spending; taking it back
 *     out is not income.
 *
 * A transfer is neither earning nor spending, so it must be excluded from both.
 * Netting it out is not enough — the money genuinely leaves one account and
 * arrives at another, so both totals have to ignore it or each is individually
 * wrong even when the bottom line happens to look right.
 *
 * Patterns are per-user and user-editable rather than shipped as defaults. The
 * strings involved are specific to one person's banks ("Bill Payment - ROYAL
 * BANK VISA"), and per the user's standing principle the app proposes, it does
 * not impose. `SUGGESTED_TRANSFER_PATTERNS` exists to seed that proposal, not
 * to be applied behind anyone's back.
 */
import { normalizeDescription } from "@/lib/categorization";

/**
 * Why a transaction is marked a transfer. Non-null on a transaction means it is
 * one; the value records what decided that, so a user correction is
 * distinguishable from a rule match and cannot be silently undone by a re-run.
 */
export type TransferSource = "rule" | "manual";

/**
 * Does this description match any of the user's transfer patterns?
 *
 * Matching is substring-on-normalized-text rather than the token/specificity
 * matching `categorize()` does. The two are answering different questions:
 * categorization picks the best of many competing envelopes, so it needs
 * specificity ranking. This is a yes/no about one property, and the patterns
 * are distinctive payee names, so the extra machinery would buy nothing.
 *
 * Note the shared normalization: descriptions have digit-runs like `#1234`
 * stripped, so a pattern written with an account or branch number in it can
 * never match. Same gotcha as the envelope rules.
 */
export function matchesTransferPattern(description: string, patterns: string[]): boolean {
  const haystack = normalizeDescription(description);
  if (!haystack) return false;

  return patterns.some((p) => {
    const needle = normalizeDescription(p);
    return needle !== "" && haystack.includes(needle);
  });
}

/**
 * The rows a budget total is allowed to see.
 *
 * Applied at the entry of each summarize function rather than patched into
 * each total separately: income, outflow, unattributed spend, per-envelope
 * spend and `saved` all derive from the same rows, so removing them once makes
 * every downstream figure correct by construction instead of by five agreeing
 * edits.
 *
 * Two reasons a row is held back, and they are genuinely different questions:
 *
 *   transferSource — this is money moving between the user's own accounts, so
 *     it is neither earning nor spending no matter when it happened.
 *   coverage — this period predates the data we hold from other accounts. The
 *     row is real and correctly categorized; it just cannot be added to a month
 *     whose other accounts are missing, or the month reads as though the
 *     household earned $40 and spent nothing.
 */
export function budgetRows<T extends { transferSource?: string | null; coverage?: string | null }>(
  rows: T[]
): T[] {
  return rows.filter((r) => !r.transferSource && !r.coverage);
}

/**
 * Starting points for the proposal shown to a user, derived from real Canadian
 * bank exports. NOT applied automatically and NOT a default rule set.
 *
 * Deliberately excludes bare "Bill Payment": on real data that prefix covers
 * the city tax bill, the gas bill and the phone bill, which are ordinary
 * spending. Only the payee makes it a transfer, so only the payee is matched.
 */
export const SUGGESTED_TRANSFER_PATTERNS: { pattern: string; why: string }[] = [
  { pattern: "PAYMENT - THANK YOU", why: "Credit card payment received (card side)" },
  { pattern: "PAIEMENT - MERCI", why: "Credit card payment received, French statement text" },
  { pattern: "ROYAL BANK VISA", why: "Paying a Royal Bank Visa from a chequing account" },
  { pattern: "TANGERINE CREDIT CARD PAYMENT", why: "Paying a Tangerine card" },
  { pattern: "WS INVESTMENTS", why: "Cash moving to or from Wealthsimple" },
];
