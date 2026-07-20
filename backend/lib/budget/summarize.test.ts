import { describe, it, expect } from "vitest";
import {
  summarizeEnvelopes,
  summarizeTotals,
  computeNotableTransactions,
  NOTABLE_SHARE,
  type EnvelopeRow,
  type TransactionRow,
} from "./summarize";

function env(name: string, monthlyTarget: number, id = name.toLowerCase()): EnvelopeRow {
  return { id, name, monthlyTarget, categoryRules: JSON.stringify([name.toUpperCase()]) };
}

let seq = 0;
function txn(category: string | null, amount: number, date = "2026-07-05"): TransactionRow {
  seq += 1;
  return {
    id: `t${seq}`,
    accountId: "acct-1",
    date,
    description: `${category ?? "UNKNOWN"} PURCHASE`,
    merchantName: null,
    amount,
    category,
  };
}

describe("summarizeEnvelopes — spend attribution", () => {
  it("counts only negative amounts in the matching category", () => {
    const s = summarizeEnvelopes(
      [env("Groceries", 500)],
      [],
      [txn("Groceries", -100), txn("Groceries", -50), txn("Restaurants", -80)]
    );
    expect(s[0].spent).toBe(150);
  });

  it("excludes income from spend even when categorized", () => {
    // A refund or payroll row landing in an envelope must not offset spending
    // silently — spend and income are reported separately.
    const s = summarizeEnvelopes([env("Groceries", 500)], [], [txn("Groceries", -100), txn("Groceries", 40)]);
    expect(s[0].spent).toBe(100);
  });

  it("ignores uncategorized transactions", () => {
    const s = summarizeEnvelopes([env("Groceries", 500)], [], [txn("uncategorized", -100)]);
    expect(s[0].spent).toBe(0);
  });

  it("parses categoryRules from stored JSON", () => {
    const s = summarizeEnvelopes([env("Groceries", 500)], [], []);
    expect(s[0].categoryRules).toEqual(["GROCERIES"]);
  });
});

describe("summarizeEnvelopes — allocation precedence", () => {
  it("uses the monthly target when there is no allocation row", () => {
    const s = summarizeEnvelopes([env("Groceries", 500)], [], []);
    expect(s[0].allocated).toBe(500);
  });

  it("lets a per-month allocation override the standing target", () => {
    // This is how reallocation works without rewriting the envelope.
    const s = summarizeEnvelopes(
      [env("Groceries", 500)],
      [{ envelopeId: "groceries", allocated: 650 }],
      []
    );
    expect(s[0].allocated).toBe(650);
  });
});

describe("summarizeEnvelopes — unconfigured vs over budget", () => {
  it("marks a zero target as unconfigured, not over budget", () => {
    // The bug this guards: every fresh envelope reported as breached the moment
    // it had any spending, making a new setup look broken.
    const [s] = summarizeEnvelopes([env("Groceries", 0)], [], [txn("Groceries", -100)]);
    expect(s.unconfigured).toBe(true);
    expect(s.overBudget).toBe(false);
    expect(s.remaining).toBe(0);
  });

  it("reports over budget once a real target is exceeded", () => {
    const [s] = summarizeEnvelopes([env("Groceries", 50)], [], [txn("Groceries", -100)]);
    expect(s.unconfigured).toBe(false);
    expect(s.overBudget).toBe(true);
    expect(s.remaining).toBe(-50);
  });

  it("is not over budget when spend exactly equals the target", () => {
    // Boundary: spending your whole budget is not overspending it.
    const [s] = summarizeEnvelopes([env("Groceries", 100)], [], [txn("Groceries", -100)]);
    expect(s.overBudget).toBe(false);
    expect(s.remaining).toBe(0);
  });

  it("treats an explicit zero allocation as unconfigured too", () => {
    const [s] = summarizeEnvelopes(
      [env("Groceries", 500)],
      [{ envelopeId: "groceries", allocated: 0 }],
      [txn("Groceries", -10)]
    );
    expect(s.unconfigured).toBe(true);
  });
});

describe("computeNotableTransactions", () => {
  it("surfaces a transaction at or above the share threshold", () => {
    const summaries = summarizeEnvelopes([env("Shopping", 200)], [], [txn("Shopping", -30)]);
    const notable = computeNotableTransactions(summaries, [txn("Shopping", -30)]);
    // 30/200 = 0.15, exactly the threshold — inclusive by design.
    expect(NOTABLE_SHARE).toBe(0.15);
    expect(notable[0].transactions).toHaveLength(1);
  });

  it("ignores transactions below the threshold", () => {
    const txns = [txn("Shopping", -29)];
    const summaries = summarizeEnvelopes([env("Shopping", 200)], [], txns);
    expect(computeNotableTransactions(summaries, txns)).toHaveLength(0);
  });

  it("caps at three per category, largest first", () => {
    const txns = [
      txn("Shopping", -40),
      txn("Shopping", -90),
      txn("Shopping", -60),
      txn("Shopping", -50),
    ];
    const summaries = summarizeEnvelopes([env("Shopping", 200)], [], txns);
    const [card] = computeNotableTransactions(summaries, txns);
    expect(card.transactions).toHaveLength(3);
    expect(card.transactions.map((t) => t.amount)).toEqual([-90, -60, -50]);
  });

  it("skips unconfigured envelopes entirely", () => {
    // Share-of-allocation is undefined without an allocation; dividing by zero
    // would make every transaction infinitely notable.
    const txns = [txn("Shopping", -500)];
    const summaries = summarizeEnvelopes([env("Shopping", 0)], [], txns);
    expect(computeNotableTransactions(summaries, txns)).toHaveLength(0);
  });

  it("emits one card per category and omits empty ones", () => {
    const txns = [txn("Shopping", -100), txn("Groceries", -5)];
    const summaries = summarizeEnvelopes([env("Shopping", 200), env("Groceries", 500)], [], txns);
    const notable = computeNotableTransactions(summaries, txns);
    expect(notable.map((c) => c.category)).toEqual(["Shopping"]);
  });

  it("reports share of allocation", () => {
    const txns = [txn("Shopping", -50)];
    const summaries = summarizeEnvelopes([env("Shopping", 200)], [], txns);
    expect(computeNotableTransactions(summaries, txns)[0].transactions[0].shareOfAllocation).toBe(
      0.25
    );
  });
});

describe("summarizeTotals", () => {
  it("counts positive amounts as income", () => {
    const txns = [txn("Groceries", -100), txn(null, 3400)];
    const summaries = summarizeEnvelopes([env("Groceries", 500)], [], txns);
    const t = summarizeTotals(summaries, txns);
    expect(t.totalIncome).toBe(3400);
    expect(t.totalSpent).toBe(100);
    expect(t.saved).toBe(3300);
    expect(t.remaining).toBe(400);
  });

  it("reports how many envelopes are actually configured", () => {
    // Drives the "—" placeholder instead of a misleading negative Remaining.
    const summaries = summarizeEnvelopes([env("A", 100), env("B", 0), env("C", 0)], [], []);
    const t = summarizeTotals(summaries, []);
    expect(t.configuredEnvelopes).toBe(1);
    expect(t.totalEnvelopes).toBe(3);
  });
});
