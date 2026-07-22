import { describe, it, expect } from "vitest";
import { classifyRefunds, effectiveMonth } from "@/lib/budget/refunds";
import type { TransactionRow } from "@/lib/budget/summarize";

const ENVELOPES = new Set(["Shopping", "Fees & Interest", "Home & Hardware"]);

function txn(over: Partial<TransactionRow> & Pick<TransactionRow, "id" | "date" | "amount">): TransactionRow {
  return {
    accountId: "acct1",
    description: "AMZN Mktp CA 866-216-1072",
    merchantName: null,
    category: "Shopping",
    transferSource: null,
    coverage: null,
    ...over,
  };
}

describe("classifyRefunds", () => {
  it("matches a refund to its same-amount purchase and reassigns the month", () => {
    const purchase = txn({ id: "p1", date: "2026-06-20", amount: -239.51 });
    const refund = txn({ id: "r1", date: "2026-07-14", amount: 239.51 });
    const map = classifyRefunds([purchase, refund], ENVELOPES);
    expect(map.get("r1")).toEqual({ effectiveMonth: "2026-06", matchedTxnId: "p1" });
  });

  it("treats a positive row at a merchant with no outflow history as income — the Interest received case", () => {
    const rows = [
      txn({ id: "i1", date: "2026-06-01", amount: 40.41, description: "Interest received (Chequing)", category: "Fees & Interest" }),
      // Unrelated outflow at a DIFFERENT merchant must not rescue the match.
      txn({ id: "p1", date: "2026-05-20", amount: -40.41 }),
    ];
    expect(classifyRefunds(rows, ENVELOPES).has("i1")).toBe(false);
  });

  it("falls back to the landing month for a partial refund (merchant known, amount unmatched)", () => {
    const rows = [
      txn({ id: "p1", date: "2026-06-20", amount: -100 }),
      txn({ id: "r1", date: "2026-07-02", amount: 33.33 }),
    ];
    expect(classifyRefunds(rows, ENVELOPES).get("r1")).toEqual({ effectiveMonth: "2026-07" });
  });

  it("consumes each purchase once: two identical refunds pair with two distinct charges", () => {
    // Real pattern: 21.46 refunded on consecutive days against two 21.46 charges.
    const rows = [
      txn({ id: "p1", date: "2026-05-01", amount: -21.46 }),
      txn({ id: "p2", date: "2026-05-15", amount: -21.46 }),
      txn({ id: "r1", date: "2026-06-08", amount: 21.46 }),
      txn({ id: "r2", date: "2026-06-09", amount: 21.46 }),
    ];
    const map = classifyRefunds(rows, ENVELOPES);
    const matched = [map.get("r1")!.matchedTxnId, map.get("r2")!.matchedTxnId];
    expect(new Set(matched).size).toBe(2);
    // Nearest-first: the first-processed refund takes the LATER purchase.
    expect(map.get("r1")!.matchedTxnId).toBe("p2");
  });

  it("does not reach past the match window", () => {
    const rows = [
      txn({ id: "p1", date: "2026-01-01", amount: -50 }),
      txn({ id: "r1", date: "2026-07-01", amount: 50 }),
    ];
    // >90 days: merchant is known, so still a refund, but month unprovable.
    expect(classifyRefunds(rows, ENVELOPES).get("r1")).toEqual({ effectiveMonth: "2026-07" });
  });

  it("never matches a purchase dated after the refund", () => {
    const rows = [
      txn({ id: "p1", date: "2026-07-20", amount: -60 }),
      txn({ id: "r1", date: "2026-07-10", amount: 60 }),
    ];
    expect(classifyRefunds(rows, ENVELOPES).get("r1")).toEqual({ effectiveMonth: "2026-07" });
  });

  it("ignores positive rows not attributed to an active envelope", () => {
    const rows = [
      txn({ id: "p1", date: "2026-06-01", amount: -500, description: "EMPLOYER PAYROLL" }),
      txn({ id: "r1", date: "2026-06-15", amount: 500, description: "EMPLOYER PAYROLL", category: "uncategorized" }),
      txn({ id: "r2", date: "2026-06-16", amount: 25, category: null }),
    ];
    const map = classifyRefunds(rows, ENVELOPES);
    expect(map.size).toBe(0);
  });

  it("excludes transfers and out-of-coverage rows on both sides", () => {
    const rows = [
      txn({ id: "p1", date: "2026-06-20", amount: -80, transferSource: "rule" }),
      txn({ id: "r1", date: "2026-07-01", amount: 80 }),
      txn({ id: "r2", date: "2026-07-02", amount: 15, coverage: "out_of_coverage" }),
    ];
    const map = classifyRefunds(rows, ENVELOPES);
    // p1 is a transfer, so the merchant has no REAL outflows → r1 is income.
    expect(map.has("r1")).toBe(false);
    expect(map.has("r2")).toBe(false);
  });

  it("matches across description punctuation via the shared normalization", () => {
    const rows = [
      txn({ id: "p1", date: "2026-06-01", amount: -81.9, description: "RONA+ NIAGARA FALLS 83 NIAGARA FALLS", category: "Home & Hardware" }),
      txn({ id: "r1", date: "2026-06-20", amount: 81.9, description: "RONA+ NIAGARA FALLS 83 NIAGARA FALLS", category: "Home & Hardware" }),
    ];
    expect(classifyRefunds(rows, ENVELOPES).get("r1")!.matchedTxnId).toBe("p1");
  });
});

describe("effectiveMonth", () => {
  it("uses the refund's assigned month, else the row's own date", () => {
    const refunds = new Map([["r1", { effectiveMonth: "2026-06" }]]);
    expect(effectiveMonth({ id: "r1", date: "2026-07-14" }, refunds)).toBe("2026-06");
    expect(effectiveMonth({ id: "x", date: "2026-07-14" }, refunds)).toBe("2026-07");
  });
});
