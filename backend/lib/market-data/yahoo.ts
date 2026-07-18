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

    return (result.quotes ?? []).map((q) => ({
      time: new Date(q.date).toISOString().split("T")[0],
      open: q.open ?? 0,
      high: q.high ?? 0,
      low: q.low ?? 0,
      close: q.close ?? 0,
      volume: q.volume ?? 0,
    }));
  }
}
