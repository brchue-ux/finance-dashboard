import { describe, it, expect } from "vitest";
import { parseCards, stripCodeFence } from "./parse-cards";

/**
 * Every case here is a real failure mode observed in the nightly Batch runs
 * of 2026-07-19/20, not a hypothetical.
 */
describe("stripCodeFence", () => {
  it("unwraps the ```json fence the model actually emitted", () => {
    expect(stripCodeFence('```json\n{"cards": []}\n```')).toBe('{"cards": []}');
  });

  it("unwraps an unlabelled fence", () => {
    expect(stripCodeFence('```\n{"cards": []}\n```')).toBe('{"cards": []}');
  });

  it("leaves bare JSON untouched", () => {
    expect(stripCodeFence('{"cards": []}')).toBe('{"cards": []}');
  });

  it("extracts the block when the model adds a lead-in sentence", () => {
    expect(stripCodeFence('Here you go:\n```json\n{"cards": []}\n```')).toBe('{"cards": []}');
  });
});

describe("parseCards", () => {
  it("parses the fenced response that was being counted as a failure", () => {
    const real =
      '```json\n{\n  "cards": [\n    {\n      "type": "insight",\n' +
      '      "title": "Portfolio Data Unavailable",\n      "body": "...",\n' +
      '      "reasoning": "..."\n    }\n  ]\n}\n```';
    const cards = parseCards(real);
    expect(cards).toHaveLength(1);
    expect((cards[0] as { title: string }).title).toBe("Portfolio Data Unavailable");
  });

  it("parses bare JSON, the format the prompt actually asks for", () => {
    expect(parseCards('{"cards": [{"type": "action"}]}')).toHaveLength(1);
  });

  it("throws a stated reason when the response was truncated to no text", () => {
    // stop_reason "max_tokens" with only a server_tool_use block => empty text
    expect(() => parseCards("")).toThrow(/no text/);
  });

  it("throws when the body is not JSON at all", () => {
    expect(() => parseCards("I'm sorry, I can't help with that.")).toThrow(/invalid card JSON/);
  });

  it("rejects well-formed JSON with no cards array rather than yielding undefined", () => {
    // This used to return undefined and reach JSON.stringify(), writing the
    // string "undefined" into a NOT NULL column.
    expect(() => parseCards('{"insights": []}')).toThrow(/no "cards" array/);
  });

  it("rejects a cards key that is not an array", () => {
    expect(() => parseCards('{"cards": "none"}')).toThrow(/no "cards" array/);
  });

  it("accepts an empty card list — a valid 'nothing notable' answer", () => {
    expect(parseCards('{"cards": []}')).toEqual([]);
  });
});
