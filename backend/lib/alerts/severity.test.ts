/**
 * Two severity paths exist for a reason and are easy to conflate: native fires
 * map from a closed condition enum, TradingView fires classify free text. A
 * wrong severity here mislabels a stop-loss as good news.
 */
import { describe, it, expect } from "vitest";
import { nativeSeverity, nativeConditionLabel } from "./severity";
import { classifySeverity } from "@/lib/alert-severity";

describe("nativeSeverity", () => {
  it("treats downside conditions as red", () => {
    expect(nativeSeverity("price_below")).toBe("red");
    expect(nativeSeverity("pct_change_down")).toBe("red");
  });

  it("treats upside conditions as green", () => {
    expect(nativeSeverity("price_above")).toBe("green");
    expect(nativeSeverity("pct_change_up")).toBe("green");
  });

  it("falls back to yellow for an unknown condition", () => {
    // A new condition type must not silently inherit a misleading colour.
    expect(nativeSeverity("some_future_condition")).toBe("yellow");
  });
});

describe("nativeConditionLabel", () => {
  it("formats price thresholds as currency", () => {
    expect(nativeConditionLabel("price_above", 150)).toBe("Price above $150.00");
    expect(nativeConditionLabel("price_below", 42.5)).toBe("Price below $42.50");
  });

  it("formats percentage thresholds as percentages", () => {
    // Thresholds are stored as fractions; rendering 0.05 as "5%" not "0.05%".
    expect(nativeConditionLabel("pct_change_up", 0.05)).toBe("Up 5.0% today");
    expect(nativeConditionLabel("pct_change_down", 0.125)).toBe("Down 12.5% today");
  });

  it("falls back to the raw condition rather than inventing a label", () => {
    expect(nativeConditionLabel("unknown_condition", 1)).toBe("unknown_condition");
  });
});

describe("classifySeverity — TradingView free text", () => {
  it("classifies risk language as red", () => {
    expect(classifySeverity("RSI oversold on daily")).toBe("red");
    expect(classifySeverity("Stop-loss triggered")).toBe("red");
    expect(classifySeverity("Death cross forming")).toBe("red");
  });

  it("classifies positive language as green", () => {
    expect(classifySeverity("Breakout above resistance")).toBe("green");
    expect(classifySeverity("Target reached")).toBe("green");
  });

  it("defaults to yellow for neutral text", () => {
    expect(classifySeverity("Volume spike detected")).toBe("yellow");
    expect(classifySeverity("")).toBe("yellow");
  });

  it("is case-insensitive", () => {
    expect(classifySeverity("BEARISH ENGULFING")).toBe("red");
  });

  it("prefers red when both red and green language appear", () => {
    // Ambiguous text should err toward the risk reading, not the reassuring one.
    expect(classifySeverity("bearish divergence despite breakout")).toBe("red");
  });
});
