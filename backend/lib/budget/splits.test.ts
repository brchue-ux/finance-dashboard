/**
 * Split validation guards the one rule that makes splits safe: they must sum to
 * the parent transaction. A violation doesn't crash — it silently desyncs the
 * budget from the bank, and compounds every month.
 */
import { describe, it, expect } from "vitest";
import { validateSplits, SPLIT_SUM_EPSILON } from "./splits";

const ok = (r: ReturnType<typeof validateSplits>) => {
  if (!r.ok) throw new Error(`expected valid, got: ${r.error}`);
  return r.splits;
};

describe("validateSplits — the sum invariant", () => {
  it("accepts splits that sum to the transaction amount", () => {
    const r = validateSplits(-200, [
      { category: "Groceries", amount: -150 },
      { category: "Shopping", amount: -50 },
    ]);
    expect(ok(r)).toHaveLength(2);
  });

  it("rejects splits that sum to less than the transaction", () => {
    // Money would vanish from the budget without ever leaving the bank.
    const r = validateSplits(-200, [
      { category: "Groceries", amount: -150 },
      { category: "Shopping", amount: -40 },
    ]);
    expect(r.ok).toBe(false);
  });

  it("rejects splits that sum to more than the transaction", () => {
    const r = validateSplits(-200, [
      { category: "Groceries", amount: -150 },
      { category: "Shopping", amount: -60 },
    ]);
    expect(r.ok).toBe(false);
  });

  it("tolerates float noise within half a cent", () => {
    // 0.1 + 0.2 !== 0.3 in IEEE754; exact equality would reject valid input.
    const r = validateSplits(-0.3, [
      { category: "A", amount: -0.1 },
      { category: "B", amount: -0.2 },
    ]);
    expect(r.ok).toBe(true);
  });

  it("rejects a discrepancy larger than the epsilon", () => {
    const r = validateSplits(-100, [
      { category: "A", amount: -50 },
      { category: "B", amount: -50 - SPLIT_SUM_EPSILON * 4 },
    ]);
    expect(r.ok).toBe(false);
  });
});

describe("validateSplits — sign handling", () => {
  it("rejects a positive part on a spend transaction", () => {
    // Otherwise a "split" could conjure income out of a purchase.
    const r = validateSplits(-100, [
      { category: "Groceries", amount: -150 },
      { category: "Shopping", amount: 50 },
    ]);
    expect(r.ok).toBe(false);
  });

  it("supports splitting an inflow", () => {
    const r = validateSplits(300, [
      { category: "Salary", amount: 250 },
      { category: "Bonus", amount: 50 },
    ]);
    expect(ok(r)).toHaveLength(2);
  });
});

describe("validateSplits — shape", () => {
  it("rejects an empty array", () => {
    expect(validateSplits(-100, []).ok).toBe(false);
  });

  it("rejects a non-array", () => {
    expect(validateSplits(-100, undefined).ok).toBe(false);
    expect(validateSplits(-100, { category: "A", amount: -100 }).ok).toBe(false);
  });

  it("rejects a single-part split", () => {
    // That's just the transaction's own category, with rows to keep in sync.
    expect(validateSplits(-100, [{ category: "Groceries", amount: -100 }]).ok).toBe(false);
  });

  it("rejects a missing category", () => {
    expect(
      validateSplits(-100, [
        { category: "  ", amount: -50 },
        { category: "B", amount: -50 },
      ]).ok
    ).toBe(false);
  });

  it("rejects a zero amount", () => {
    expect(
      validateSplits(-100, [
        { category: "A", amount: 0 },
        { category: "B", amount: -100 },
      ]).ok
    ).toBe(false);
  });

  it("rejects a sub-cent split even when the set sums exactly", () => {
    // -5.005 and -4.995 sum to exactly -10.00 and pass the sum check, but
    // storage quantizes each row on its own: -501¢ and -500¢ = -$10.01. The set
    // would stop summing to its parent with nothing left to notice it.
    const r = validateSplits(-10, [
      { category: "Groceries", amount: -5.005 },
      { category: "Shopping", amount: -4.995 },
    ]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/whole number of cents/);
  });

  it("still accepts ordinary two-decimal splits", () => {
    const s = ok(
      validateSplits(-10.01, [
        { category: "Groceries", amount: -5.01 },
        { category: "Shopping", amount: -5 },
      ])
    );
    expect(s.map((x) => x.amount)).toEqual([-5.01, -5]);
  });

  it("rejects an amount too large to represent as cents", () => {
    // Would otherwise reach toCents and throw a RangeError, i.e. a 500.
    expect(
      validateSplits(-100, [
        { category: "A", amount: -1e20 },
        { category: "B", amount: 1e20 - 100 },
      ]).ok
    ).toBe(false);
  });

  it("trims categories and normalizes blank notes to null", () => {
    const s = ok(
      validateSplits(-100, [
        { category: " Groceries ", amount: -60, note: "  " },
        { category: "Shopping", amount: -40, note: " dog food " },
      ])
    );
    expect(s[0].category).toBe("Groceries");
    expect(s[0].note).toBeNull();
    expect(s[1].note).toBe("dog food");
  });
});
