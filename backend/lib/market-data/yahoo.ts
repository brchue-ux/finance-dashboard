import yahooFinance from "yahoo-finance2";
import type { MarketDataProvider, OHLCVBar } from "./types";

export class YahooFinanceProvider implements MarketDataProvider {
  async getOHLCV(
    ticker: string,
    range: "1mo" | "3mo" | "6mo" | "1y" | "2y" | "5y"
  ): Promise<OHLCVBar[]> {
    const result = await yahooFinance.chart(ticker, {
      range,
      interval: range === "1mo" ? "1d" : range === "3mo" ? "1d" : "1wk",
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
