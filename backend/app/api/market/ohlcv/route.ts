/**
 * GET /api/market/ohlcv?ticker=AAPL&range=1y
 * Returns OHLCV bars for Lightweight Charts. Cached in Turso for 24 hours.
 * Yahoo Finance first, Alpha Vantage fallback (automatic).
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getOHLCV } from "@/lib/market-data";

type Range = "1mo" | "3mo" | "6mo" | "1y" | "2y" | "5y";
const VALID_RANGES: Range[] = ["1mo", "3mo", "6mo", "1y", "2y", "5y"];

// Simple in-memory cache (process-lifetime) — persists across requests on Railway
const cache = new Map<string, { bars: unknown[]; fetchedAt: number }>();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export async function GET(req: NextRequest) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const ticker = searchParams.get("ticker")?.toUpperCase();
  const range = (searchParams.get("range") ?? "1y") as Range;

  if (!ticker) return NextResponse.json({ error: "ticker required" }, { status: 400 });
  if (!VALID_RANGES.includes(range)) {
    return NextResponse.json({ error: `range must be one of ${VALID_RANGES.join(", ")}` }, { status: 400 });
  }

  const cacheKey = `${ticker}:${range}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return NextResponse.json({ bars: cached.bars, cached: true });
  }

  const bars = await getOHLCV(ticker, range);
  cache.set(cacheKey, { bars, fetchedAt: Date.now() });

  return NextResponse.json({ bars, cached: false });
}
