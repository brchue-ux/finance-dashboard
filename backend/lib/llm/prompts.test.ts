import { describe, it, expect } from "vitest";
import { autoCardInstruction } from "./prompts";

/**
 * The portfolio context carries no envelopes. A shared instruction that demands
 * envelope-named action cards therefore asked the portfolio request for
 * something its data could not supply — and on 2026-07-23 a real nightly item
 * answered in prose, costing the whole view's cards.
 */
describe("autoCardInstruction", () => {
  const budget = autoCardInstruction("budget");
  const portfolio = autoCardInstruction("portfolio");

  it("gives the budget view the action-card schema and envelope rules", () => {
    expect(budget).toContain("envelope_from");
    expect(budget).toContain("envelope_to");
    expect(budget).toContain('"type": "action"');
    expect(budget).toContain("Never invent an envelope");
  });

  it("never mentions envelopes to the portfolio view", () => {
    expect(portfolio).not.toContain("envelope_from");
    expect(portfolio).not.toContain("envelope_to");
    expect(portfolio).not.toContain('"type": "action"');
    expect(portfolio.toLowerCase()).not.toContain("envelope");
  });

  it("tells the portfolio view every card is an insight", () => {
    expect(portfolio).toContain('Every card is type "insight"');
  });

  it("offers both views an empty-array escape instead of prose", () => {
    for (const instruction of [budget, portfolio]) {
      expect(instruction).toContain('{"cards": []}');
      expect(instruction).toContain("Never explain yourself in");
    }
  });

  it("keeps the shared JSON-only and length rules in both views", () => {
    for (const instruction of [budget, portfolio]) {
      expect(instruction).toContain("Respond with a JSON object only");
      expect(instruction).toContain('"cards": [');
      expect(instruction).toContain("at most 6 words");
      expect(instruction).toContain("Generate 2-5 cards");
    }
  });
});
