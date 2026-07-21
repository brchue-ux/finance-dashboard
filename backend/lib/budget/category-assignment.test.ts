import { describe, expect, it } from "vitest";
import { resolveCategoryAssignment } from "./category-assignment";

// The real 16-envelope taxonomy's spellings, since the canonicalization tests
// are only meaningful against names a user actually has.
const ENVELOPES = [
  { name: "Groceries" },
  { name: "Restaurants" },
  { name: "Home & Hardware" },
  { name: "Fees & Interest" },
];

describe("resolveCategoryAssignment", () => {
  it("accepts an exact envelope name", () => {
    expect(resolveCategoryAssignment("Groceries", ENVELOPES)).toEqual({
      ok: true,
      category: "Groceries",
    });
  });

  // The whole reason this function exists: `transactions.category` stores the
  // name, so writing the user's casing would split one envelope's spend into
  // two categories that no query joins back together.
  it("returns the envelope's own spelling, not the submitted one", () => {
    expect(resolveCategoryAssignment("groceries", ENVELOPES)).toEqual({
      ok: true,
      category: "Groceries",
    });
    expect(resolveCategoryAssignment("GROCERIES", ENVELOPES)).toEqual({
      ok: true,
      category: "Groceries",
    });
  });

  it("ignores surrounding whitespace", () => {
    expect(resolveCategoryAssignment("  Restaurants  ", ENVELOPES)).toEqual({
      ok: true,
      category: "Restaurants",
    });
  });

  it("matches names containing punctuation and spaces", () => {
    expect(resolveCategoryAssignment("home & hardware", ENVELOPES)).toEqual({
      ok: true,
      category: "Home & Hardware",
    });
  });

  it("rejects a name that matches no envelope", () => {
    const result = resolveCategoryAssignment("Groceries & Sundries", ENVELOPES);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("does not name one of your envelopes");
  });

  // Substring matching would make "Home" silently resolve to "Home & Hardware".
  // Assignment is an exact choice from a list the user is shown; it is not
  // the fuzzy merchant matching that categorize() does.
  it("does not resolve a partial name", () => {
    expect(resolveCategoryAssignment("Home", ENVELOPES).ok).toBe(false);
    expect(resolveCategoryAssignment("Fees", ENVELOPES).ok).toBe(false);
  });

  it("allows clearing back to uncategorized", () => {
    expect(resolveCategoryAssignment("uncategorized", ENVELOPES)).toEqual({
      ok: true,
      category: "uncategorized",
    });
    expect(resolveCategoryAssignment("Uncategorized", ENVELOPES)).toEqual({
      ok: true,
      category: "uncategorized",
    });
  });

  it("prefers a real envelope named Uncategorized over clearing", () => {
    const withEnvelope = [{ name: "Uncategorized" }];
    expect(resolveCategoryAssignment("uncategorized", withEnvelope)).toEqual({
      ok: true,
      category: "Uncategorized",
    });
  });

  it("rejects empty and whitespace-only input", () => {
    expect(resolveCategoryAssignment("", ENVELOPES).ok).toBe(false);
    expect(resolveCategoryAssignment("   ", ENVELOPES).ok).toBe(false);
  });

  it("rejects non-string input off the request body", () => {
    expect(resolveCategoryAssignment(undefined, ENVELOPES).ok).toBe(false);
    expect(resolveCategoryAssignment(null, ENVELOPES).ok).toBe(false);
    expect(resolveCategoryAssignment(42, ENVELOPES).ok).toBe(false);
    expect(resolveCategoryAssignment(["Groceries"], ENVELOPES).ok).toBe(false);
    expect(resolveCategoryAssignment({ name: "Groceries" }, ENVELOPES).ok).toBe(false);
  });

  // The caller passes only active envelopes. An empty list is what a user with
  // no envelopes at all sees, and it must not become a way to write arbitrary
  // strings into `category`.
  it("rejects everything but uncategorized when there are no envelopes", () => {
    expect(resolveCategoryAssignment("Groceries", []).ok).toBe(false);
    expect(resolveCategoryAssignment("uncategorized", [])).toEqual({
      ok: true,
      category: "uncategorized",
    });
  });
});
