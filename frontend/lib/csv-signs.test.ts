/**
 * Tests for the sign-convention guard.
 *
 * The bug this module exists to stop, from CHANGELOG.md: a real CSV import
 * "silently inverted every transaction. All 50 rows positive (debit-positive
 * export) with the negate toggle defaulting off → purchases recorded as income,
 * inflating a month by ~$2.9k." The file itself is ambiguous — an all-positive
 * export is either all deposits or (far more commonly) spending stated as
 * positive debits — so `uniform` exists to make the app REFUSE to guess and ask
 * the user instead.
 *
 * So the cases that matter are: does a uniform file get flagged, does a
 * genuinely mixed file get left alone, and do the real-world amount formats
 * (parenthesised negatives, currency symbols, quoted thousands separators) land
 * on the right side of the count. `app/import.tsx` gates on
 * `signs.uniform && signs.positive > 0`, so a miscount either blocks a clean
 * import or — much worse — waves the ambiguous one through.
 */
import { describe, expect, it } from "vitest";
import { amountSignProfile, splitCsvLine } from "./csv-signs";

/** Builds a CSV with a Date/Description/Amount header and the given amount cells. */
function csvWithAmounts(amounts: string[]): string {
  const rows = amounts.map((a, i) => `2026-01-${String(i + 1).padStart(2, "0")},Coffee,${a}`);
  return ["Date,Description,Amount", ...rows].join("\n");
}

describe("splitCsvLine", () => {
  it("splits a plain line", () => {
    expect(splitCsvLine("a,b,c")).toEqual(["a", "b", "c"]);
  });

  it("keeps a comma inside a quoted field", () => {
    // This is the property the whole module leans on: banks quote descriptions,
    // and a description comma that leaked into the split would shift every
    // later column — the amount would be read out of the wrong cell.
    expect(splitCsvLine('2026-01-01,"TIM HORTONS, WELLAND ON",-4.25')).toEqual([
      "2026-01-01",
      "TIM HORTONS, WELLAND ON",
      "-4.25",
    ]);
  });

  it("trims surrounding whitespace and stray wrapping quotes", () => {
    expect(splitCsvLine(' a , "b" ')).toEqual(["a", "b"]);
  });

  it("preserves empty cells so column positions don't shift", () => {
    expect(splitCsvLine("a,,c")).toEqual(["a", "", "c"]);
  });

  it("known limitation: an escaped \"\" pair loses the field's trailing quote", () => {
    // Characterising real behaviour, not endorsing it. `""` un-escapes
    // correctly mid-field, but the final unwrap regex then strips the quote the
    // field legitimately ends with. Harmless for this module's purpose — the
    // amount column is numeric and never ends in a quote, and the column COUNT
    // is still right — but worth knowing before reusing this parser for
    // description text.
    expect(splitCsvLine('a,"He said ""hi""",b')).toEqual(["a", 'He said "hi', "b"]);
  });
});

