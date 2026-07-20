import YahooFinance from "yahoo-finance2";
import type { MarketDataProvider, OHLCVBar } from "./types";

// One shared instance for the whole backend (OHLCV route + alert poller).
// yahoo-finance2@3 requires instantiation; do not use the 2.x default-export style.
export const yahooFinance = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

const RANGE_MONTHS: Record<string, number> = {
  "1mo": 1,
  "3mo": 3,
  "6mo": 6,
  "1y": 12,
  "2y": 24,
  "5y": 60,
};

export class YahooFinanceProvider implements MarketDataProvider {
  async getOHLCV(
    ticker: string,
    range: "1mo" | "3mo" | "6mo" | "1y" | "2y" | "5y"
  ): Promise<OHLCVBar[]> {
    // v3 chart() takes period1, not the old range option
    const period1 = new Date();
    period1.setMonth(period1.getMonth() - RANGE_MONTHS[range]);

    const result = await yahooFinance.chart(ticker, {
      period1,
      interval: range === "1mo" || range === "3mo" ? "1d" : "1wk",
    });

    // Drop incomplete bars. Yahoo appends a bar for the current, still-forming
    // period whose OHLC are null; zero-filling it put a candle at 0 next to real
    // ~$500 candles, so the chart auto-scaled 0..max and crushed all real data
    // into a sliver at the top — a blank-looking chart. A candle needs all four
    // prices, so any null means the bar isn't real yet and must be skipped.
    return (result.quotes ?? [])
      .filter((q) => q.open != null && q.high != null && q.low != null && q.close != null)
      .map((q) => ({
        time: new Date(q.date).toISOString().split("T")[0],
        open: q.open as number,
        high: q.high as number,
        low: q.low as number,
        close: q.close as number,
        volume: q.volume ?? 0,
      }));
  }
}
