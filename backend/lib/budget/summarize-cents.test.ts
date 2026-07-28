/**
 * Migration guard: storing money as integer cents must not move a single figure
 * the budget reports.
 *
 * `summarize.test.ts` pins what the budget math MEANS and is deliberately not
 * touched by the cents migration. This file pins something narrower and
 * temporary-feeling but load-bearing: that routing every amount through the
 * `lib/money` seam on the way to storage and back leaves every summary output
 * bit-identical to the pre-migration float result.
 *
 * The simulation is honest about what the seam actually does — `toCents` on
 * write, `fromCents` on read — so a change to the rounding rule that shifted a
 * displayed figure would fail here rather than on someone's phone.
 */
import { describe, expect, it } from "vitest";

import { fromCents, toCents } from "@/lib/money";

import {
  summarizeEnvelopes,
  summarizeTotals,
  type AllocationRow,
  type EnvelopeRow,
  type SplitRow,
  type TransactionRow,
} from "./summarize";

/** What a value looks like after a write/read cycle through the money seam. */
const stored = (dollars: number) => fromCents(toCents(dollars));

const envelopes: EnvelopeRow[] = [
  { id: "e-groceries", name: "Groceries", monthlyTarget: 800, categoryRules: "[]" },
  { id: "e-transport", name: "Transport", monthlyTarget: 220.5, categoryRules: "[]" },
  { id: "e-dining", name: "Dining", monthlyTarget: 150.25, categoryRules: "[]" },
  { id: "e-utilities", name: "Utilities", monthlyTarget: 310.1, categoryRules: "[]" },
];

const allocations: AllocationRow[] = [
  { envelopeId: "e-groceries", allocated: 825.75 },
  { envelopeId: "e-dining", allocated: 0.1 },
];

// Representative of the real ledger: paycheques, a dense tail of small
// float-hostile amounts, a refund, a transfer, an out-of-coverage row, and
// values whose decimal parts do not sum cleanly in binary (0.1 + 0.2 ≠ 0.3).
const transactions: TransactionRow[] = [
  txn("t-pay-1", 2900, null),
  txn("t-pay-2", 1450.33, null),
  txn("t-g1", -113.28, "Groceries"),
  txn("t-g2", -65.34, "Groceries"),
  txn("t-g3", -0.1, "Groceries"),
  txn("t-g4", -0.2, "Groceries"),
  txn("t-g5", -0.3, "Groceries"),
  txn("t-g6", -109.42, "Groceries"),
  txn("t-tr1", -55.55, "Transport"),
  txn("t-tr2", -3.33, "Transport"),
  txn("t-tr3", -3.33, "Transport"),
  txn("t-tr4", -3.33, "Transport"),
  txn("t-d1", -87.65, "Dining"),
  txn("t-d2", -12.05, "Dining"),
  txn("t-u1", -310.1, "Utilities"),
  txn("t-uncat1", -49.99, null),
  txn("t-uncat2", -7.77, "uncategorized"),
  txn("t-orphan", -21.15, "Renamed Envelope"),
  { ...txn("t-transfer", -1200, null), transferSource: "rule" },
  { ...txn("t-outside", -999.99, "Groceries"), coverage: "partial" },
  txn("t-refund", 24.99, "Dining"),
];

const splits: SplitRow[] = [
  { transactionId: "t-g1", category: "Groceries", amount: -80.19 },
  { transactionId: "t-g1", category: "Utilities", amount: -33.09 },
];

const refundIds = new Set(["t-refund"]);

function txn(id: string, amount: number, category: string | null): TransactionRow {
  return {
    id,
    accountId: "acct-1",
    date: "2026-06-15",
    description: `row ${id}`,
    merchantName: null,
    amount,
    category,
  };
}

/** The same inputs after a round trip through integer-cent storage. */
const asStored = {
  envelopes: envelopes.map((e) => ({ ...e, monthlyTarget: stored(e.monthlyTarget) })),
  allocations: allocations.map((a) => ({ ...a, allocated: stored(a.allocated) })),
  transactions: transactions.map((t) => ({ ...t, amount: stored(t.amount) })),
  splits: splits.map((s) => ({ ...s, amount: stored(s.amount) })),
};

function summarize(input: {
  envelopes: EnvelopeRow[];
  allocations: AllocationRow[];
  transactions: TransactionRow[];
  splits: SplitRow[];
}) {
  const summaries = summarizeEnvelopes(
    input.envelopes,
    input.allocations,
    input.transactions,
    input.splits,
    undefined,
    refundIds
  );
  return {
    summaries,
    totals: summarizeTotals(summaries, input.transactions, input.splits, refundIds),
  };
}

describe("budget summary over integer-cent storage", () => {
  const before = summarize({ envelopes, allocations, transactions, splits });
  const after = summarize(asStored);

  it("produces identical envelope summaries", () => {
    expect(after.summaries).toEqual(before.summaries);
  });

  it("produces identical totals", () => {
    expect(after.totals).toEqual(before.totals);
  });

  it("keeps the canonical Spent figure identical", () => {
    expect(after.totals.totalOutflow).toBe(before.totals.totalOutflow);
    expect(after.totals.totalSpent).toBe(before.totals.totalSpent);
    expect(after.totals.unattributedSpent).toBe(before.totals.unattributedSpent);
  });

  it("keeps the reconciliation identity intact", () => {
    // The invariant the migration exists to protect: outflow splits cleanly into
    // the part that reached an envelope and the part that did not.
    expect(after.totals.totalOutflow - after.totals.unattributedSpent).toBeCloseTo(
      after.totals.totalSpent,
      10
    );
    expect(after.totals.saved).toBe(after.totals.totalIncome - after.totals.totalOutflow);
  });

  it("exercises data the seam could plausibly have disturbed", () => {
    // Guard against the fixtures quietly becoming trivial: if every amount were
    // a clean two-decimal value with no splits or refunds, this file would pass
    // while proving nothing.
    expect(asStored.transactions.length).toBeGreaterThan(15);
    expect(asStored.splits.length).toBeGreaterThan(0);
    expect(before.totals.unattributedSpent).toBeGreaterThan(0);
    expect(before.totals.totalIncome).toBeGreaterThan(0);
  });
});

describe("storage round trip on representative ledger values", () => {
  it("returns every amount unchanged", () => {
    for (const t of transactions) expect(stored(t.amount)).toBe(t.amount);
    for (const s of splits) expect(stored(s.amount)).toBe(s.amount);
    for (const e of envelopes) expect(stored(e.monthlyTarget)).toBe(e.monthlyTarget);
    for (const a of allocations) expect(stored(a.allocated)).toBe(a.allocated);
  });
});
