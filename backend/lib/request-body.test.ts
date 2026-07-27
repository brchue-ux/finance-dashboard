/**
 * C2 — the shared body gate for the money-write routes.
 *
 * `coerceInteger` exists because of a real hole found while re-running the
 * review's reproductions: `POST /api/budget/allocations/reallocate` with
 * `{"year": []}` returned 200 and wrote two envelope_allocations rows for
 * year 0, because `Number([])` is 0 and `Number.isInteger(0)` is true.
 */
import { describe, it, expect } from "vitest";
import { readJsonObject, coerceInteger } from "./request-body";

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
