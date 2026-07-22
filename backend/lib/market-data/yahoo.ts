import YahooFinance from "yahoo-finance2";
import type { MarketDataProvider, OHLCVBar, OHLCVRange } from "./types";

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

/**
 * Keep only the most recent trading session. The "1D" chip must show a full
 * session even on a weekend or before today's open, so the fetch grabs a week
 * of intraday bars and this trims to the last day present. Grouping is by UTC
 * date, which is safe for North American sessions (9:30–16:00 ET never crosses
 * UTC midnight) — the only markets this app's holdings trade on.
 */
export function lastSessionOnly<T extends { time: number }>(bars: T[]): T[] {
  if (bars.length === 0) return bars;
  const dayOf = (t: number) => new Date(t * 1000).toISOString().split("T")[0];
  const lastDay = dayOf(bars[bars.length - 1].time);
  return bars.filter((b) => dayOf(b.time) === lastDay);
}

export class YahooFinanceProvider implements MarketDataProvider {
  async getOHLCV(ticker: string, range: OHLCVRange): Promise<OHLCVBar[]> {
    if (range === "1d" || range === "5d") {
      // Intraday: fetch a full week so the most recent session is always
      // complete, at 5m bars for one day and 30m for the week view.
      const period1 = new Date();
      period1.setDate(period1.getDate() - 7);
      const result = await yahooFinance.chart(ticker, {
        period1,
        interval: range === "1d" ? "5m" : "30m",
      });
      const bars = (result.quotes ?? [])
        .filter((q) => q.open != null && q.high != null && q.low != null && q.close != null)
        .map((q) => ({
          // Unix seconds, not a date string — intraday bars share a date, and
          // Lightweight Charts needs numeric time to place them within the day.
          time: Math.floor(new Date(q.date).getTime() / 1000),
          open: q.open as number,
          high: q.high as number,
          low: q.low as number,
          close: q.close as number,
          volume: q.volume ?? 0,
        }));
      return range === "1d" ? lastSessionOnly(bars) : bars;
    }

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
