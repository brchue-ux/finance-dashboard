export interface OHLCVBar {
  time: string; // ISO 8601 date string
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface MarketDataProvider {
  getOHLCV(ticker: string, range: "1mo" | "3mo" | "6mo" | "1y" | "2y" | "5y"): Promise<OHLCVBar[]>;
}
