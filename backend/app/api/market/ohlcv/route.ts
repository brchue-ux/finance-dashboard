/**
 * GET /api/market/ohlcv?ticker=AAPL&range=1y
 * Returns OHLCV bars for Lightweight Charts. Cached in Turso (ohlcv_cache) for
 * 24 hours — durable across Railway restarts, so a Yahoo breakage never makes
 * already-fetched history unrecoverable.
 * Yahoo Finance first, Alpha Vantage fallback (automatic).
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { ohlcvCache } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { getOHLCV } from "@/lib/market-data";

type Range = "1mo" | "3mo" | "6mo" | "1y" | "2y" | "5y";
const VALID_RANGES: Range[] = ["1mo", "3mo", "6mo", "1y", "2y", "5y"];

const CACHE_TTL_SECONDS = 24 * 60 * 60;

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

  const now = Math.floor(Date.now() / 1000);
  const [cached] = await db
    .select()
    .from(ohlcvCache)
    .where(and(eq(ohlcvCache.ticker, ticker), eq(ohlcvCache.range, range)))
    .limit(1);

  if (cached && now - cached.fetchedAt < CACHE_TTL_SECONDS) {
    return NextResponse.json({ bars: JSON.parse(cached.bars), cached: true });
  }

  try {
    const bars = await getOHLCV(ticker, range);
    await db
      .insert(ohlcvCache)
      .values({ ticker, range, bars: JSON.stringify(bars), fetchedAt: now })
      .onConflictDoUpdate({
        target: [ohlcvCache.ticker, ohlcvCache.range],
        set: { bars: JSON.stringify(bars), fetchedAt: now },
      });
    return NextResponse.json({ bars, cached: false });
  } catch (err) {
    // Both providers failed — serve stale cache over nothing (staleness beats a blank chart)
    if (cached) {
      return NextResponse.json({ bars: JSON.parse(cached.bars), cached: true, stale: true });
    }
    // No cache either. Previously this threw, so one unpriceable holding 500'd
    // the whole Holding Detail screen — position, cost basis and P&L included,
    // none of which depend on price history. Seen with a TSX ticker lacking its
    // exchange suffix (VFV vs VFV.TO), which is a realistic shape for Canadian
    // holdings. Report it as a priced-data gap instead of a request failure so
    // the screen can render everything else and say what is missing.
    console.error(`[ohlcv] no data for ${ticker} (${range}) and no cache:`, err);
    return NextResponse.json({
      bars: [],
      cached: false,
      unavailable: true,
      reason: err instanceof Error ? err.message : String(err),
    });
  }
}
