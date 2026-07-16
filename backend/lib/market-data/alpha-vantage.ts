/**
 * Alpha Vantage fallback provider.
 * Free tier: 25 requests/day. Used only when Yahoo Finance is unavailable.
 */
import type { MarketDataProvider, OHLCVBar } from "./types";

const BASE_URL = "https://www.alphavantage.co/query";

export class AlphaVantageProvider implements MarketDataProvider {
  async getOHLCV(
    ticker: string,
    range: "1mo" | "3mo" | "6mo" | "1y" | "2y" | "5y"
  ): Promise<OHLCVBar[]> {
    const apiKey = process.env.ALPHA_VANTAGE_API_KEY!;
    const url = `${BASE_URL}?function=TIME_SERIES_DAILY_ADJUSTED&symbol=${ticker}&outputsize=full&apikey=${apiKey}`;

    const res = await fetch(url);
    if (!res.ok) throw new Error(`Alpha Vantage HTTP ${res.status}`);

    const data = (await res.json()) as {
      "Time Series (Daily)": Record<
        string,
        {
          "1. open": string;
          "2. high": string;
          "3. low": string;
          "4. close": string;
          "6. volume": string;
        }
      >;
    };

    const series = data["Time Series (Daily)"];
    if (!series) throw new Error("Alpha Vantage returned no time series data");

    const cutoff = rangeToCutoff(range);
    return Object.entries(series)
      .filter(([date]) => date >= cutoff)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, bar]) => ({
        time: date,
        open: parseFloat(bar["1. open"]),
        high: parseFloat(bar["2. high"]),
        low: parseFloat(bar["3. low"]),
        close: parseFloat(bar["4. close"]),
        volume: parseFloat(bar["6. volume"]),
      }));
  }
}

function rangeToCutoff(range: string): string {
  const now = new Date();
  const months: Record<string, number> = {
    "1mo": 1, "3mo": 3, "6mo": 6, "1y": 12, "2y": 24, "5y": 60,
  };
  now.setMonth(now.getMonth() - (months[range] ?? 12));
  return now.toISOString().split("T")[0];
}
