import { describe, it, expect } from "vitest";
import { lastSessionOnly } from "./yahoo";

// Unix seconds for a UTC datetime — intraday bar times as the provider emits them.
const t = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

describe("lastSessionOnly", () => {
  it("keeps only bars from the most recent trading day", () => {
    const bars = [
      { time: t("2026-07-20T13:30:00Z") }, // Monday session
      { time: t("2026-07-20T20:00:00Z") },
      { time: t("2026-07-21T13:30:00Z") }, // Tuesday session — the one to keep
      { time: t("2026-07-21T15:00:00Z") },
      { time: t("2026-07-21T20:00:00Z") },
    ];
    const out = lastSessionOnly(bars);
    expect(out).toHaveLength(3);
    expect(out.every((b) => new Date(b.time * 1000).toISOString().startsWith("2026-07-21"))).toBe(true);
  });

  it("returns everything when all bars are one session (mid-day fetch)", () => {
    const bars = [{ time: t("2026-07-22T13:30:00Z") }, { time: t("2026-07-22T15:05:00Z") }];
    expect(lastSessionOnly(bars)).toEqual(bars);
  });

  it("handles empty input", () => {
    expect(lastSessionOnly([])).toEqual([]);
  });

  it("survives a weekend gap — last Friday wins, not calendar yesterday", () => {
    const bars = [
      { time: t("2026-07-16T14:00:00Z") }, // Thursday
      { time: t("2026-07-17T14:00:00Z") }, // Friday
      { time: t("2026-07-17T19:55:00Z") },
    ];
    const out = lastSessionOnly(bars);
    expect(out).toHaveLength(2);
    expect(out[0].time).toBe(t("2026-07-17T14:00:00Z"));
  });
});
