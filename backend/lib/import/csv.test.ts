/**
 * The CSV parser is hand-rolled rather than a dependency, so RFC 4180 edge
 * cases are ours to get right. Bank exports hit most of them: quoted merchant
 * names containing commas, escaped quotes, and CRLF from Windows tools.
 */
import { describe, it, expect } from "vitest";
import { parseCsv } from "./csv";

describe("parseCsv", () => {
  it("parses a plain header and row", () => {
    expect(parseCsv("Date,Description,Amount\n2026-07-02,ZEHRS,-84.20")).toEqual([
      ["Date", "Description", "Amount"],
      ["2026-07-02", "ZEHRS", "-84.20"],
    ]);
  });

  it("keeps commas inside quoted fields", () => {
    // Real case: "TACO BELL WELLAND WELLAND, ON" — the trailing province would
    // otherwise split into an extra column and shift Amount out of position.
    const [, row] = parseCsv('Date,Description,Amount\n2026-07-02,"TACO BELL WELLAND, ON",-8.10');
    expect(row).toEqual(["2026-07-02", "TACO BELL WELLAND, ON", "-8.10"]);
  });

  it("unescapes doubled quotes", () => {
    const [, row] = parseCsv('D,A\n2026-07-02,"MCDONALD""S"');
    expect(row).toEqual(["2026-07-02", 'MCDONALD"S']);
  });

  it("handles CRLF line endings", () => {
    expect(parseCsv("A,B\r\n1,2\r\n")).toEqual([
      ["A", "B"],
      ["1", "2"],
    ]);
  });

  it("skips fully blank lines", () => {
    // Trailing newlines are near-universal in exports and must not become rows.
    expect(parseCsv("A,B\n1,2\n\n")).toEqual([
      ["A", "B"],
      ["1", "2"],
    ]);
  });

  it("returns an empty array for empty input", () => {
    expect(parseCsv("")).toEqual([]);
  });
});
