/**
 * 6d's whole point is that a target which is itself an average makes half of all
 * months read as "over". These tests pin the two framings that replace pass/fail:
 * pace within the current month (which must degrade cleanly to spent-vs-target
 * for a finished month), and a "typical" that excludes the month being viewed so
 * the comparison isn't blunted by including itself.
 */
import { describe, it, expect } from "vitest";
import { monthElapsedFraction, computeTypicalSpend } from "./pace";
import type { TransactionRow, SplitRow } from "./summarize";

describe("monthElapsedFraction", () => {
  it("is day/daysInMonth for the current month", () => {
    // 30-day month, day 15 → half elapsed.
    expect(monthElapsedFraction(2026, 6, new Date(2026, 5, 15))).toBeCloseTo(15 / 30);
  });

  it("is 1 for a month fully in the past", () => {
    expect(monthElapsedFraction(2026, 5, new Date(2026, 6, 3))).toBe(1);
    expect(monthElapsedFraction(2025, 12, new Date(2026, 0, 1))).toBe(1);
  });

  it("is 0 for a month in the future", () => {
    expect(monthElapsedFraction(2026, 8, new Date(2026, 5, 15))).toBe(0);
  });
});

function txn(over: Partial<TransactionRow>): TransactionRow {
  return {
    id: Math.random().toString(36),
    accountId: "a",
    date: "2026-06-01",
    description: "X",
    merchantName: null,
    amount: -10,
    category: "Groceries",
    transferSource: null,
    coverage: null,
    ...over,
  };
}

describe("computeTypicalSpend", () => {
  it("averages a category over the distinct months present", () => {
    const txns = [
      txn({ date: "2026-04-10", amount: -100, category: "Groceries" }),
      txn({ date: "2026-05-10", amount: -300, category: "Groceries" }),
    ];
    // Viewing June, which has no rows here — both April and May count.
    const typical = computeTypicalSpend(txns, [], 2026, 6);

    expect(typical.get("Groceries")).toEqual({ monthlyAverage: 200, monthsObserved: 2 });
  });

  it("excludes the month being viewed from its own average", () => {
    const txns = [
      txn({ date: "2026-04-10", amount: -100, category: "Groceries" }),
      txn({ date: "2026-06-10", amount: -900, category: "Groceries" }), // the viewed month
    ];
    const typical = computeTypicalSpend(txns, [], 2026, 6);

    // Only April contributes; the $900 June spike does not inflate its own "typical".
    expect(typical.get("Groceries")).toEqual({ monthlyAverage: 100, monthsObserved: 1 });
  });

  it("drops transfers and out-of-coverage rows, like the budget math", () => {
    const txns = [
      txn({ date: "2026-04-10", amount: -100, category: "Groceries" }),
      txn({ date: "2026-05-10", amount: -500, category: "Groceries", transferSource: "e-transfer" }),
      txn({ date: "2026-05-11", amount: -500, category: "Groceries", coverage: "out" }),
    ];
    const typical = computeTypicalSpend(txns, [], 2026, 6);

    // Only the April row survives; the transfer and out-of-coverage rows are neither.
    expect(typical.get("Groceries")).toEqual({ monthlyAverage: 100, monthsObserved: 1 });
  });

  it("follows splits so a split month counts per category", () => {
    const parent = txn({ id: "p", date: "2026-04-10", amount: -100, category: "Groceries" });
    const splits: SplitRow[] = [
      { transactionId: "p", category: "Groceries", amount: -60 },
      { transactionId: "p", category: "Home & Hardware", amount: -40 },
    ];
    const typical = computeTypicalSpend([parent], splits, 2026, 6);

    expect(typical.get("Groceries")?.monthlyAverage).toBe(60);
    expect(typical.get("Home & Hardware")?.monthlyAverage).toBe(40);
  });

  it("returns nothing when there is no prior history", () => {
    const txns = [txn({ date: "2026-06-10", amount: -100, category: "Groceries" })];
    const typical = computeTypicalSpend(txns, [], 2026, 6);

    expect(typical.size).toBe(0);
  });
});
