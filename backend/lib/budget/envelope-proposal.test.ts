/**
 * 6c derives the starting category set from the user's OWN spending rather than
 * shipping a taxonomy. The two properties that make it a proposal and not an
 * imposition are what these tests pin: only categories the user actually spent
 * in are offered, and every merchant the seed rules couldn't place is surfaced
 * with its amount rather than silently dropped. Descriptions are real forms
 * from the user's RBC/Tangerine/Amazon data.
 */
import { describe, it, expect } from "vitest";
import { proposeEnvelopes, type ProposalTxn } from "./envelope-proposal";

describe("proposeEnvelopes — recognized clusters", () => {
  it("offers only categories the user actually spent in", () => {
    // Groceries + Restaurants present; no transit merchant anywhere.
    const txns: ProposalTxn[] = [
      { description: "NO FRILLS #3021 WELLAND", amount: -80, date: "2026-06-02" },
      { description: "LOBLAWS", amount: -120, date: "2026-06-10" },
      { description: "TIM HORTONS", amount: -6, date: "2026-06-11" },
    ];

    const p = proposeEnvelopes(txns, []);
    const names = p.recognized.map((r) => r.name);

    expect(names).toContain("Groceries");
    expect(names).toContain("Restaurants");
    // A shipped taxonomy would offer Transport regardless; a proposal does not.
    expect(names).not.toContain("Transport");
  });

  it("averages spend over the distinct months present", () => {
    const txns: ProposalTxn[] = [
      { description: "LOBLAWS", amount: -100, date: "2026-05-05" },
      { description: "LOBLAWS", amount: -100, date: "2026-06-05" },
    ];

    const p = proposeEnvelopes(txns, []);
    const groceries = p.recognized.find((r) => r.name === "Groceries")!;

    expect(p.monthsObserved).toBe(2);
    expect(groceries.totalSpent).toBe(200);
    expect(groceries.monthlyAverage).toBe(100); // 200 over 2 months, not 200
  });

  it("marks a category the user already has, without dropping it", () => {
    const txns: ProposalTxn[] = [
      { description: "LOBLAWS", amount: -100, date: "2026-06-05" },
    ];

    const p = proposeEnvelopes(txns, ["Groceries"]);
    const groceries = p.recognized.find((r) => r.name === "Groceries")!;

    expect(groceries.alreadyExists).toBe(true);
  });

  it("ignores income and zero rows — a category is a place money goes", () => {
    const txns: ProposalTxn[] = [
      { description: "PAYROLL DEPOSIT STERICYCLE", amount: 3200, date: "2026-06-15" },
      { description: "LOBLAWS", amount: -50, date: "2026-06-05" },
      { description: "SOME ZERO ROW", amount: 0, date: "2026-06-06" },
    ];

    const p = proposeEnvelopes(txns, []);

    expect(p.recognized).toHaveLength(1);
    expect(p.recognized[0].name).toBe("Groceries");
    expect(p.recognized[0].transactionCount).toBe(1);
  });
});

describe("proposeEnvelopes — the gap a shipped taxonomy hides", () => {
  it("surfaces merchants no seed rule could place, biggest first", () => {
    const txns: ProposalTxn[] = [
      { description: "GOODLIFE FITNESS", amount: -60, date: "2026-06-01" },
      { description: "GOODLIFE FITNESS", amount: -60, date: "2026-07-01" },
      { description: "SOME LOCAL BUTCHER", amount: -25, date: "2026-06-03" },
      { description: "LOBLAWS", amount: -50, date: "2026-06-05" }, // recognized, not here
    ];

    const p = proposeEnvelopes(txns, []);
    const merchants = p.unrecognized.map((u) => u.merchant);

    expect(merchants).not.toContain("LOBLAWS");
    // GoodLife totals $120 across two rows, ahead of the $25 butcher.
    expect(p.unrecognized[0].merchant).toBe("GOODLIFE FITNESS");
    expect(p.unrecognized[0].totalSpent).toBe(120);
    expect(p.unrecognized[0].transactionCount).toBe(2);
  });

  it("collapses per-order-id siblings into one merchant via normalization", () => {
    // "AMZN MKTP CA" is unrecognized under the SEED rules (they carry AMAZON,
    // not AMZN); the order id after the asterisk is what would otherwise make
    // every order look like its own merchant.
    const txns: ProposalTxn[] = [
      { description: "AMZN MKTP CA*097ZX38Y3", amount: -30, date: "2026-06-01" },
      { description: "AMZN MKTP CA*ZZ11AA22B", amount: -20, date: "2026-06-02" },
    ];

    const p = proposeEnvelopes(txns, []);

    // Both rows fold into a single unrecognized merchant, not two.
    expect(p.unrecognized).toHaveLength(1);
    expect(p.unrecognized[0].merchant).toBe("AMZN MKTP CA");
    expect(p.unrecognized[0].transactionCount).toBe(2);
    expect(p.unrecognized[0].totalSpent).toBe(50);
  });
});
