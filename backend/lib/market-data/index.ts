/**
 * Tries Yahoo Finance first; falls back to Alpha Vantage on any error.
 * The switch is automatic — no user action required.
 */
import { YahooFinanceProvider } from "./yahoo";
import { AlphaVantageProvider } from "./alpha-vantage";
import type { MarketDataProvider, OHLCVBar } from "./types";

const yahoo = new YahooFinanceProvider();
const alphaVantage = new AlphaVantageProvider();

export async function getOHLCV(
  ticker: string,
  range: "1mo" | "3mo" | "6mo" | "1y" | "2y" | "5y"
): Promise<OHLCVBar[]> {
  try {
    return await yahoo.getOHLCV(ticker, range);
  } catch (err) {
    console.warn(`Yahoo Finance failed for ${ticker}, falling back to Alpha Vantage:`, err);
    return alphaVantage.getOHLCV(ticker, range);
  }
}

export type { MarketDataProvider, OHLCVBar };
