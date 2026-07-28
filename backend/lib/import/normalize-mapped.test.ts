import { describe, it, expect } from "vitest";
import { normalizeMappedRows } from "./pipeline";

const mapping = { date: "Date", description: "Description", amount: "Amount", category: "Category" };
const header = ["Date", "Description", "Amount", "Category", "Notes"];

describe("normalizeMappedRows — grid shapes real spreadsheets produce", () => {
  it("converts Excel date serials (integer and fractional) instead of inventing year-46203", () => {
    const { normalized, errors } = normalizeMappedRows(
      [
        header,
        ["46203.8333333333", "TIM HORTONS", "-5.25", "Eating Out", ""], // date+time serial
        ["46204", "DATE ONLY CELL", "-1.00", "", ""], // date-only serial
      ],
      mapping
    );
    // Ground truth: serial 45658 = 2025-01-01 (+545 days → 46203 = 2026-06-30)
    expect(errors).toEqual([]);
    expect(normalized[0].date).toBe("2026-06-30");
    expect(normalized[1].date).toBe("2026-07-01");
  });

  it("does not mistake a bare year for a serial", () => {
    const { normalized } = normalizeMappedRows([header, ["2026", "YEAR ONLY", "-1", "", ""]], mapping);
    // "2026" fails the 5-digit serial test and parses as new Date("2026") → Jan 1
    expect(normalized[0].date).toBe("2026-01-01");
  });

  it("parses accounting-style parenthesized negatives, with $ and commas inside", () => {
    const { normalized, errors } = normalizeMappedRows(
      [header, ["2026-07-08", "AMZN RETURN", "(45.67)", "Shopping", ""], ["2026-07-09", "BIG REFUND", "($1,234.56)", "", ""]],
      mapping
    );
    expect(errors).toEqual([]);
    expect(normalized[0].amount).toBe(-45.67);
    expect(normalized[1].amount).toBe(-1234.56);
  });

  it("negateAmounts flips a parenthesized negative back to positive", () => {
    const { normalized } = normalizeMappedRows([header, ["2026-07-08", "X", "(45.67)", "", ""]], mapping, true);
    expect(normalized[0].amount).toBe(45.67);
  });

  it("skips fully-blank spacer rows silently but still reports partial rows", () => {
    const { normalized, errors } = normalizeMappedRows(
      [
        header,
        ["", "", "", "", ""], // spacer — skip, no error
        ["2026-07-10", "REAL ROW", "12.5", "Eating Out", ""],
        ["", "Total", "-601.68", "", ""], // partial (no date) — must surface as error, not import
      ],
      mapping
    );
    expect(normalized).toHaveLength(1);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("Total");
  });

  it("still rejects genuinely unparseable dates and amounts", () => {
    const { normalized, errors } = normalizeMappedRows(
      [header, ["15/07/2026", "DDMM DATE", "-20", "", ""], ["2026-07-18", "JUNK", "CA$ twelve", "", ""]],
      mapping
    );
    expect(normalized).toEqual([]);
    expect(errors).toHaveLength(2);
  });

  it("reports an out-of-range amount as one bad row, not a failed import", () => {
    // Finite, so the old NaN check passed it through — and it then threw at the
    // money seam, taking the whole import down with a 500.
    const { normalized, errors } = normalizeMappedRows(
      [header, ["2026-07-18", "ABSURD", "1e300", "", ""], ["2026-07-19", "FINE", "-20", "", ""]],
      mapping
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("ABSURD");
    expect(normalized).toHaveLength(1);
    expect(normalized[0]).toMatchObject({ description: "FINE", amount: -20 });
  });

  it("keeps existing behavior: $/comma amounts, unicode descriptions, optional category", () => {
    const { normalized, errors } = normalizeMappedRows(
      [header, ["07/04/2026", "SHELL GAS BAR", "-$1,234.56", "Transport", ""], ["2026-07-10", 'Café "Léa", Crème & Co 🍰', "12.5", "", ""]],
      mapping
    );
    expect(errors).toEqual([]);
    expect(normalized[0]).toMatchObject({ date: "2026-07-04", amount: -1234.56, category: "Transport" });
    expect(normalized[1].description).toBe('Café "Léa", Crème & Co 🍰');
    expect(normalized[1].category).toBeUndefined();
  });
});
