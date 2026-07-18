/**
 * Severity for native fires — direct mapping from the condition enum. The
 * keyword classifier (lib/alert-severity.ts) only understands TradingView's
 * free-text conditions.
 */
import type { AlertSeverity } from "@/lib/alert-severity";

const NATIVE_SEVERITY: Record<string, AlertSeverity> = {
  price_above: "green", // target reached
  price_below: "red", // stop-loss territory
  pct_change_up: "green",
  pct_change_down: "red",
};

export function nativeSeverity(conditionType: string): AlertSeverity {
  return NATIVE_SEVERITY[conditionType] ?? "yellow";
}

/** Human condition label for native alerts, e.g. "Price above $150.00". */
export function nativeConditionLabel(conditionType: string, threshold: number): string {
  switch (conditionType) {
    case "price_above":
      return `Price above $${threshold.toFixed(2)}`;
    case "price_below":
      return `Price below $${threshold.toFixed(2)}`;
    case "pct_change_up":
      return `Up ${(threshold * 100).toFixed(1)}% today`;
    case "pct_change_down":
      return `Down ${(threshold * 100).toFixed(1)}% today`;
    default:
      return conditionType;
  }
}