describe("amountSignProfile — the ambiguity guard", () => {
  it("flags the debit-positive export that caused the real inversion", () => {
    // The CHANGELOG case: every row positive, so the file cannot say whether
    // these are 50 deposits or 50 purchases. `uniform` is what makes the app
    // stop and ask instead of defaulting to 'income'.
    const profile = amountSignProfile(csvWithAmounts(["4.25", "12.00", "110.50", "8.99"]), "Amount");
    expect(profile).toEqual({ positive: 4, negative: 0, parsed: 4, uniform: true });
  });

  it("flags an all-negative file as uniform too, but import.tsx won't block on it", () => {
    // Still uniform — the file alone can't prove direction either way. The
    // screen's extra `positive > 0` condition is what keeps the common,
    // unambiguous credit-negative export flowing through without a prompt.
    const profile = amountSignProfile(csvWithAmounts(["-4.25", "-12.00", "-8.99"]), "Amount");
    expect(profile).toEqual({ positive: 0, negative: 3, parsed: 3, uniform: true });
  });

  it("leaves a genuinely mixed file alone", () => {
    // Both signs present means the file states its own convention: negatives
    // are spending, positives are income. Nothing to ask.
    const profile = amountSignProfile(csvWithAmounts(["-4.25", "1200.00", "-8.99"]), "Amount");
    expect(profile.uniform).toBe(false);
    expect(profile).toMatchObject({ positive: 1, negative: 2, parsed: 3 });
  });

  it("counts parenthesised accounting negatives as negative, not positive", () => {
    // `(123.45)` is a negative. Reading it as positive would turn a
    // credit-negative export into a fake all-positive one and either raise a
    // bogus prompt or, with one real positive present, mis-state the mix.
    const profile = amountSignProfile(csvWithAmounts(["(4.25)", "(12.00)"]), "Amount");
    expect(profile).toMatchObject({ positive: 0, negative: 2, parsed: 2 });
  });

  it("reads currency symbols and quoted thousands separators", () => {
    const csv = [
      "Date,Description,Amount",
      '2026-01-01,Rent,"$1,850.00"',
      '2026-01-02,Refund,"-$2,000.50"',
    ].join("\n");
    expect(amountSignProfile(csv, "Amount")).toMatchObject({
      positive: 1,
      negative: 1,
      parsed: 2,
    });
  });

  it("reads the amount from the right column when a description contains a comma", () => {
    // The inversion-adjacent failure: a shifted column would read "WELLAND ON"
    // as the amount, drop it as unparseable, and silently report a uniform
    // profile built from a handful of surviving rows.
    const csv = [
      "Date,Description,Amount",
      '2026-01-01,"TIM HORTONS, WELLAND ON",-4.25',
      '2026-01-02,"BCM INSURANCE, WELLAND",-211.21',
    ].join("\n");
    expect(amountSignProfile(csv, "Amount")).toMatchObject({
      positive: 0,
      negative: 2,
      parsed: 2,
    });
  });

  it("ignores zero rows so they can't make a file look mixed", () => {
    // Zero has no sign. Counting it either way would let a $0.00 balance row
    // defeat the uniform check on an otherwise all-positive file.
    const profile = amountSignProfile(csvWithAmounts(["4.25", "0", "0.00", "8.99"]), "Amount");
    expect(profile).toEqual({ positive: 2, negative: 0, parsed: 2, uniform: true });
  });

  it("ignores unparseable rows rather than counting them", () => {
    const profile = amountSignProfile(csvWithAmounts(["4.25", "n/a", "", "PENDING"]), "Amount");
    expect(profile).toEqual({ positive: 1, negative: 0, parsed: 1, uniform: true });
  });

  it("skips blank lines and tolerates CRLF", () => {
    const csv = "Date,Description,Amount\r\n2026-01-01,Coffee,-4.25\r\n\r\n2026-01-02,Tea,-2.50\r\n";
    expect(amountSignProfile(csv, "Amount")).toMatchObject({
      positive: 0,
      negative: 2,
      parsed: 2,
    });
  });

  it("reports nothing parsed when the named column is absent", () => {
    // Not uniform: an unmapped column must not read as a confident answer.
    // `parsed: 0` also keeps `import.tsx` from blocking before the user has
    // finished choosing their column mapping.
    const profile = amountSignProfile(csvWithAmounts(["4.25"]), "Montant");
    expect(profile).toEqual({ positive: 0, negative: 0, parsed: 0, uniform: false });
  });

  it("matches the amount header exactly, not by prefix", () => {
    const csv = ["Date,Amount CAD,Amount", "2026-01-01,-4.25,99.00"].join("\n");
    expect(amountSignProfile(csv, "Amount")).toMatchObject({ positive: 1, negative: 0 });
  });

  it("reports nothing parsed for an empty file", () => {
    expect(amountSignProfile("", "Amount")).toEqual({
      positive: 0,
      negative: 0,
      parsed: 0,
      uniform: false,
    });
  });

  it("reports nothing parsed for a header-only file", () => {
    expect(amountSignProfile("Date,Description,Amount", "Amount")).toEqual({
      positive: 0,
      negative: 0,
      parsed: 0,
      uniform: false,
    });
  });

  it("treats a single-row file as uniform — one row proves no convention", () => {
    expect(amountSignProfile(csvWithAmounts(["4.25"]), "Amount")).toMatchObject({
      parsed: 1,
      uniform: true,
    });
  });
});
