/**
 * normalizeMappedRows turns a user's arbitrary spreadsheet columns into the
 * app's transaction shape. It's where sign convention and date parsing get
 * decided, and both have already caused real-world mistakes (a Google Sheet
 * silently mis-parsed year-less dates and inverted expense signs).
 */
import { describe, it, expect } from "vitest";
import { normalizeMappedRows } from "./pipeline";
import { parseCsv } from "./csv";

const mapping = { date: "Date", description: "Description", amount: "Amount" };

function rows(csv: string) {
  return parseCsv(csv);
}

describe("normalizeMappedRows — header handling", () => {
  it("reports a header error when a mapped column is missing", () => {
    const r = normalizeMappedRows(rows("Date,Merchant,Amount\n2026-07-02,ZEHRS,-84.20"), mapping);
    expect(r.headerError).toContain("Mapped column not found");
    expect(r.normalized).toHaveLength(0);
  });

  it("reports a header error when there are no data rows", () => {
    const r = normalizeMappedRows(rows("Date,Description,Amount"), mapping);
    expect(r.headerError).toContain("needs a header row");
  });
});

describe("normalizeMappedRows — amounts", () => {
  it("keeps negative-as-spend, the app's convention", () => {
    const r = normalizeMappedRows(rows("Date,Description,Amount\n2026-07-02,ZEHRS,-84.20"), mapping);
    expect(r.normalized[0].amount).toBe(-84.2);
  });

  it("strips currency symbols and thousands separators", () => {
    const r = normalizeMappedRows(
      rows('Date,Description,Amount\n2026-07-02,RENT,"-$1,850.00"'),
      mapping
    );
    expect(r.normalized[0].amount).toBe(-1850);
  });

  it("inverts signs when the source uses positive-as-debit", () => {
    // Several Canadian bank exports list spending as positive; getting this
    // backwards turns every expense into income and corrupts budget totals.
    const r = normalizeMappedRows(
      rows("Date,Description,Amount\n2026-07-02,ZEHRS,84.20"),
      mapping,
      true
    );
    expect(r.normalized[0].amount).toBe(-84.2);
  });

  it("collects unparseable rows as errors instead of importing them", () => {
    const r = normalizeMappedRows(
      rows("Date,Description,Amount\n2026-07-02,GOOD,-10.00\nnot-a-date,BAD,-5.00\n2026-07-03,ALSO BAD,abc"),
      mapping
    );
    expect(r.normalized).toHaveLength(1);
    expect(r.errors).toHaveLength(2);
  });
});

describe("normalizeMappedRows — dates", () => {
  it("passes ISO dates through unchanged", () => {
    const r = normalizeMappedRows(rows("Date,Description,Amount\n2026-07-02,ZEHRS,-84.20"), mapping);
    expect(r.normalized[0].date).toBe("2026-07-02");
  });

  it("documents that locale-format dates are parsed in local time", () => {
    // new Date("07/02/2026") is local midnight, but the output is derived via
    // toISOString(). West of UTC that round-trips; east of UTC it shifts a day
    // earlier. Asserting the machine's actual behaviour rather than a guess, so
    // the day this runs somewhere else the failure is loud instead of silent.
    const r = normalizeMappedRows(rows("Date,Description,Amount\n07/02/2026,ZEHRS,-84.20"), mapping);
    const localMidnightIso = new Date("07/02/2026").toISOString().split("T")[0];
    expect(r.normalized[0].date).toBe(localMidnightIso);
  });
});

describe("normalizeMappedRows — optional category", () => {
  it("carries a category through when mapped", () => {
    const r = normalizeMappedRows(
      rows("Date,Description,Amount,Cat\n2026-07-02,ZEHRS,-84.20,Groceries"),
      { ...mapping, category: "Cat" }
    );
    expect(r.normalized[0].category).toBe("Groceries");
  });

  it("omits category when the cell is blank", () => {
    // An empty string must not become a literal category, or it would compete
    // with the categorization engine's own answer.
    const r = normalizeMappedRows(rows("Date,Description,Amount,Cat\n2026-07-02,ZEHRS,-84.20,"), {
      ...mapping,
      category: "Cat",
    });
    expect(r.normalized[0].category).toBeUndefined();
  });
});
