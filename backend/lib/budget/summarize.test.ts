import { describe, it, expect } from "vitest";
import {
  summarizeEnvelopes,
  summarizeTotals,
  computeNotableTransactions,
  attributeSpend,
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

  // This block previously asserted the opposite — that an explicit $0
  // allocation is "unconfigured" — which is how the bug below shipped and
  // survived a green suite. Once reallocation could write allocation rows,
  // moving an envelope to $0 for the month made it render as a neutral "not
  // set up yet" chip, and because overBudget requires !unconfigured, it also
  // suppressed the breach. Caught on device: Shopping showed $314.63 of spend
  // against a deliberate $0 budget and looked fine.
  it("treats an explicit zero allocation as configured, not unconfigured", () => {
    const [s] = summarizeEnvelopes(
      [env("Groceries", 500)],
      [{ envelopeId: "groceries", allocated: 0 }],
      [txn("Groceries", -10)]
    );
    expect(s.unconfigured).toBe(false);
  });

  it("reports overspend against a deliberate $0 allocation", () => {
    const [s] = summarizeEnvelopes(
      [env("Groceries", 500)],
      [{ envelopeId: "groceries", allocated: 0 }],
      [txn("Groceries", -314.63)]
    );
    expect(s.allocated).toBe(0);
    expect(s.overBudget).toBe(true);
    expect(s.remaining).toBeCloseTo(-314.63, 2);
  });

  it("still treats a zero standing target with no allocation row as unconfigured", () => {
    // The original protection must survive: a never-set-up envelope is not
    // "over budget" the moment it sees any spending.
    const [s] = summarizeEnvelopes([env("Groceries", 0)], [], [txn("Groceries", -100)]);
    expect(s.unconfigured).toBe(true);
    expect(s.overBudget).toBe(false);
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

  // The bug these guard: `saved` was totalIncome - totalSpent, and totalSpent
  // only counts spend that reached an envelope. Every uncategorized dollar was
  // therefore counted as saved. On real data that was $72.7k across 925
  // transactions, rendering a green positive net position for a negative month.
  describe("spend that reaches no envelope still counts as spent", () => {
    it("does not count uncategorized spend as saved", () => {
      const txns = [txn("Groceries", -100), txn(null, -400), txn(null, 1000)];
      const summaries = summarizeEnvelopes([env("Groceries", 500)], [], txns);
      const t = summarizeTotals(summaries, txns);

      expect(t.totalSpent).toBe(100); // envelope-attributed only
      expect(t.unattributedSpent).toBe(400);
      expect(t.totalOutflow).toBe(500);
      expect(t.saved).toBe(500); // NOT 900
    });

    it('treats the literal "uncategorized" category as unattributed', () => {
      const txns = [txn("uncategorized", -75)];
      const summaries = summarizeEnvelopes([env("Groceries", 500)], [], txns);
      const t = summarizeTotals(summaries, txns);
      expect(t.unattributedSpent).toBe(75);
      expect(t.saved).toBe(-75);
    });

    it("treats a category naming no envelope as unattributed", () => {
      // What a CSV import produces when the bank's own labels are carried
      // through: the row looks categorized but matches no envelope.
      const txns = [txn("Dining", -60)];
      const summaries = summarizeEnvelopes([env("Restaurants", 500)], [], txns);
      const t = summarizeTotals(summaries, txns);
      expect(t.totalSpent).toBe(0);
      expect(t.unattributedSpent).toBe(60);
    });

    it("reconciles: attributed + unattributed equals total outflow", () => {
      const txns = [txn("Groceries", -100), txn("Restaurants", -50), txn(null, -25)];
      const summaries = summarizeEnvelopes([env("Groceries", 500), env("Restaurants", 300)], [], txns);
      const t = summarizeTotals(summaries, txns);
      expect(t.totalSpent + t.unattributedSpent).toBe(t.totalOutflow);
    });

    it("follows splits, so a split into a real envelope is not unattributed", () => {
      const parent = txn("Shopping", -100);
      const splits = [
        { transactionId: parent.id, category: "Groceries", amount: -60 },
        { transactionId: parent.id, category: "Whatever", amount: -40 },
      ];
      const summaries = summarizeEnvelopes([env("Groceries", 500)], [], [parent], splits);
      const t = summarizeTotals(summaries, [parent], splits);

      expect(t.totalSpent).toBe(60);
      expect(t.unattributedSpent).toBe(40); // the half naming no envelope
      expect(t.totalOutflow).toBe(100); // parent counted once, not twice
    });
  });
});

describe("attributeSpend — splits replace the parent transaction", () => {
  it("uses the transaction's own category when it has no splits", () => {
    const t = txn("Groceries", -100);
    expect(attributeSpend([t], [])).toEqual([
      { transaction: t, category: "Groceries", amount: -100 },
    ]);
  });

  it("replaces a split transaction with its parts, never both", () => {
    // Counting the parent as well would double the spend.
    const t = txn("Groceries", -200);
    const out = attributeSpend([t], [
      { transactionId: t.id, category: "Groceries", amount: -150 },
      { transactionId: t.id, category: "Shopping", amount: -50 },
    ]);
    expect(out).toHaveLength(2);
    expect(out.reduce((s, a) => s + a.amount, 0)).toBe(-200);
  });

  it("ignores splits belonging to other transactions", () => {
    const t = txn("Groceries", -100);
    const out = attributeSpend([t], [
      { transactionId: "some-other-id", category: "Shopping", amount: -50 },
    ]);
    expect(out).toEqual([{ transaction: t, category: "Groceries", amount: -100 }]);
  });
});

describe("summarizeEnvelopes — with splits", () => {
  it("attributes each part to its own envelope", () => {
    const t = txn("Groceries", -200);
    const s = summarizeEnvelopes(
      [env("Groceries", 500), env("Shopping", 300)],
      [],
      [t],
      [
        { transactionId: t.id, category: "Groceries", amount: -150 },
        { transactionId: t.id, category: "Shopping", amount: -50 },
      ]
    );
    expect(s.find((e) => e.name === "Groceries")!.spent).toBe(150);
    expect(s.find((e) => e.name === "Shopping")!.spent).toBe(50);
  });

  it("does not double-count the parent's original category", () => {
    // The whole point: a Walmart run categorized Groceries but split across two
    // envelopes must contribute 150 to Groceries, not 350.
    const t = txn("Groceries", -200);
    const [g] = summarizeEnvelopes(
      [env("Groceries", 500)],
      [],
      [t],
      [
        { transactionId: t.id, category: "Groceries", amount: -150 },
        { transactionId: t.id, category: "Shopping", amount: -50 },
      ]
    );
    expect(g.spent).toBe(150);
  });

  it("leaves totals unchanged when a split covers the same single envelope", () => {
    const t = txn("Groceries", -200);
    const [g] = summarizeEnvelopes(
      [env("Groceries", 500)],
      [],
      [t],
      [
        { transactionId: t.id, category: "Groceries", amount: -120 },
        { transactionId: t.id, category: "Groceries", amount: -80 },
      ]
    );
    expect(g.spent).toBe(200);
  });
});

describe("computeNotableTransactions — with splits", () => {
  it("measures notability per split, not per parent amount", () => {
    // $200 against a $500 envelope would be notable at 40%, but split 50/50 it
    // is two ordinary $100 charges at 20% each — and must not be flagged twice.
    const t = txn("Groceries", -200);
    const splits = [
      { transactionId: t.id, category: "Groceries", amount: -100 },
      { transactionId: t.id, category: "Shopping", amount: -100 },
    ];
    const summaries = summarizeEnvelopes(
      [env("Groceries", 5000), env("Shopping", 5000)],
      [],
      [t],
      splits
    );
    // Both parts are 2% of their envelopes — below the 15% threshold.
    expect(computeNotableTransactions(summaries, [t], splits)).toHaveLength(0);
  });

  it("flags a split part that is outsized for its own envelope", () => {
    const t = txn("Groceries", -200);
    const splits = [
      { transactionId: t.id, category: "Groceries", amount: -150 },
      { transactionId: t.id, category: "Shopping", amount: -50 },
    ];
    const summaries = summarizeEnvelopes(
      [env("Groceries", 5000), env("Shopping", 100)],
      [],
      [t],
      splits
    );
    const notable = computeNotableTransactions(summaries, [t], splits);
    // Only Shopping: 50/100 = 50%. Groceries is 150/5000 = 3%.
    expect(notable.map((c) => c.category)).toEqual(["Shopping"]);
    expect(notable[0].transactions[0].amount).toBe(-50);
  });
});

describe("refund netting — positive rows classified as refunds", () => {
  it("nets a refund against its envelope's spend instead of counting it as income", () => {
    const groceries = txn("Groceries", -300);
    const refund = txn("Groceries", 40);
    const refundIds = new Set([refund.id]);

    const summaries = summarizeEnvelopes([env("Groceries", 500)], [], [groceries, refund], [], undefined, refundIds);
    expect(summaries[0].spent).toBe(260);

    const totals = summarizeTotals(summaries, [groceries, refund], [], refundIds);
    expect(totals.totalIncome).toBe(0); // the refund is NOT income
    expect(totals.totalSpent).toBe(260);
    expect(totals.totalOutflow).toBe(260);
  });

  it("without classification a positive row keeps the old behaviour: income, no netting", () => {
    const groceries = txn("Groceries", -300);
    const interest = txn("Groceries", 40); // e.g. income a keyword rule mis-filed
    const summaries = summarizeEnvelopes([env("Groceries", 500)], [], [groceries, interest]);
    expect(summaries[0].spent).toBe(300);
    const totals = summarizeTotals(summaries, [groceries, interest]);
    expect(totals.totalIncome).toBe(40);
    expect(totals.totalOutflow).toBe(300);
  });

  it("a refund-heavy month goes honestly negative rather than flooring at zero", () => {
    const purchase = txn("Shopping", -50);
    const refund = txn("Shopping", 240); // last month's big order came back
    const refundIds = new Set([refund.id]);
    const summaries = summarizeEnvelopes([env("Shopping", 200)], [], [purchase, refund], [], undefined, refundIds);
    expect(summaries[0].spent).toBe(-190);
    expect(summaries[0].remaining).toBe(390); // real extra room, not fiction
    expect(summaries[0].overBudget).toBe(false);
  });

  it("keeps the cross-check identity: totalOutflow − unattributedSpent === totalSpent", () => {
    const rows = [
      txn("Groceries", -300),
      txn("Groceries", 40), // refund
      txn(null, -75), // unattributed spend
      txn(null, 1000), // paycheque
    ];
    const refundIds = new Set([rows[1].id]);
    const summaries = summarizeEnvelopes([env("Groceries", 500)], [], rows, [], undefined, refundIds);
    const totals = summarizeTotals(summaries, rows, [], refundIds);
    expect(totals.totalOutflow - totals.unattributedSpent).toBeCloseTo(totals.totalSpent);
    expect(totals.totalIncome).toBe(1000);
    // saved is unchanged by construction: income −R and outflow −R cancel.
    expect(totals.saved).toBe(1000 - 335);
  });
});
