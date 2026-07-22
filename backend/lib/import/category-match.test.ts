import { describe, expect, it } from "vitest";
import {
  analyzeSourceCategories,
  resolveImportCategory,
  suggestEnvelope,
} from "./category-match";

// The shape observed in the wild: a US budget-app export whose categories
// mostly miss this household's envelope set — 6 of 10 unmatched, silently.
const ENVELOPES = [
  { name: "Groceries" },
  { name: "Restaurants" },
  { name: "Transport" },
  { name: "Healthcare" },
];

describe("analyzeSourceCategories", () => {
  it("splits a file's categories into matched and unmatched with row counts", () => {
    const rows = [
      { category: "Groceries" },
      { category: "Groceries" },
      { category: "Dining" },
      { category: "Dining" },
      { category: "Dining" },
      { category: "Pets" },
      { category: undefined },
    ];
    const { matched, unmatched } = analyzeSourceCategories(rows, ENVELOPES);
    expect(matched).toEqual([{ source: "Groceries", envelope: "Groceries", rows: 2 }]);
    // Biggest impact first — Dining's 3 rows before Pets' 1.
    expect(unmatched.map((u) => [u.source, u.rows])).toEqual([
      ["Dining", 3],
      ["Pets", 1],
    ]);
  });

  it("matches case- and whitespace-insensitively, reporting the envelope's own spelling", () => {
    const { matched, unmatched } = analyzeSourceCategories(
      [{ category: "  groceries " }, { category: "GROCERIES" }],
      ENVELOPES
    );
    expect(unmatched).toEqual([]);
    // One distinct category, not two — and resolved to "Groceries", because
    // storing the file's casing verbatim is what fragments an envelope's totals.
    expect(matched).toEqual([{ source: "groceries", envelope: "Groceries", rows: 2 }]);
  });

  it("attaches a suggestion to an unmatched category when an envelope looks close", () => {
    const { unmatched } = analyzeSourceCategories([{ category: "Dining" }], ENVELOPES);
    expect(unmatched).toEqual([{ source: "Dining", rows: 1, suggestion: "Restaurants" }]);
  });

  it("returns nothing for rows without a category", () => {
    const { matched, unmatched } = analyzeSourceCategories(
      [{ category: undefined }, { category: "  " }],
      ENVELOPES
    );
    expect(matched).toEqual([]);
    expect(unmatched).toEqual([]);
  });
});

describe("suggestEnvelope", () => {
  it("suggests by substring containment in either direction", () => {
    // source ⊂ envelope name
    expect(suggestEnvelope("Health", ENVELOPES)).toBe("Healthcare");
    // envelope name ⊂ source
    expect(suggestEnvelope("Transport & Parking", ENVELOPES)).toBe("Transport");
  });

  it("suggests via the synonym table when no text is shared", () => {
    expect(suggestEnvelope("Dining", ENVELOPES)).toBe("Restaurants");
    expect(suggestEnvelope("Gas", ENVELOPES)).toBe("Transport");
    expect(suggestEnvelope("Medical", ENVELOPES)).toBe("Healthcare");
  });

  it("never suggests an envelope the user does not have", () => {
    // "dining" → "restaurants" is in the synonym table, but this user has no
    // Restaurants envelope — a suggestion must propose against THEIR set.
    expect(suggestEnvelope("Dining", [{ name: "Groceries" }])).toBeUndefined();
  });

  it("returns undefined when nothing is close", () => {
    expect(suggestEnvelope("Pets", ENVELOPES)).toBeUndefined();
  });

  it("refuses substring matches on strings too short to mean anything", () => {
    // "GO" ⊂ "Groceries"? No — two chars contain by accident, not by meaning.
    expect(suggestEnvelope("Go", ENVELOPES)).toBeUndefined();
    // Same rule on the envelope side: a 2-char envelope name ("TV") would
    // otherwise claim any source containing those letters.
    expect(suggestEnvelope("Pets TV", [{ name: "TV" }])).toBeUndefined();
  });
});

describe("resolveImportCategory", () => {
  it("resolves an envelope match to the envelope's own spelling", () => {
    expect(resolveImportCategory("  groceries ", ENVELOPES)).toEqual({
      category: "Groceries",
      mapped: false,
    });
  });

  it("stores an unmatched, unmapped category verbatim — a warning, not a gate", () => {
    expect(resolveImportCategory(" Pets ", ENVELOPES)).toEqual({
      category: "Pets",
      mapped: false,
    });
  });

  it("applies a user-confirmed mapping ahead of everything, flagged as mapped", () => {
    const mappings = { dining: "Restaurants" };
    expect(resolveImportCategory("Dining", ENVELOPES, mappings)).toEqual({
      category: "Restaurants",
      mapped: true,
    });
  });

  it("matches mapping keys normalized so the file's casing cannot dodge one", () => {
    const mappings = { dining: "Restaurants" };
    expect(resolveImportCategory("  DINING ", ENVELOPES, mappings)).toEqual({
      category: "Restaurants",
      mapped: true,
    });
  });

  it("a mapping can even override an exact envelope match", () => {
    // The user saw the preview and decided their file's "Groceries" rows
    // belong in Restaurants — their call wins over the resolver's.
    const mappings = { groceries: "Restaurants" };
    expect(resolveImportCategory("Groceries", ENVELOPES, mappings)).toEqual({
      category: "Restaurants",
      mapped: true,
    });
  });
});
