// "1d" and "5d" are intraday (5m / 30m bars); the rest are daily or weekly.
export type OHLCVRange = "1d" | "5d" | "1mo" | "3mo" | "6mo" | "1y" | "2y" | "5y";

export const INTRADAY_RANGES: ReadonlySet<string> = new Set(["1d", "5d"]);

export interface OHLCVBar {
  // ISO 8601 date string for daily/weekly bars; unix seconds for intraday bars.
  // Lightweight Charts accepts both shapes natively, so no translation layer.
  time: string | number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface MarketDataProvider {
  getOHLCV(ticker: string, range: OHLCVRange): Promise<OHLCVBar[]>;
}
