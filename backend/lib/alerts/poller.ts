/**
 * Native price alert poller (spec §5.6).
 *
 * Correctness gate is per-symbol marketState from Yahoo's own quote response —
 * an alert evaluates only when its symbol's market is open (REGULAR, or PRE/POST
 * for extended_hours alerts). The cron-side Mon–Fri window is a cost skip only.
 */
import { db } from "@/db";
import { priceAlerts, alertFires, priceCache } from "@/db/schema";
import { and, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { yahooFinance } from "@/lib/market-data/yahoo";
import { startJobRun, finishJobRun } from "@/lib/jobs/job-runs";

interface SymbolQuote {
  marketState: string;
  regularMarketPrice?: number;
  regularMarketChangePercent?: number; // percentage points: 3.0 = 3%
  preMarketPrice?: number;
  postMarketPrice?: number;
  regularMarketPreviousClose?: number;
}

let cycleRunning = false; // mutex — a slow cycle must not overlap the next

/** Mon–Fri, ~4:00–20:00 ET (pre-market through post-market). Cost skip only. */
export function inPollingWindow(now = new Date()): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "numeric",
    hour12: false,
  }).formatToParts(now);
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "-1");
  if (weekday === "Sat" || weekday === "Sun") return false;
  return hour >= 4 && hour < 20;
}

/** Whether this alert may evaluate given its symbol's current market state. */
export function marketStatePermits(state: string, extendedHours: number): boolean {
  if (state === "REGULAR") return true;
  if (extendedHours === 1 && (state.startsWith("PRE") || state.startsWith("POST"))) return true;
  return false;
}

/** Price to compare threshold conditions against, honoring pre/post sessions. */
function effectivePrice(q: SymbolQuote): number | undefined {
  if (q.marketState.startsWith("PRE")) return q.preMarketPrice ?? q.regularMarketPrice;
  if (q.marketState.startsWith("POST")) return q.postMarketPrice ?? q.regularMarketPrice;
  return q.regularMarketPrice;
}

export function evaluate(
  alert: typeof priceAlerts.$inferSelect,
  q: SymbolQuote
): { fired: boolean; triggerPrice?: number; triggerPctChange?: number } {
  const price = effectivePrice(q);
  // Yahoo reports change in percentage points (3.0 = 3%); thresholds are decimals (0.03 = 3%)
  const pctChange =
    q.regularMarketChangePercent !== undefined ? q.regularMarketChangePercent / 100 : undefined;

  switch (alert.conditionType) {
    case "price_above":
      return price !== undefined && price > alert.threshold
        ? { fired: true, triggerPrice: price }
        : { fired: false };
    case "price_below":
      return price !== undefined && price < alert.threshold
        ? { fired: true, triggerPrice: price }
        : { fired: false };
    case "pct_change_up":
      return pctChange !== undefined && pctChange > alert.threshold
        ? { fired: true, triggerPrice: price ?? 0, triggerPctChange: pctChange }
        : { fired: false };
    case "pct_change_down":
      return pctChange !== undefined && pctChange < -alert.threshold
        ? { fired: true, triggerPrice: price ?? 0, triggerPctChange: pctChange }
        : { fired: false };
    default:
      return { fired: false }; // v2 condition types not yet implemented
  }
}

/** opts.ignoreWindow: manual/dev-triggered runs (Developer screen) and closed-day testing. */
export async function runPollCycle(opts?: { ignoreWindow?: boolean }): Promise<void> {
  if (!opts?.ignoreWindow && !inPollingWindow()) return;
  if (cycleRunning) return;
  cycleRunning = true;

  const jobId = await startJobRun("alert_poll");
  const now = Math.floor(Date.now() / 1000);
  let fired = 0;

  try {
    // Expire alerts past their expiry before selecting
    await db
      .update(priceAlerts)
      .set({ status: "expired", updatedAt: now })
      .where(and(eq(priceAlerts.status, "active"), lte(priceAlerts.expiresAt, now)));

    const due = await db
      .select()
      .from(priceAlerts)
      .where(
        and(
          eq(priceAlerts.status, "active"),
          or(isNull(priceAlerts.nextCheckAt), lte(priceAlerts.nextCheckAt, now))
        )
      );

    if (due.length === 0) {
      await finishJobRun(jobId, { status: "complete", metadata: { alertsDue: 0 } });
      return;
    }

    const tickers = [...new Set(due.map((a) => a.ticker))];
    const quotes = (await yahooFinance.quote(tickers)) as unknown as Array<
      SymbolQuote & { symbol: string }
    >;
    const bySymbol = new Map(quotes.map((q) => [q.symbol, q]));

    // Last-known-good prices — written before evaluation so a mid-cycle crash still caches
    for (const q of quotes) {
      if (q.regularMarketPrice === undefined) continue; // never overwrite good data with nulls
      await db
        .insert(priceCache)
        .values({
          ticker: q.symbol,
          regularMarketPrice: q.regularMarketPrice,
          regularMarketChangePercent: q.regularMarketChangePercent ?? null,
          preMarketPrice: q.preMarketPrice ?? null,
          postMarketPrice: q.postMarketPrice ?? null,
          previousClose: q.regularMarketPreviousClose ?? null,
          fetchedAt: now,
          source: "yahoo",
        })
        .onConflictDoUpdate({
          target: priceCache.ticker,
          set: {
            regularMarketPrice: q.regularMarketPrice,
            regularMarketChangePercent: q.regularMarketChangePercent ?? null,
            preMarketPrice: q.preMarketPrice ?? null,
            postMarketPrice: q.postMarketPrice ?? null,
            previousClose: q.regularMarketPreviousClose ?? null,
            fetchedAt: now,
          },
        });
    }

    for (const alert of due) {
      const q = bySymbol.get(alert.ticker);
      if (!q || !marketStatePermits(q.marketState, alert.extendedHours)) continue;

      const result = evaluate(alert, q);
      if (!result.fired) continue;

      // firedAtBucket unique constraint is the hard dedup guard — ignore conflicts
      await db
        .insert(alertFires)
        .values({
          id: uuidv4(),
          alertId: alert.id,
          userId: alert.userId,
          ticker: alert.ticker,
          conditionType: alert.conditionType,
          threshold: alert.threshold,
          triggerPrice: result.triggerPrice!,
          triggerPctChange: result.triggerPctChange ?? null,
          source: "native",
          firedAt: now,
          firedAtBucket: Math.floor(now / 300) * 300,
          deliveredChannels: alert.notificationChannels,
        })
        .onConflictDoNothing();

      // One-time fire by default; cooldown_seconds makes it recurring
      await db
        .update(priceAlerts)
        .set(
          alert.cooldownSeconds === null
            ? { status: "triggered", lastTriggeredAt: now, triggerCount: sql`${priceAlerts.triggerCount} + 1`, updatedAt: now }
            : { lastTriggeredAt: now, nextCheckAt: now + alert.cooldownSeconds, triggerCount: sql`${priceAlerts.triggerCount} + 1`, updatedAt: now }
        )
        .where(eq(priceAlerts.id, alert.id));
      fired++;
    }

    await finishJobRun(jobId, {
      status: "complete",
      metadata: { alertsDue: due.length, tickersPolled: tickers.length, fired },
    });
  } catch (err) {
    await finishJobRun(jobId, {
      status: "failed",
      errorMessage: err instanceof Error ? err.message : String(err),
    });
  } finally {
    cycleRunning = false;
  }
}
