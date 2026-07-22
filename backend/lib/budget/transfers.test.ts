import { describe, expect, it } from "vitest";
import {
  matchesTransferPattern,
  budgetRows,
  SUGGESTED_TRANSFER_PATTERNS,
  rowsToMark,
  rowsToUnmark,
} from "./transfers";
import { summarizeTotals, summarizeEnvelopes, type TransactionRow } from "./summarize";

const PATTERNS = SUGGESTED_TRANSFER_PATTERNS.map((p) => p.pattern);

// Every string below is a verbatim description from the user's real RBC and
// Tangerine exports. Invented descriptions would only prove the matcher matches
// the things it was written against.
describe("matchesTransferPattern", () => {
  it("catches a credit card payment on the card side", () => {
    expect(matchesTransferPattern("PAYMENT - THANK YOU / PAI EMENT - MERCI", PATTERNS)).toBe(true);
  });

  it("catches the same payment on the chequing side", () => {
    expect(matchesTransferPattern("Bill Payment - ROYAL BANK VISA-V", PATTERNS)).toBe(true);
  });

  it("catches investment cash moving both directions", () => {
    expect(matchesTransferPattern("EFT Withdrawal to WS Investments", PATTERNS)).toBe(true);
    expect(matchesTransferPattern("EFT Deposit from WS Investments", PATTERNS)).toBe(true);
  });

  it("catches a second card issuer", () => {
    expect(matchesTransferPattern("Tangerine Credit Card Payment", PATTERNS)).toBe(true);
  });

  // The whole reason the patterns name payees instead of the "Bill Payment"
  // prefix. On real data that prefix covers the city tax bill, the gas bill and
  // the phone bill — matching it would erase real spending from the budget,
  // which is a worse error than the one being fixed.
  it("does NOT treat ordinary bill payments as transfers", () => {
    expect(matchesTransferPattern("Bill Payment - CITY OF WELLAND -", PATTERNS)).toBe(false);
    expect(matchesTransferPattern("Bill Payment - ENBRIDGE GAS INC", PATTERNS)).toBe(false);
    expect(matchesTransferPattern("Bill Payment - KOODO MOBILE - **", PATTERNS)).toBe(false);
    expect(matchesTransferPattern("Bill Payment - COGECO CONNEXION", PATTERNS)).toBe(false);
  });

  it("does NOT treat salary or purchases as transfers", () => {
    expect(matchesTransferPattern("EFT Deposit from STERICYCLE ULC", PATTERNS)).toBe(false);
    expect(matchesTransferPattern("TIM HORTONS WELLAND", PATTERNS)).toBe(false);
    expect(matchesTransferPattern("NO FRILLS #3021 WELLAND", PATTERNS)).toBe(false);
  });

  it("ignores an empty or unmatched pattern list", () => {
    expect(matchesTransferPattern("Bill Payment - ROYAL BANK VISA-V", [])).toBe(false);
    expect(matchesTransferPattern("anything", [""])).toBe(false);
  });
});

function txn(over: Partial<TransactionRow>): TransactionRow {
  return {
    id: "t1",
    accountId: "a1",
    date: "2026-06-15",
    description: "x",
    merchantName: null,
    amount: -10,
    category: null,
    ...over,
  };
}

describe("budgetRows", () => {
  it("drops rows carrying a transfer source", () => {
    const rows = [
      txn({ id: "keep", transferSource: null }),
      txn({ id: "keep2" }),
      txn({ id: "drop", transferSource: "rule" }),
      txn({ id: "drop2", transferSource: "manual" }),
    ];
    expect(budgetRows(rows).map((r) => r.id)).toEqual(["keep", "keep2"]);
  });

  // Wealthsimple history reaches back to 2021; the bank exports start in May
  // 2025. A 2023 month would otherwise show a $40 dividend and no spending at
  // all, which reads as a wildly profitable month rather than a data gap.
  it("drops rows from a period the other accounts do not cover", () => {
    const rows = [
      txn({ id: "keep" }),
      txn({ id: "old", date: "2023-04-01", amount: 40, coverage: "before_bank_data" }),
    ];
    expect(budgetRows(rows).map((r) => r.id)).toEqual(["keep"]);
  });

  it("keeps a row that is neither a transfer nor out of coverage", () => {
    expect(budgetRows([txn({ id: "a", transferSource: null, coverage: null })])).toHaveLength(1);
  });
});

