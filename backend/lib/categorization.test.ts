/**
 * Categorization is the most bug-prone module in the app: it decides which
 * envelope real money lands in, and it silently produces a wrong-but-plausible
 * answer rather than throwing. Every case below is drawn from an actual bug or
 * an actual transaction description, not invented.
 */
import { describe, it, expect } from "vitest";
import { categorize, normalizeDescription, DEFAULT_RULES, type Envelope } from "./categorization";

/** The shipped ruleset, in the order the app applies it. */
const envelopes: Envelope[] = Object.entries(DEFAULT_RULES).map(
  ([name, categoryRules], sortOrder) => ({ name, categoryRules, sortOrder })
);

describe("normalizeDescription", () => {
  it("strips branch codes and collapses whitespace", () => {
    expect(normalizeDescription("MCDONALD'S #16639  QPS ST CATHARINES")).toBe(
      "MCDONALD'S QPS ST CATHARINES"
    );
  });

  it("uppercases", () => {
    expect(normalizeDescription("Subway 13756 Welland")).toBe("SUBWAY 13756 WELLAND");
  });
});

describe("categorize — bugs found against real transaction data", () => {
  // Each of these shipped miscategorized. The rule existed; the matcher
  // couldn't reach it because the bank writes the merchant differently.

  it('matches "A&W" rule against "A & W" as written by the bank', () => {
    // Was uncategorized across 13 real rows.
    expect(categorize("A & W #4910 NIAGARA ST WELLA", envelopes)).toBe("Restaurants");
  });

  it('matches "UBER EATS" rule against the concatenated "UBEREATS"', () => {
    // Transport's "UBER" rule was claiming food delivery on sort order.
    expect(categorize("UBER CANADA/UBEREATS TORONTO", envelopes)).toBe("Restaurants");
  });

  it("still routes an actual Uber ride to Transport", () => {
    // Guards the fix above from over-correcting.
    expect(categorize("UBER* TRIP TORONTO", envelopes)).toBe("Transport");
  });

  it('matches "STEAM " rule against "STEAMGAMES.COM"', () => {
    expect(categorize("STEAMGAMES.COM 4259522985 912-1844160", envelopes)).toBe("Entertainment");
  });

  it("routes TACO BELL to Restaurants, not Utilities", () => {
    // Utilities' "BELL" rule sorts after Restaurants, but only an explicit
    // TACO BELL rule keeps it from winning on a bare substring match.
    expect(categorize("TACO BELL WELLAND WELLAND, ON", envelopes)).toBe("Restaurants");
  });
});

describe("categorize — regression guards", () => {
  // A punctuation-stripping matcher fixed the cases above but made "BELL"
  // match inside unrelated words. Aggregate counts made that look like an
  // improvement; only these cases exposed it.

  it('does not let "BELL" match "BELLIES"', () => {
    expect(categorize("M.T. BELLIES TAP & GRILLH WELLAND", envelopes)).not.toBe("Utilities");
  });

  it('does not let "BELL" match "BELLAS"', () => {
    expect(categorize("WWW.BELLAS* BELLASANDB WELLAND", envelopes)).not.toBe("Utilities");
  });

  it("still matches Bell as an actual utility", () => {
    expect(categorize("BELL CANADA MONTREAL", envelopes)).toBe("Utilities");
  });
});

describe("categorize — ordering and fallback", () => {
  it("returns uncategorized when nothing matches", () => {
    // WAL-MART SUPERCENTER genuinely has no rule; it needs a user decision
    // about which envelope it belongs to, so it must not be guessed into one.
    expect(categorize("WAL-MART SUPERCENTER#3110 WE", envelopes)).toBe("uncategorized");
  });

  it("returns uncategorized against an empty envelope list", () => {
    // The state the app shipped in: no envelopes existed, so every transaction
    // took this path and 1,758 of 1,762 rows landed uncategorized.
    expect(categorize("NO FRILLS #3021", [])).toBe("uncategorized");
  });

  it("respects sortOrder — lower wins on a tie", () => {
    const tied: Envelope[] = [
      { name: "Second", categoryRules: ["SHARED"], sortOrder: 2 },
      { name: "First", categoryRules: ["SHARED"], sortOrder: 1 },
    ];
    expect(categorize("SHARED MERCHANT", tied)).toBe("First");
  });

  it("ignores empty rules rather than matching everything", () => {
    const withEmpty: Envelope[] = [{ name: "Bad", categoryRules: [""], sortOrder: 0 }];
    expect(categorize("ANYTHING AT ALL", withEmpty)).toBe("uncategorized");
  });
});

describe("categorize — real merchants that should keep working", () => {
  const cases: [string, string][] = [
    ["NO FRILLS #3021 WELLAND", "Groceries"],
    ["LOBLAWS WELLAND", "Groceries"],
    ["TIM HORTONS #3625 NIAGARA FALLS", "Restaurants"],
    ["MCDONALD'S #16639 QPS ST CATHARINES", "Restaurants"],
    ["STARBUCKS COFFEE #4841 ST CATHARINES", "Restaurants"],
    ["PETRO-CANADA 05100 WELLAND", "Transport"],
    ["SHELL C22517 WELLAND", "Transport"],
    ["HONK PARKING 866-675-7337", "Transport"],
    ["NETFLIX.COM 844-5052993", "Utilities"],
    ["AMAZON.CA ORDER", "Shopping"],
    ["SHOPPERS DRUG MART #1234", "Healthcare"],
    ["CINEPLEX 7206 QPS WELLAND", "Entertainment"],
  ];

  it.each(cases)("%s -> %s", (description, expected) => {
    expect(categorize(description, envelopes)).toBe(expected);
  });
});
