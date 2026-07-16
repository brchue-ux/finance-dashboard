/**
 * Classifies TradingView alert condition text into a severity color.
 *
 * Red   — risk / urgent (oversold, breakdown, stop-loss)
 * Yellow — neutral signals (crossover, volume spike)
 * Green  — positive (overbought, breakout, target reached)
 */

export type AlertSeverity = "red" | "yellow" | "green";

const RED_KEYWORDS = [
  "oversold", "breakdown", "stop-loss", "stop loss", "death cross",
  "support broken", "bearish", "downtrend", "sell signal",
];

const GREEN_KEYWORDS = [
  "overbought", "breakout", "target reached", "golden cross",
  "resistance broken", "bullish", "uptrend", "buy signal",
];

export function classifySeverity(conditionText: string): AlertSeverity {
  const lower = conditionText.toLowerCase();

  if (RED_KEYWORDS.some((kw) => lower.includes(kw))) return "red";
  if (GREEN_KEYWORDS.some((kw) => lower.includes(kw))) return "green";
  return "yellow";
}