// The bug this whole module exists for, reproduced at the scale it happened:
// paying a credit card showed up as income on one side and spending on the
// other, and both totals were individually wrong even though they cancelled.
describe("transfers are excluded from every figure", () => {
  const envelopes = [
    { id: "e1", name: "Groceries", monthlyTarget: 500, categoryRules: "[]", sortOrder: 0 },
  ];

  const rows = [
    txn({ id: "pay", description: "EFT Deposit from STERICYCLE ULC", amount: 3000 }),
    txn({ id: "shop", description: "NO FRILLS", amount: -200, category: "Groceries" }),
    txn({
      id: "cardpay",
      description: "Bill Payment - ROYAL BANK VISA-V",
      amount: -7000,
      transferSource: "rule",
    }),
    txn({
      id: "cardside",
      description: "PAYMENT - THANK YOU / PAI EMENT - MERCI",
      amount: 7000,
      transferSource: "rule",
    }),
  ];

  it("keeps income to genuinely earned money", () => {
    const totals = summarizeTotals(summarizeEnvelopes(envelopes, [], rows), rows);
    expect(totals.totalIncome).toBe(3000);
  });

  it("keeps outflow to money actually spent", () => {
    const totals = summarizeTotals(summarizeEnvelopes(envelopes, [], rows), rows);
    expect(totals.totalOutflow).toBe(200);
  });

  it("does not let a transfer reach an envelope", () => {
    const summaries = summarizeEnvelopes(envelopes, [], rows);
    expect(summaries.find((e) => e.name === "Groceries")!.spent).toBe(200);
  });

  it("reports what was really saved", () => {
    const totals = summarizeTotals(summarizeEnvelopes(envelopes, [], rows), rows);
    expect(totals.saved).toBe(2800);
  });

  // Without the fix this month reads as $10,000 earned and $7,200 spent — both
  // wrong, while `saved` lands on the same $2,800 and hides it.
  it("shows how wrong the unfixed numbers were", () => {
    const unflagged = rows.map((r) => ({ ...r, transferSource: null }));
    const totals = summarizeTotals(summarizeEnvelopes(envelopes, [], unflagged), unflagged);
    expect(totals.totalIncome).toBe(10000);
    expect(totals.totalOutflow).toBe(7200);
    expect(totals.saved).toBe(2800);
  });
});

describe("rowsToMark / rowsToUnmark — pattern save/delete refile semantics", () => {
  const rows = [
    { id: "a", description: "Bill Payment - ROYAL BANK VISA-V", transferSource: null },
    { id: "b", description: "Bill Payment - ROYAL BANK VISA-V", transferSource: "manual" },
    { id: "c", description: "Bill Payment - ROYAL BANK VISA-V", transferSource: "rule" },
    { id: "d", description: "TIM HORTONS #1234", transferSource: null },
    { id: "e", description: "EFT Withdrawal to WS Investments", transferSource: "rule" },
  ];

  it("marks only unmarked matching rows — manual and already-rule rows untouched", () => {
    expect(rowsToMark(rows, "Bill Payment - ROYAL BANK VISA").map((r) => r.id)).toEqual(["a"]);
  });

  it("unmarks rule rows the deleted pattern claimed, unless another pattern still does", () => {
    expect(
      rowsToUnmark(rows, "Bill Payment - ROYAL BANK VISA", ["EFT Withdrawal"]).map((r) => r.id)
    ).toEqual(["c"]);
    // With the same pattern still present in remaining, nothing unmarks.
    expect(
      rowsToUnmark(rows, "Bill Payment - ROYAL BANK VISA", ["ROYAL BANK VISA"])
    ).toEqual([]);
  });

  it("never unmarks a manual row", () => {
    const ids = rowsToUnmark(rows, "Bill Payment - ROYAL BANK VISA", []).map((r) => r.id);
    expect(ids).not.toContain("b");
  });
});
