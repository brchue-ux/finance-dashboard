/**
 * The learning loop's safety rests entirely on the proposed pattern being
 * narrow and the count being honest. Every description below is a real one from
 * the user's RBC/Tangerine/Amazon data; the traps (the "Bill Payment" prefix,
 * the town in a store name) are the exact cases that made first-N-words keying
 * unusable.
 */
import { describe, it, expect } from "vitest";
import { proposeRule, previewPattern, type CorpusRow } from "./rule-proposal";

describe("proposeRule — the default pattern", () => {
  // The order id after the asterisk is what makes every Amazon order look like
  // its own merchant; the default pattern must already be free of it and sweep
  // the siblings in.
  it("proposes the normalized description, catching order-id siblings", () => {
    const corpus: CorpusRow[] = [
      { description: "AMZN MKTP CA*097ZX38Y3", category: null },
      { description: "AMZN MKTP CA*ZZ11AA22B", category: "Shopping" },
      { description: "AMAZON.CA*RT4590000", category: null }, // different merchant string
      { description: "NO FRILLS #3021 WELLAND", category: "Groceries" },
    ];

    const p = proposeRule("AMZN MKTP CA*097ZX38Y3", corpus);

    expect(p.pattern).toBe("AMZN MKTP CA"); // order id stripped
    expect(p.catches).toBe(2); // both AMZN MKTP rows, not AMAZON.CA, not No Frills
  });

  // The safety check: the count alone can't tell you whether you are filling
  // gaps or moving rows that were already right. The breakdown can.
  it("reports where the caught rows currently sit", () => {
    const corpus: CorpusRow[] = [
      { description: "AMZN MKTP CA*097ZX38Y3", category: null },
      { description: "AMZN MKTP CA*ZZ11AA22B", category: "Shopping" },
    ];

    const p = proposeRule("AMZN MKTP CA*097ZX38Y3", corpus);

    expect(p.byCurrentCategory).toEqual({ uncategorized: 1, Shopping: 1 });
  });

  it("always catches the transaction it was proposed from", () => {
    const corpus: CorpusRow[] = [{ description: "TIM HORTONS #2384 WELLAND ON", category: null }];
    expect(proposeRule("TIM HORTONS #2384 WELLAND ON", corpus).catches).toBe(1);
  });
});

describe("proposeRule — the traps a naive default would fall into", () => {
  const billPayments: CorpusRow[] = [
    { description: "Bill Payment - CITY OF WELLAND -", category: null },
    { description: "Bill Payment - ENBRIDGE GAS INC", category: null },
    { description: "Bill Payment - KOODO MOBILE - **", category: null },
  ];

  // The whole reason the default is the full normalized string and not a
  // leading prefix. On real data "Bill Payment" fronts nine unrelated payees.
  it("does NOT propose a pattern that sweeps in unrelated payees", () => {
    const p = proposeRule("Bill Payment - CITY OF WELLAND -", billPayments);
    expect(p.catches).toBe(1); // only the city, not the gas bill or the phone bill
  });

  // Proof, on the same corpus, of what the rejected shortcut would have done —
  // so a future edit that reintroduces prefix-keying fails here.
  it("shows the prefix-keyed pattern would have caught all three", () => {
    expect(previewPattern("BILL PAYMENT", billPayments).catches).toBe(3);
  });
});

describe("previewPattern — widen and narrow", () => {
  const timHortons: CorpusRow[] = [
    { description: "TIM HORTONS #2384 WELLAND ON", category: null },
    { description: "TIM HORTONS #0891 ST CATHARINES", category: null },
  ];

  it("narrow default catches only the one location", () => {
    // Proposed from the Welland row: the town rides along in the default.
    const p = proposeRule("TIM HORTONS #2384 WELLAND ON", timHortons);
    expect(p.pattern).toBe("TIM HORTONS WELLAND ON");
    expect(p.catches).toBe(1);
  });

  it("widening to the merchant alone catches every location", () => {
    expect(previewPattern("TIM HORTONS", timHortons).catches).toBe(2);
  });

  it("an empty or whitespace pattern catches nothing", () => {
    expect(previewPattern("", timHortons).catches).toBe(0);
    expect(previewPattern("   ", timHortons).catches).toBe(0);
  });
});

describe("previewPattern — samples and bucketing", () => {
  it("returns distinct raw descriptions, capped at five", () => {
    const corpus: CorpusRow[] = Array.from({ length: 8 }, (_, i) => ({
      description: `AMZN MKTP CA*ORDER${i}`,
      category: null,
    }));
    // Two extra copies of an existing description — samples must not repeat it.
    corpus.push({ description: "AMZN MKTP CA*ORDER0", category: null });
    corpus.push({ description: "AMZN MKTP CA*ORDER0", category: null });

    const preview = previewPattern("AMZN MKTP CA", corpus);

    expect(preview.samples.length).toBe(5);
    expect(new Set(preview.samples).size).toBe(5); // all distinct
  });

  it("buckets both null and empty-string categories as uncategorized", () => {
    const corpus: CorpusRow[] = [
      { description: "AMZN MKTP CA*A1", category: null },
      { description: "AMZN MKTP CA*B2", category: "" },
      { description: "AMZN MKTP CA*C3", category: "   " },
    ];
    expect(previewPattern("AMZN MKTP CA", corpus).byCurrentCategory).toEqual({ uncategorized: 3 });
  });
});
