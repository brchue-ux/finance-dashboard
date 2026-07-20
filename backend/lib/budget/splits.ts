/**
 * Split validation.
 *
 * The load-bearing rule is that splits must sum to the parent transaction's
 * amount. If they don't, budget totals silently stop matching the bank — money
 * appears or vanishes, and the error compounds every month. That's worse than
 * refusing the edit, so this rejects rather than rounds.
 */

export interface SplitInput {
  category: string;
  amount: number;
  note?: string | null;
}

/**
 * Currency held as REAL, so exact equality would fail on ordinary arithmetic
 * (0.1 + 0.2 !== 0.3). Half a cent is far below anything that can be entered
 * and far above float noise on realistic amounts.
 */
export const SPLIT_SUM_EPSILON = 0.005;

export type SplitValidation =
  | { ok: true; splits: SplitInput[] }
  | { ok: false; error: string };

export function validateSplits(
  transactionAmount: number,
  input: unknown
): SplitValidation {
  if (!Array.isArray(input) || input.length === 0) {
    return { ok: false, error: "splits must be a non-empty array" };
  }
  if (input.length < 2) {
    // A single split is just the transaction's own category with extra rows to
    // keep in sync; clearing the splits expresses that better.
    return { ok: false, error: "a split needs at least two parts — clear the split instead" };
  }

  const splits: SplitInput[] = [];
  for (const [i, raw] of input.entries()) {
    const row = raw as Record<string, unknown>;
    const category = typeof row?.category === "string" ? row.category.trim() : "";
    const amount = Number(row?.amount);

    if (!category) return { ok: false, error: `split ${i + 1}: category is required` };
    if (!Number.isFinite(amount) || amount === 0) {
      return { ok: false, error: `split ${i + 1}: amount must be a non-zero number` };
    }
    // Mixed signs would let a "split" invent income out of a purchase.
    if (Math.sign(amount) !== Math.sign(transactionAmount)) {
      return {
        ok: false,
        error: `split ${i + 1}: amount must have the same sign as the transaction`,
      };
    }
    splits.push({
      category,
      amount,
      note: typeof row?.note === "string" && row.note.trim() ? row.note.trim() : null,
    });
  }

  const sum = splits.reduce((s, x) => s + x.amount, 0);
  if (Math.abs(sum - transactionAmount) > SPLIT_SUM_EPSILON) {
    return {
      ok: false,
      error: `splits total ${sum.toFixed(2)} but the transaction is ${transactionAmount.toFixed(
        2
      )} — they must match`,
    };
  }

  return { ok: true, splits };
}
