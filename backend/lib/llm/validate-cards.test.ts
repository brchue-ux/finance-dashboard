import { describe, it, expect } from "vitest";
import {
  extractMoney,
  extractPercentClaims,
  extractContextNumbers,
  isGrounded,
  percentClaimHolds,
  validateCards,
  extractDiffClaims,
  diffClaimHolds,
} from "./validate-cards";

// The context numbers behind the REAL observed failure.
const CONTEXT = "Restaurants: spent 376.14 of target 750. Shopping: spent 1659.73 of target 1200.";

describe("extractMoney", () => {
  it("parses $1,234.56 and $1.6k, ignores bare counts", () => {
    expect(extractMoney("spent $1,234.56 and $1.6k over 9 days, 15+ orders")).toEqual([1234.56, 1600]);
  });
});

describe("extractPercentClaims", () => {
  it("captures the relation word", () => {
    expect(extractPercentClaims("that's 50% over your target")).toEqual([{ pct: 50, relation: "over" }]);
    expect(extractPercentClaims("15% of the envelope")).toEqual([{ pct: 15, relation: "of" }]);
    expect(extractPercentClaims("up 12% this month")).toEqual([{ pct: 12, relation: null }]);
  });
});

describe("extractContextNumbers", () => {
  it("excludes years so amounts can't ground against dates", () => {
    const nums = extractContextNumbers("2026-07-14 amount 376.14");
    expect(nums).toContain(376.14);
    expect(nums).not.toContain(2026);
    // date fragments (7, 14) are real tokens — harmless as grounding base
  });
});

describe("isGrounded", () => {
  const ctx = [1659.73, 1200, 750, 376.14];
  it("accepts context values with prose rounding", () => {
    expect(isGrounded(1660, ctx)).toBe(true); // $1,660 for 1659.73
  });
  it("accepts differences — 'over by $460' from 1660 and 1200", () => {
    expect(isGrounded(460, ctx)).toBe(true);
  });
  it("accepts 12× annualization", () => {
    expect(isGrounded(750 * 12, ctx)).toBe(true);
  });
  it("rejects a hallucinated amount", () => {
    expect(isGrounded(999, ctx)).toBe(false);
  });
});

describe("percentClaimHolds — the real observed failure", () => {
  it("rejects '$376 is 50% OVER $750' (it is 50% OF)", () => {
    expect(percentClaimHolds({ pct: 50, relation: "over" }, [376, 750], [376.14, 750])).toBe(false);
  });
  it("accepts '$376 is 50% of $750'", () => {
    expect(percentClaimHolds({ pct: 50, relation: "of" }, [376, 750], [376.14, 750])).toBe(true);
  });
  it("accepts a true 'over': $1,660 is 38% over $1,200", () => {
    expect(percentClaimHolds({ pct: 38, relation: "over" }, [1660, 1200], [])).toBe(true);
  });
  it("bare percent is lenient — passes when any form fits", () => {
    expect(percentClaimHolds({ pct: 50, relation: null }, [376, 750], [])).toBe(true);
  });
  it("no money cited → nothing to relate → passes", () => {
    expect(percentClaimHolds({ pct: 40, relation: "over" }, [], [100])).toBe(true);
  });
});

describe("validateCards", () => {
  it("drops the wrong-relation card and keeps the correct one", () => {
    const cards = [
      { type: "insight", title: "Restaurants hot", body: "You've spent $376, 50% over your $750 target." },
      { type: "insight", title: "Shopping over", body: "$1,660 spent, $460 over your $1,200 budget." },
    ];
    const { cards: kept, dropped } = validateCards(cards, CONTEXT);
    expect(kept.map((c) => c.title)).toEqual(["Shopping over"]);
    expect(dropped[0].title).toBe("Restaurants hot");
    expect(dropped[0].reasons[0]).toContain("50% over");
  });

  it("drops a card citing an underivable amount", () => {
    const cards = [{ type: "insight", title: "Ghost", body: "You spent $999 on mystery." }];
    const { cards: kept, dropped } = validateCards(cards, CONTEXT);
    expect(kept).toEqual([]);
    expect(dropped[0].reasons[0]).toContain("$999");
  });

  it("keeps a card with no numbers at all", () => {
    const cards = [{ type: "insight", title: "Note", body: "Consider reviewing subscriptions." }];
    expect(validateCards(cards, CONTEXT).cards).toHaveLength(1);
  });
});

describe("diff claims — the live kept-card failure", () => {
  it("drops '$460 Over' when the card's own numbers are $670 and $1,210", () => {
    const cards = [{
      type: "insight",
      title: "Restaurants Running $460 Over",
      body: "You've spent ~$670 at restaurants this month against a $1,210 budget.",
    }];
    // 460, 670 and 1210 all ground (borrowed from other envelopes' context)
    const ctx = "Shopping spent 1660 target 1200. Restaurants budget 1210 spent 670.";
    const { cards: kept, dropped } = validateCards(cards, ctx);
    expect(kept).toEqual([]);
    expect(dropped[0].reasons[0]).toContain("$460");
  });

  it("keeps '$37 Over Budget' when $212 − $175 = $37", () => {
    const cards = [{
      type: "insight",
      title: "Personal Care $37 Over Budget",
      body: "The $212 salon visit consumed the entire $175 budget.",
    }];
    expect(validateCards(cards, "salon 212 budget 175").cards).toHaveLength(1);
  });

  it("does not misread 'over-budgeted at $1,210' as a difference claim", () => {
    expect(extractDiffClaims("over-budgeted at $1,210 vs its $750 target")).toEqual([]);
  });

  it("passes an uncheckable diff (fewer than two other amounts cited)", () => {
    expect(diffClaimHolds(40, [40])).toBe(true);
  });
});
