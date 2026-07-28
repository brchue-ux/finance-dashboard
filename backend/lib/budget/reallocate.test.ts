import { describe, it, expect } from "vitest";
import { planReallocation, currentAllocation, type EnvelopeRow } from "./reallocate";

const envelopes: EnvelopeRow[] = [
  { id: "e-groceries", name: "Groceries", monthlyTarget: 800 },
  { id: "e-dining", name: "Restaurants", monthlyTarget: 300 },
  { id: "e-zero", name: "Vacation", monthlyTarget: 0 },
];

describe("currentAllocation", () => {
  it("falls back to the standing monthly target when no override exists", () => {
    expect(currentAllocation(envelopes[0], [])).toBe(800);
  });

  it("prefers a month override over the standing target", () => {
    expect(
      currentAllocation(envelopes[0], [{ envelopeId: "e-groceries", allocated: 950 }])
    ).toBe(950);
  });

  it("ignores overrides belonging to a different envelope", () => {
    expect(
      currentAllocation(envelopes[0], [{ envelopeId: "e-dining", allocated: 10 }])
    ).toBe(800);
  });

  it("honours a zero override rather than treating it as absent", () => {
    // Distinguishes `override ? ...` on the row from on the value: a user who
    // deliberately zeroed an envelope this month must not silently get 800.
    expect(
      currentAllocation(envelopes[0], [{ envelopeId: "e-groceries", allocated: 0 }])
    ).toBe(0);
  });
});

describe("planReallocation", () => {
  function plan(over: Partial<Parameters<typeof planReallocation>[0]> = {}) {
    return planReallocation({
      envelopes,
      allocations: [],
      fromName: "Groceries",
      toName: "Restaurants",
      amount: 100,
      ...over,
    });
  }

  it("moves the amount from source to destination", () => {
    const r = plan();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.from).toMatchObject({ envelopeId: "e-groceries", before: 800, after: 700 });
    expect(r.plan.to).toMatchObject({ envelopeId: "e-dining", before: 300, after: 400 });
  });

  it("conserves the total budgeted", () => {
    const r = plan({ amount: 137.5 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const before = r.plan.from.before + r.plan.to.before;
    const after = r.plan.from.after + r.plan.to.after;
    expect(after).toBeCloseTo(before, 10);
  });

  it("computes from existing month overrides, not the standing targets", () => {
    const r = plan({
      allocations: [{ envelopeId: "e-groceries", allocated: 500 }],
      amount: 100,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.from.after).toBe(400);
  });

  it("matches envelope names case- and whitespace-insensitively", () => {
    // The names come from LLM output, not a picker.
    const r = plan({ fromName: "  groceries ", toName: "RESTAURANTS" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.from.envelopeId).toBe("e-groceries");
    expect(r.plan.to.envelopeId).toBe("e-dining");
  });

  it("rejects a hallucinated source envelope", () => {
    const r = plan({ fromName: "Streaming Subscriptions" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("Streaming Subscriptions");
  });

  it("rejects a hallucinated destination envelope", () => {
    const r = plan({ toName: "Emergency Fund" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("Emergency Fund");
  });

  it("rejects an inactive/absent envelope even when its allocation row exists", () => {
    // Callers pass only active envelopes; a stale allocation must not be
    // enough to resolve a name.
    const r = planReallocation({
      envelopes: envelopes.slice(0, 2),
      allocations: [{ envelopeId: "e-zero", allocated: 400 }],
      fromName: "Vacation",
      toName: "Groceries",
      amount: 50,
    });
    expect(r.ok).toBe(false);
  });

  it("rejects moving an envelope into itself", () => {
    const r = plan({ toName: "Groceries" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/itself/);
  });

  it("rejects overdrawing the source into a negative budget", () => {
    const r = plan({ amount: 900 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("800.00");
  });

  it("allows draining the source to exactly zero", () => {
    const r = plan({ amount: 800 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.from.after).toBe(0);
  });

  it("allows an unconfigured ($0) envelope as the destination", () => {
    const r = plan({ toName: "Vacation" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.to.after).toBe(100);
  });

  it.each([
    ["zero", 0],
    ["negative", -50],
    ["not a number", "soon"],
    ["missing", undefined],
    ["infinite", Infinity],
  ])("rejects a %s amount", (_label, amount) => {
    expect(plan({ amount }).ok).toBe(false);
  });

  it.each([
    ["missing", undefined],
    ["empty", "   "],
    ["non-string", 42],
  ])("rejects a %s envelope name", (_label, fromName) => {
    expect(plan({ fromName }).ok).toBe(false);
  });

  it("rejects a sub-cent amount rather than creating a cent from nothing", () => {
    // Storage quantizes each side independently: 800 − 0.005 rounds down and
    // 300 + 0.005 rounds up, so the total budgeted grows by a cent.
    const r = plan({ amount: 0.005 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/whole number of cents/);
  });

  it("still accepts an ordinary two-decimal amount", () => {
    const r = plan({ amount: 12.34 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.from.after).toBeCloseTo(787.66, 10);
    expect(r.plan.to.after).toBeCloseTo(312.34, 10);
  });

  it("rejects an amount too large to represent as cents", () => {
    // Would otherwise reach toCents and throw a RangeError, i.e. a 500.
    expect(plan({ amount: 1e20 }).ok).toBe(false);
  });

  it("rejects the values Number() silently coerces to a positive amount", () => {
    expect(plan({ amount: true }).ok).toBe(false);
    expect(plan({ amount: [50] }).ok).toBe(false);
  });
});
