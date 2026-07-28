/**
 * C2 — the shared body gate for the money-write routes.
 *
 * `coerceInteger` exists because of a real hole found while re-running the
 * review's reproductions: `POST /api/budget/allocations/reallocate` with
 * `{"year": []}` returned 200 and wrote two envelope_allocations rows for
 * year 0, because `Number([])` is 0 and `Number.isInteger(0)` is true.
 */
import { describe, it, expect } from "vitest";
import {
  readJsonObject,
  coerceInteger,
  coerceMoneyAmount,
  MAX_MONEY_DOLLARS,
} from "./request-body";
import { toCents } from "./money";

function jsonRequest(body: string): Request {
  return new Request("http://localhost/x", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
}

describe("readJsonObject", () => {
  it("returns the parsed object for a well-formed body", async () => {
    await expect(readJsonObject(jsonRequest('{"a":1}'))).resolves.toEqual({ a: 1 });
  });

  it("returns null for malformed JSON", async () => {
    await expect(readJsonObject(jsonRequest("not-json"))).resolves.toBeNull();
  });

  it("returns null for an empty body", async () => {
    await expect(readJsonObject(jsonRequest(""))).resolves.toBeNull();
  });

  it("returns null for JSON that is not an object", async () => {
    for (const body of ['"a string"', "42", "true", "null", "[1,2]"]) {
      await expect(readJsonObject(jsonRequest(body))).resolves.toBeNull();
    }
  });
});

describe("coerceInteger", () => {
  it("accepts integers and integral numeric strings", () => {
    expect(coerceInteger(2026)).toBe(2026);
    expect(coerceInteger("2026")).toBe(2026);
    expect(coerceInteger(0)).toBe(0);
    expect(coerceInteger(-3)).toBe(-3);
  });

  it("rejects the values Number() silently coerces to a valid integer", () => {
    // The reallocate hole: each of these passed `Number.isInteger(Number(v))`.
    expect(coerceInteger([])).toBeNull();
    expect(coerceInteger(true)).toBeNull();
    expect(coerceInteger(false)).toBeNull();
    expect(coerceInteger(null)).toBeNull();
    expect(coerceInteger("")).toBeNull();
    expect(coerceInteger("   ")).toBeNull();
    expect(coerceInteger([7])).toBeNull();
  });

  it("rejects non-integers and non-finite values", () => {
    expect(coerceInteger(2026.5)).toBeNull();
    expect(coerceInteger("2026.5")).toBeNull();
    expect(coerceInteger(NaN)).toBeNull();
    expect(coerceInteger(Infinity)).toBeNull();
    expect(coerceInteger(undefined)).toBeNull();
    expect(coerceInteger({})).toBeNull();
  });
});

describe("coerceMoneyAmount", () => {
  it("accepts ordinary amounts of either sign, as number or numeric string", () => {
    expect(coerceMoneyAmount(10.005)).toBe(10.005);
    expect(coerceMoneyAmount(-42.5)).toBe(-42.5);
    expect(coerceMoneyAmount("19.99")).toBe(19.99);
    expect(coerceMoneyAmount(0)).toBe(0);
  });

  it("rejects the values Number() silently coerces to a valid amount", () => {
    expect(coerceMoneyAmount([])).toBeNull();
    expect(coerceMoneyAmount(true)).toBeNull();
    expect(coerceMoneyAmount(null)).toBeNull();
    expect(coerceMoneyAmount("")).toBeNull();
    expect(coerceMoneyAmount("   ")).toBeNull();
    expect(coerceMoneyAmount(undefined)).toBeNull();
    expect(coerceMoneyAmount({})).toBeNull();
  });

  it("rejects non-finite values", () => {
    expect(coerceMoneyAmount(NaN)).toBeNull();
    expect(coerceMoneyAmount(Infinity)).toBeNull();
    expect(coerceMoneyAmount(-Infinity)).toBeNull();
  });

  it("bounds the magnitude so an absurd amount is a 400, not a 500", () => {
    // toCents throws a RangeError past its safe-integer cents range; a throw in
    // a route handler is an unhandled 500 for what is squarely client input.
    expect(coerceMoneyAmount(1e20)).toBeNull();
    expect(coerceMoneyAmount(-1e20)).toBeNull();
    expect(coerceMoneyAmount(MAX_MONEY_DOLLARS)).toBe(MAX_MONEY_DOLLARS);
  });

  it("keeps the bound comfortably inside what toCents can represent", () => {
    expect(() => toCents(MAX_MONEY_DOLLARS)).not.toThrow();
    expect(() => toCents(-MAX_MONEY_DOLLARS)).not.toThrow();
  });
});
