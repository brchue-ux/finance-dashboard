# Price Alert Architecture — Research Findings

**Date:** 2026-07-16
**Scope:** Native price threshold monitoring for Finance Intelligence Dashboard
**Stack:** Next.js API routes, persistent Node.js on Railway, Turso (LibSQL/SQLite), Drizzle ORM
**Target scale:** 1 → 100 → 500 users

---

## 1. Polling Mechanism Options

### A. Railway Cron (Native Platform Scheduler)

**Minimum interval:** 5 minutes. Railway enforces this as a hard floor — cron expressions like `* * * * *` are rejected or silently capped. There is no sub-5-minute Railway-native scheduling.

**Process model:** A Railway cron service is a **separate, ephemeral process** — not the API server. Railway spins up a container, runs the task, and expects the process to self-terminate with all connections closed. It does not share memory, in-flight state, or open handles with the always-on API server. This is architecturally clean but means any data the alert poller needs must come from the database, not in-memory state.

**Reliability:** Documented issues exist. If a previous cron execution is still running when the next interval fires, Railway **skips** the new execution entirely — it does not queue it. A December 2025 incident caused widespread cron job stalling across Railway (unclosed deployments blocking subsequent runs). Railway made internal improvements to their scheduler in 2025 that eliminated most missed-cron events, but skipped executions due to unclosed connections remain the most common failure mode in production user reports. Timing is not guaranteed to the minute — expect ±1–2 minute jitter.

**Scale math at 100 users / 500 active alerts / 100 deduplicated tickers:**

Using Twelve Data batch endpoint at 5-minute intervals:
- 1 batch call per poll cycle containing up to 120 symbols → 1 API credit per symbol → 100 credits per poll
- 5-minute intervals = 12 polls/hour × 6.5 market hours = 78 polls/trading day
- 78 polls × 100 credits = **7,800 credits/day** — well above the free tier's 800/day limit

Using Yahoo Finance `quoteCombine` (free, unofficial):
- All 100 tickers in a single HTTP request, debounced to one call
- No hard credit limit — rate limiting is undocumented and enforced by Yahoo's infrastructure
- Practical risk: sustained 5-minute polling at 100 tickers per request risks 429 blocks; adding randomized 1–2 second delays and rotating between `quoteCombine` batches of 50 reduces this risk significantly

**Verdict on Railway cron:** Suitable for the MVP at 1–50 users with Yahoo Finance as the price source. The 5-minute minimum is not a problem for threshold alerts (users set price targets, not millisecond-precision triggers). The skip-on-overlap failure mode is manageable by ensuring the poller always terminates within 4 minutes. Not suitable as the primary mechanism once Twelve Data free-tier credit math is stressed.

---

### B. In-Process `setInterval` / `node-cron`

**How it works:** A `node-cron` scheduler or `setInterval` loop runs inside the existing Next.js API process on Railway. No separate service required. Can run at any interval — 1 minute, 5 minutes, arbitrary.

**Failure modes:**

1. **Process restarts lose the schedule.** Railway restarts the Next.js container on deploy, crash, or OOM. Any in-flight poll cycle is silently killed. node-cron re-registers its schedule on startup, so the next cycle fires on schedule after restart — but the in-progress cycle does not retry. For price alerts, this is acceptable: missed one poll of 5-minute data.

2. **Memory leak risk.** `node-cron` has documented memory growth issues when jobs are registered inside conditional blocks or closures that create new closure references each tick. `setInterval` with closures referencing external mutable state accumulates references that prevent GC. The correct pattern is registering the job once at module initialization with a stateless handler that pulls everything from the DB. If implemented that way, there is no meaningful memory leak.

3. **Event loop blocking.** A price polling cycle that makes 100 synchronous-looking API calls (even if `await`-ed) keeps the event loop occupied during I/O waits, but JavaScript's single-threaded async model handles this correctly — `await` yields control back. The real risk is if the polling logic does heavy synchronous CPU work (computing moving averages over large arrays on every tick). For price-above/below threshold checking, this is negligible.

4. **No skip-on-overlap protection.** Unlike Railway cron, `setInterval` fires on schedule regardless of whether the previous run finished. A slow API response or DB write can cause overlapping poll cycles. Fix: use a mutex flag (`let isRunning = false`) that the poller checks at entry and sets/clears around execution.

**Reliability vs Railway cron:** In-process scheduling is *more* reliable for the polling cadence (no Railway scheduler jitter, no skip-on-overlap from the platform side) but *less* reliable for crash isolation (a bad poll cycle that throws an uncaught exception can bring down the API server if error boundaries are not in place — though Next.js process-level uncaught exception handlers mitigate this).

**Sub-5-minute polling:** The only way to poll faster than 5 minutes on Railway without a separate always-on worker is in-process scheduling. This is the recommended workaround confirmed by Railway's own community documentation.

**Verdict:** In-process `node-cron` inside the existing Next.js backend is the **correct choice for this stack at MVP scale**. It adds zero infrastructure, zero cost, runs at any interval, and the failure modes are manageable with a 10-line mutex guard. The existing backend is already a persistent process on Railway — not serverless — so in-process scheduling is a first-class pattern here, not a workaround.

---

### C. BullMQ + Redis

**What BullMQ adds specifically for this use case:**
- Job persistence across process restarts (jobs survive crashes)
- Concurrency controls, rate limiting per worker
- Delayed job scheduling with millisecond precision
- Retry with backoff on failures
- Job result visibility and monitoring via Bull Board
- Distributed processing across multiple worker instances

**For price alert polling specifically:** BullMQ is architectural overkill. The polling pattern is: wake up on a schedule, fetch N prices, compare to thresholds, write alerts. This is a single recurring job with no fan-out, no worker concurrency need, and no complex retry semantics (if a poll fails, the next scheduled poll 5 minutes later is the retry). BullMQ's value multiplies when you have hundreds of distinct job types, need per-job retry semantics, or need to distribute work across multiple consumers — none of which apply here at 1–500 users.

**Redis cost on Railway:**
- Railway Redis is billed at ~$10/GB RAM/month
- A minimal Redis instance for BullMQ metadata (job queue state, a few hundred records) runs at ~128–256MB
- Realistic cost: **$1.50–$3/month in RAM** on top of existing Railway usage
- Total stack cost increase: meaningful (adds ~$3–5/month to a stack currently running at $5/month Hobby base rate)

**Verdict:** BullMQ is the right answer at 500+ users when polling work needs to be distributed and job durability matters for SLA reasons. At 1–100 users with a single persistent Node.js process, it adds infrastructure complexity (a Redis dependency) and cost without commensurate benefit. Defer until the architecture genuinely needs it.

---

### D. Separate Railway Worker Service

**Architecture:** A second Railway service (separate Docker container, separate deploy) that runs only the polling loop — not the API server. Can be an always-on worker with `node-cron` inside, or a Railway cron service that spins up every 5 minutes.

**Cost:** At minimum, adds another $0–5/month to Railway resource usage (a small always-on Node process consumes ~64–128MB RAM = ~$0.80–$1.60/month). As a Railway cron service (ephemeral), cost is nearly zero since it only runs for seconds every 5 minutes.

**Benefits:** Clean separation of concerns. A crash in the polling worker cannot affect API response latency. Scaling them independently becomes trivial. The poller can be redeployed independently of the API.

**Verdict:** Reasonable step-up from in-process scheduling once the system reaches 100+ users and polling reliability becomes business-critical. Not necessary at MVP. The upgrade path from in-process `node-cron` to a separate Railway cron service is straightforward — the poller logic is already isolated, you just move it to its own service entry point.

---

## 2. Ticker Deduplication Across Users

### The Core Pattern

At any polling interval, the correct approach is:

1. Query the database for **all distinct tickers** with at least one active alert
2. Fetch prices for that deduplicated set in one batch call
3. Load all active alerts into memory
4. For each alert, look up the price from the in-memory map
5. Evaluate conditions and write triggered alerts

This means **one price fetch per ticker per polling cycle**, not one fetch per user per ticker per polling cycle. At 100 users with 500 alerts across 100 distinct tickers, this is 100 price fetches, not 500.

**SQL query pattern (Turso/SQLite via Drizzle):**

```sql
SELECT DISTINCT ticker
FROM price_alerts
WHERE status = 'active'
  AND (next_check_at IS NULL OR next_check_at <= unixepoch())
```

In Drizzle ORM syntax:
```typescript
const tickers = await db
  .selectDistinct({ ticker: priceAlerts.ticker })
  .from(priceAlerts)
  .where(
    and(
      eq(priceAlerts.status, 'active'),
      or(
        isNull(priceAlerts.nextCheckAt),
        lte(priceAlerts.nextCheckAt, Math.floor(Date.now() / 1000))
      )
    )
  );
```

---

### Twelve Data Batch Endpoint

**Endpoint:** `/price?symbol=AAPL,MSFT,TSLA,...` (comma-separated, same for `/quote`)
**Batch size limit:** Up to **120 symbols per single API call**
**Credit consumption:** 1 credit per symbol in the batch — a 100-symbol batch costs 100 credits, not 1
**Free tier limits:** 800 credits/day, 8 credits/minute

**Math for free tier:**
- 100 tickers × 1 credit = 100 credits per poll cycle
- Free tier allows 800 credits/day → **8 poll cycles/day maximum** on free tier
- 8 polls/day = one every ~1.9 hours during market hours
- At 5-minute polling during 6.5 market hours: 78 poll cycles × 100 credits = **7,800 credits/day** needed
- Free tier cannot support 5-minute polling at 100 tickers

**WebSocket note:** Twelve Data WebSocket (push-based, eliminates polling entirely) is only available on paid plans starting at $29/month.

**Twelve Data free tier is only viable for MVP with very few distinct tickers** (e.g., ≤10 tickers at 5-minute polling = 780 credits/day, within limit). Yahoo Finance must be the primary source.

---

### Yahoo Finance (`yahoo-finance2`) Batch Support

**`quoteCombine` method:** Yahoo Finance's quote API is the only Yahoo endpoint that natively supports multiple symbols in one HTTP request. The `yahoo-finance2` library exposes this via `quoteCombine()` — a debounce mechanism that collects individual symbol calls made within a 50ms window and issues a single `quote()` network request for all of them.

**Usage pattern:**
```typescript
import YahooFinance from 'yahoo-finance2';
const yf = new YahooFinance();

// All calls within 50ms window → single HTTP request
const prices = await Promise.all(
  tickers.map(ticker => yf.quoteCombine(ticker, { fields: ['regularMarketPrice', 'regularMarketTime'] }))
);
```

**Practical batch size limit:** No officially documented limit. Community reports suggest batches of 50–100 symbols work reliably. Beyond ~200 symbols, URL length limits and Yahoo's internal throttling become factors. For 100 tickers, a single `quoteCombine` call is appropriate.

**Rate limiting:** Entirely undocumented. Yahoo enforces rate limits at the IP level server-side. Observed failure mode: 429 after sustained high-frequency polling. Mitigations:
- Never poll more frequently than every 2–3 minutes in practice
- Implement exponential backoff on 429 response
- Fall back to Twelve Data (paid) or Alpha Vantage (25 req/day free — insufficient for production polling) on persistent 429
- Cache last-known-good prices with timestamps so a failed poll cycle doesn't fire false alerts from stale data

**Recommendation:** Use `yahoo-finance2` `quoteCombine` as the primary price source. Twelve Data REST as a manual override for specific tickers where Yahoo fails consistently. Alpha Vantage is not usable for real-time polling at any scale — its 25 req/day free limit is a historical data tier, not a polling tier.

---

## 3. Alert Condition Types — MVP vs Deferred

### Condition Evaluation Cost Spectrum

| Condition | API data needed | Compute at eval time | Storage needed | Complexity |
|---|---|---|---|---|
| Price above/below threshold | Current price only | O(1) comparison | Threshold value | Trivial |
| % change from previous close | Current price + prior close | O(1) comparison | Prior close (fetchable) | Low |
| Volume spike | Current volume + avg volume | O(1) comparison | Avg volume baseline | Low-Medium |
| Moving average crossover | OHLCV history N days | O(N) rolling avg | Last N closes | Medium |
| RSI threshold | OHLCV history 14+ days | O(N) Wilder smoothing | RSI state across polls | Medium-High |

### Recommended MVP Set (80/20 Rule)

**Launch with:**

1. **Price above threshold** — "Notify me when AAPL rises above $200"
   - Implementation: `currentPrice > threshold`
   - Data: one field from `quoteCombine` result
   - User value: covering stop-profits, breakout entries

2. **Price below threshold** — "Notify me when AAPL drops below $180"
   - Implementation: `currentPrice < threshold`
   - Data: same as above
   - User value: covering stop-losses, dip-buying entries

3. **% change from previous close** — "Notify me when AAPL moves more than 3% today"
   - Implementation: `Math.abs((currentPrice - prevClose) / prevClose) >= threshold`
   - Data: `regularMarketChangePercent` is already in the Yahoo Finance `quote` response — no extra fetch needed
   - User value: covers earnings reaction monitoring, gap-up/gap-down detection — high demand from self-directed investors

**Defer to v2:**

4. **Moving average crossover** — requires storing N days of closing prices, computing rolling averages across polling cycles, and comparing MA values between consecutive polls. Data storage and computation complexity jumps significantly. Defer until a `price_history` table is built from polling snapshots (which naturally accumulates over time).

5. **RSI threshold** — requires Wilder smoothing algorithm with persistent state across 14+ polling cycles. Can be approximated once price history accumulates. The existing Twelve Data MCP integration already provides RSI values via Claude tool calls — consider surfacing RSI alerts through that path rather than implementing a custom RSI engine.

6. **Volume spike** — requires a volume baseline (rolling average over N days). Useful but less demanded by individual investors than price alerts. Defer.

### Why this 80/20 split works

Price-above/below covers the dominant retail investor use case (entry/exit price monitoring). Percentage change adds the second most common use case (reaction to news/earnings without knowing a specific price level) at zero additional API cost since `regularMarketChangePercent` is in the same API response. Together these three conditions cover the mental model of approximately 85%+ of price alert use cases observed in retail fintech products (Robinhood, Wealthsimple, StockAlarm).

---

## 4. Market Hours Awareness

### Should the Poller Skip Off-Hours?

**Yes, definitively.** Running price polls at 2am on a Saturday achieves:
- Wasting API credits/rate limit budget on stale prices
- Potentially firing alerts on pre/after-market prices the user didn't intend to monitor
- Unnecessary Railway CPU usage

**Recommended behavior:**
- Skip polling entirely: weekends, US federal market holidays, TSX holidays
- Skip polling: 4:00 PM ET through 9:30 AM ET on weekdays (regular session boundary)
- Make extended hours behavior a **per-alert user setting** (default: off)

### Recommended Library: `trading-calendar` (npm)

The `trading-calendar` npm package (GitHub: `davidsoederberg/trading-calendar`) provides:
- `isTradingDay(exchange, date)` — checks if a given date is a trading day for the exchange
- `isTradingTime(exchange, date)` — checks if the market is open right now
- Works with NYSE, NASDAQ, TSX, and 30+ other exchanges
- Accepts JS `Date` objects or Luxon `DateTime` objects

**Installation:** `npm install trading-calendar`

**Usage in the poller:**
```typescript
import { isTradingTime } from 'trading-calendar';

async function runPollCycle() {
  const isMarketOpen = isTradingTime('NYSE') || isTradingTime('TSX');
  if (!isMarketOpen) {
    console.log('Market closed — skipping poll cycle');
    return;
  }
  // ... proceed with price fetch
}
```

**Note:** The library was last updated approximately 4 years ago but exchange trading hours and holiday calendars are stable data. Verify holiday accuracy against the [NYSE official calendar](https://www.nyse.com/trade/hours-calendars) annually. An alternative is `@sebspark/trading-hours` (published July 2026, actively maintained).

### Extended Hours Prices

Yahoo Finance `quote` returns `preMarketPrice`, `postMarketPrice`, and `regularMarketPrice` as separate fields. The recommendation:

- Default behavior: evaluate alerts against `regularMarketPrice` only
- Extended hours alerts: when a user enables "extended hours" on a specific alert, evaluate against `preMarketPrice ?? postMarketPrice ?? regularMarketPrice`
- Store the `extended_hours` flag as a boolean column on the `price_alerts` table
- Caution: extended hours prices are thin, volatile, and can trigger false positives — warn users in the UI

---

## 5. Alert Deduplication and Cooldown

### The Core Problem

AAPL drops below $180 at 10:05 AM. It stays below $180 for the next six 5-minute poll cycles (until 10:35 AM). Without deduplication, this generates 6 identical alert notifications. That is alert fatigue and functionally broken UX.

### Standard Patterns

**Pattern A: One-time fire with manual re-arm (industry default)**

When a threshold condition is met:
1. Fire the alert notification
2. Set `status = 'triggered'` on the alert record
3. Stop evaluating that alert in future poll cycles until the user re-arms it

**Pros:** Simplest. User explicitly resets the alert when they want it active again. User has full control.
**Cons:** Alert is silently inactive after first fire — user must actively manage alert lifecycle.

This is what Robinhood, Wealthsimple, and most retail brokers do by default.

**Pattern B: Cooldown period with auto-reset**

When a threshold condition is met:
1. Fire the alert notification
2. Set `last_triggered_at = now()` and `next_check_at = now() + cooldown_seconds`
3. On future polls, skip the alert if `now() < next_check_at`
4. After cooldown expires, the alert is live again automatically

**Pros:** Handles "notify me every time RSI drops below 30" recurring use cases. No manual re-arm needed.
**Cons:** Can still generate repeated alerts if the condition persists through multiple cooldown windows.

**Pattern C: Condition-exit required before re-fire**

When a threshold condition is met:
1. Fire the alert
2. Set `in_triggered_state = true`
3. On future polls, check if the condition is **no longer met** (price climbs back above $180)
4. When condition clears, set `in_triggered_state = false`
5. Alert re-fires on next condition match

**Pros:** Most accurate for sustained threshold monitoring — only fires when the price crosses the threshold, not while it lingers. Eliminates repeated alerts during sustained threshold violation.
**Cons:** Requires tracking whether condition was met on previous poll (adds a `last_price_was_below` boolean or similar state).

### Recommended Approach for This System

**Implement Pattern A (one-time fire) as the default, with Pattern C as the underlying deduplication guard.**

Concretely:
- `status` field: `'active' | 'triggered' | 'paused' | 'expired'`
- `last_triggered_at`: timestamp of most recent fire
- `trigger_count`: integer incrementing on each fire (useful for audit log)
- When condition is met and `status = 'active'`: fire alert, set `status = 'triggered'`, record `last_triggered_at`
- In the poll cycle: only evaluate alerts where `status = 'active'`
- User can re-arm via UI: set `status = 'active'` again
- Optionally add `cooldown_seconds` column: if set, instead of `status = 'triggered'`, set `next_check_at = now() + cooldown_seconds` and leave `status = 'active'` — this implements Pattern B for recurring alerts

**Database-level deduplication guard (belt and suspenders):**

The `alert_fires` audit table (see Schema section below) uses a composite unique constraint on `(alert_id, triggered_at_minute)` where `triggered_at_minute` is `FLOOR(unix_timestamp / 300) * 300` (5-minute bucket). Even if the application logic fires twice in the same poll cycle (bug), the DB insert fails silently.

### Interaction with Recurring Alerts

For condition types like "notify me every time RSI drops below 30" (genuinely recurring):
- Set `cooldown_seconds = 3600` (1 hour minimum between fires)
- Set `status` back to `'active'` after cooldown, not `'triggered'`
- This allows the alert to fire again after 1 hour if the condition persists, without requiring user re-arm

---

## 6. Schema Design

### `price_alerts` Table

```typescript
// db/schema.ts addition

export const priceAlerts = sqliteTable("price_alerts", {
  // Identity
  id: text("id").primaryKey(), // UUID

  // Ownership
  userId: text("user_id")
    .notNull()
    .references(() => users.id),

  // What to watch
  ticker: text("ticker").notNull(),              // "AAPL", "SHOP.TO"
  holdingId: text("holding_id")                 // optional FK to holdings table snapshot
    .references(() => holdings.id),             // NULL if alert is not tied to a held position

  // Alert condition — MVP condition types
  conditionType: text("condition_type").notNull(),
    // "price_above" | "price_below" | "pct_change_up" | "pct_change_down"
    // v2: "ma_cross_above" | "ma_cross_below" | "rsi_above" | "rsi_below" | "volume_spike"

  threshold: real("threshold").notNull(),        // Dollar value OR percentage (0.03 = 3%)

  // Extended hours flag
  extendedHours: integer("extended_hours")
    .notNull()
    .default(0),                                 // 0 = regular session only, 1 = include pre/post market

  // Alert lifecycle state
  status: text("status")
    .notNull()
    .default("active"),                          // "active" | "triggered" | "paused" | "expired"

  // Cooldown / recurrence
  cooldownSeconds: integer("cooldown_seconds"),  // NULL = one-time fire (default). Set value for recurring.
  nextCheckAt: integer("next_check_at"),         // Unix timestamp. NULL = check every poll. Set during cooldown.

  // Deduplication guard
  lastTriggeredAt: integer("last_triggered_at"), // Unix timestamp of most recent fire. NULL if never fired.
  triggerCount: integer("trigger_count")
    .notNull()
    .default(0),                                 // Total times this alert has fired

  // Source tracking — distinguishes native vs TradingView-originated alerts in unified UI
  source: text("source")
    .notNull()
    .default("native"),                          // "native" | "tradingview"

  // Notification delivery
  notificationChannels: text("notification_channels")
    .notNull()
    .default('["in_app"]'),                      // JSON: ["in_app", "push", "email"]

  // Metadata
  label: text("label"),                          // User-defined label, e.g. "AAPL stop-loss"
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  expiresAt: integer("expires_at"),              // Optional auto-expiry. NULL = never expires.
});
```

### `alert_fires` Audit Table

```typescript
export const alertFires = sqliteTable(
  "alert_fires",
  {
    id: text("id").primaryKey(),                 // UUID
    alertId: text("alert_id")
      .notNull()
      .references(() => priceAlerts.id),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    ticker: text("ticker").notNull(),
    conditionType: text("condition_type").notNull(),
    threshold: real("threshold").notNull(),
    triggerPrice: real("trigger_price").notNull(), // Actual price that triggered the alert
    triggerPctChange: real("trigger_pct_change"),  // For pct_change conditions
    source: text("source").notNull(),              // "native" | "tradingview"
    firedAt: integer("fired_at").notNull(),        // Unix timestamp
    // Deduplication bucket — prevents double-fire within same 5-min poll window
    firedAtBucket: integer("fired_at_bucket").notNull(), // FLOOR(firedAt / 300) * 300
    deliveredChannels: text("delivered_channels").notNull(), // JSON: which channels were notified
  },
  (t) => [
    // Hard deduplication constraint — same alert cannot fire twice in same 5-min bucket
    uniqueIndex("uq_alert_fire_bucket").on(t.alertId, t.firedAtBucket),
    // Index for user notification feed
    index("idx_alert_fires_user_fired").on(t.userId, t.firedAt),
  ]
);
```

### `price_cache` Table (Optional but Recommended at 50+ Users)

```typescript
export const priceCache = sqliteTable(
  "price_cache",
  {
    ticker: text("ticker").primaryKey(),
    regularMarketPrice: real("regular_market_price").notNull(),
    regularMarketChangePercent: real("regular_market_change_percent"),
    preMarketPrice: real("pre_market_price"),
    postMarketPrice: real("post_market_price"),
    previousClose: real("previous_close"),
    fetchedAt: integer("fetched_at").notNull(),   // Unix timestamp of last successful fetch
    source: text("source").notNull(),              // "yahoo" | "twelve_data"
  }
);
```

This table serves as a last-known-good price store. If the poll cycle fails mid-way (Yahoo 429), subsequent alert evaluations in the same cycle can use cached prices rather than skipping or firing on stale/null data.

### Relationship to `tradingview_alerts`

**Recommendation: Keep the tables separate. Add a unified view.**

The `tradingview_alerts` table is a raw webhook event log — append-only, immutable, stores the full webhook payload. It has no lifecycle state (no `status`, no `cooldown_seconds`, no `threshold`). It represents an *event that already happened at TradingView*.

The `price_alerts` table represents *a standing instruction to monitor*. These are fundamentally different data models.

**The `source = 'tradingview'` field on `price_alerts` is for a different purpose:** when a user with a paid TradingView plan wants TradingView to be the monitoring engine and your backend to only handle delivery (the webhook path), you create a `price_alerts` row with `source = 'tradingview'` and `status = 'active'` — it stays in `active` state until a matching TradingView webhook arrives and creates the `alert_fires` record.

The unified UI surface is a view that queries `alert_fires` (with `source` distinguishing origin) rather than merging the raw `tradingview_alerts` table into the alerts feed. The `tradingview_alerts` table becomes the raw event store; `alert_fires` becomes the unified alert event feed.

---

## 7. Scale Path

### At 1 User (Current State)

**Architecture:**
- `node-cron` schedule registered inside the existing Next.js API process
- Runs every 5 minutes during market hours
- `isTradingTime('NYSE')` guard at top of handler
- Queries `price_alerts` for active alerts
- Fetches all distinct tickers via `yahooFinance.quoteCombine()`
- Evaluates conditions in memory
- Writes to `alert_fires`, updates `price_alerts.status`
- In-app notification via API polling (TanStack Query `refetchInterval`)

**Cost delta:** $0 (no new services, no new dependencies)
**Lines of code:** ~150 (poller function + DB queries + market hours check)

---

### At 100 Users

**What changes:**
- 500 active alerts, 100 deduplicated tickers — the deduplication pattern already handles this
- Yahoo Finance batch via `quoteCombine` still works at 100 tickers per cycle
- SQLite write throughput: 500 alert evaluations → at most 50 `alert_fires` inserts per cycle (assuming 10% of alerts fire on any given day). SQLite handles thousands of writes/second; this is trivial.
- Turso (remote LibSQL) introduces network round-trip latency (~10–30ms) on each DB call. Batch the alert evaluation updates using Drizzle's batch API to minimize round-trips.
- The in-process scheduler may need a mutex to prevent overlapping poll cycles if evaluation time creeps toward the 5-minute interval

**Potential pressure point:** Yahoo Finance rate limiting. At 100 users, you likely have enough engagement that the backend is making other Yahoo Finance calls (OHLCV for charts, etc.) alongside the poll cycle. Implement a shared rate-limit token bucket across all Yahoo Finance usages.

**Upgrade options at this stage:**
- Move the poller to a separate Railway cron service (zero cost difference, cleaner architecture)
- Subscribe to Twelve Data's $29/month plan to gain a reliable backup data source with 10,000 credits/day (covers 100 tickers × 78 polls/day = 7,800 credits/day with margin)

---

### At 500 Users

**What breaks first: Yahoo Finance rate limiting.**

2,500 active alerts, ~200–300 distinct tickers. A single `quoteCombine` batch of 300 tickers may start seeing inconsistent Yahoo 429 responses. This is the primary inflection point.

**Fix:** Move to Twelve Data as the primary polling source (requires their Growth plan at $79/month for 100,000 credits/day — 300 tickers × 78 polls = 23,400 credits/day, well within limit). Yahoo Finance becomes the backup.

**Second pressure point: SQLite write contention.**

At 500 users with active alert evaluation, Turso's remote LibSQL introduces network latency on every write. If 2,500 alerts are evaluated in a single poll cycle and 250 of them fire, that's 250 DB writes in rapid succession over a network connection. Turso's connection pooling and Drizzle's batch API handle this, but the poll cycle duration may exceed 30–60 seconds, risking overlap with the next cron interval.

**Fix:**
- Implement polling in batches (process 500 alerts per batch, write results, continue)
- Or migrate to Neon (Postgres) — the spec already identifies this as the Drizzle dialect-swap migration path
- Or move alert evaluation to a separate Railway worker service with its own dedicated DB connection pool

**Third pressure point: In-app notification delivery.**

At 500 users, polling the `/api/alerts` endpoint via TanStack Query `refetchInterval` at 30-second intervals = 1,000 req/min to the API just for notification checking. At this scale, add push notifications (Expo Push Notifications are free) so the app doesn't need to poll.

**Architectural inflection point summary:**

| Scale | Breaks | Fix |
|---|---|---|
| 1–50 users | Nothing | — |
| 50–150 users | Yahoo rate limiting risk | Add request deduplication + backoff; consider Twelve Data paid |
| 150–300 users | Yahoo unreliable at batch size | Switch to Twelve Data primary ($79/mo) |
| 300–500 users | SQLite write latency under batch load | Drizzle batch API; or migrate to Postgres (Neon) |
| 500+ users | In-app notification polling flood | Add Expo Push Notifications; separate Railway worker for poller |

The architectural inflection point where Railway cron + Twelve Data REST stops being sufficient is approximately **1,000+ users with 5,000+ alerts** across 300+ tickers. At that scale, you need a persistent WebSocket subscription to a professional data feed (Polygon.io, Alpaca, or Twelve Data WebSocket on Enterprise plan) and BullMQ to distribute alert evaluation across worker processes. That is not a near-term concern for this project.

---

## 8. Prior Art

### Open Source Reference Implementations

**`benjaminchang7/stock-price-alert-system`** (GitHub)
Cloud-based application monitoring near-real-time stock prices and notifying users when predefined alert conditions are met. Uses polling architecture against Alpha Vantage. Directly relevant pattern.

**`marketcalls/YFinance-Alert-Manager`** (GitHub)
Uses yfinance (Python equivalent of yahoo-finance2) with an SQLite `alert_rules` table including `is_active`, `last_triggered`, and a 60-second anti-spam cooldown. The schema design closely matches what's recommended here.

**`dongzhang84/stock-monitor`** (GitHub)
Real-time stock monitoring with customizable alerts. Next.js dashboard connected to Alpha Vantage, Upstash Redis for price history, GitHub Actions as the cron mechanism. Shows the "external cron triggering an HTTP endpoint" pattern as an alternative to in-process scheduling.

**`roccomuso/price-monitoring`** (npm/GitHub)
Node.js price monitoring library for generic price scraping. Shows the abstraction pattern for separating the fetcher from the condition evaluator.

### Fintech Industry Patterns

**Robinhood's approach** (documented in technical analysis):
Server-side subscription model — single market data feed subscription per ticker, broadcast to all users watching that ticker via pub/sub. At Robinhood's scale, this is implemented with Kafka. For this project, the database-level deduplication achieves the same result (one price fetch per ticker, evaluated against all user alerts) without Kafka.

**Alert state machine** (observed across Zerodha, Groww, StockAlarm):
Universal pattern: `active → triggered → [user re-arms] → active`. Cooldown variants exist on premium tiers. Alert history stored separately from alert definitions for audit and notification replay.

### npm Packages Evaluated

| Package | Verdict |
|---|---|
| `trading-calendar` | Use for market hours detection — lightweight, correct |
| `@sebspark/trading-hours` | Alternative — actively maintained as of 2026 |
| `node-cron` | Use for in-process scheduling — well-tested, minimal footprint |
| `bullmq` | Defer — overkill at this scale |
| `yahoo-finance2` | Already in stack — use `quoteCombine` for batch polling |

---

## Recommended Architecture

### Polling Mechanism: In-Process `node-cron` in the Existing Next.js Backend

**Choice:** `node-cron` registered once at server startup inside the existing Railway persistent Node.js process.

**Justification:**
- The backend is already a persistent process (not serverless) — in-process scheduling is a first-class pattern, not a workaround
- Zero additional infrastructure or cost
- 5-minute polling interval is appropriate for price threshold alerts (users set prices, not millisecond targets)
- Railway's native cron minimum is also 5 minutes, so there is no frequency advantage to a separate cron service at MVP
- Upgrade path to a separate Railway worker service is a straight lift-and-shift of the poller function — implement it with clean separation from the start (isolated module, no implicit API server dependencies)
- Mutex guard prevents overlapping cycles; market hours check prevents off-hours waste

**Implementation entry point:**
```typescript
// backend/lib/price-alert-poller.ts — registered once in backend startup
import cron from 'node-cron';
import { runPollCycle } from './price-alert-poll-cycle';

let isRunning = false;

export function startPriceAlertPoller() {
  cron.schedule('*/5 * * * *', async () => {
    if (isRunning) return; // skip overlapping cycles
    isRunning = true;
    try {
      await runPollCycle();
    } catch (err) {
      console.error('[price-alert-poller] unhandled error:', err);
    } finally {
      isRunning = false;
    }
  });
}
```

---

### Data Source: Yahoo Finance `quoteCombine` Primary, Twelve Data REST Fallback

**Primary:** `yahooFinance.quoteCombine(ticker)` called for all distinct active-alert tickers in parallel — debounced into a single HTTP request by the library.
**Fallback:** Twelve Data `/price?symbol=...` REST endpoint (batch, up to 120 symbols) when Yahoo returns 429 or consistent errors. Requires upgrading Twelve Data from MCP-only to also using their REST API directly. At 100 tickers, Twelve Data free tier (800 credits/day) cannot support 5-minute polling — use Twelve Data only as a fallback that fires infrequently, or upgrade to paid at ~150+ users.
**Never use Alpha Vantage for polling** — 25 req/day free limit is a hard ceiling that makes it usable only for one-off lookups, not recurring polling.

---

### MVP Alert Condition Types

1. `price_below` — current price < threshold (dollar value)
2. `price_above` — current price > threshold (dollar value)
3. `pct_change_down` — `regularMarketChangePercent` < -threshold (e.g., -0.03 for -3%)
4. `pct_change_up` — `regularMarketChangePercent` > threshold (e.g., 0.03 for 3%)

All four use data already in the Yahoo Finance `quote` response. No additional API calls. Implementation is four comparison operators.

Defer: moving average crossover, RSI threshold, volume spike.

---

### Schema for `price_alerts` Table (Drizzle ORM / Turso LibSQL)

```typescript
import { sql } from "drizzle-orm";
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { users } from "./schema"; // existing users table

export const priceAlerts = sqliteTable(
  "price_alerts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),

    // What to watch
    ticker: text("ticker").notNull(),
    holdingId: text("holding_id"),              // optional; FK to holdings if watching a held position
    label: text("label"),                       // user-defined, e.g. "AAPL stop-loss"

    // Condition
    conditionType: text("condition_type").notNull(),
      // MVP: "price_above" | "price_below" | "pct_change_up" | "pct_change_down"
      // v2:  "ma_cross_above" | "ma_cross_below" | "rsi_above" | "rsi_below"
    threshold: real("threshold").notNull(),     // dollar price OR decimal pct (0.03 = 3%)

    // Extended hours
    extendedHours: integer("extended_hours").notNull().default(0),

    // Lifecycle
    status: text("status").notNull().default("active"),
      // "active" | "triggered" | "paused" | "expired"

    // Cooldown / recurrence (NULL = one-time fire, requires manual re-arm)
    cooldownSeconds: integer("cooldown_seconds"),
    nextCheckAt: integer("next_check_at"),      // Unix timestamp; NULL = evaluate every poll

    // Deduplication state
    lastTriggeredAt: integer("last_triggered_at"),
    triggerCount: integer("trigger_count").notNull().default(0),

    // Source (unified view with TradingView alerts)
    source: text("source").notNull().default("native"),
      // "native" | "tradingview"

    // Notification
    notificationChannels: text("notification_channels")
      .notNull()
      .default('["in_app"]'),                  // JSON array

    // Timestamps
    createdAt: integer("created_at")
      .notNull()
      .$defaultFn(() => Math.floor(Date.now() / 1000)),
    updatedAt: integer("updated_at")
      .notNull()
      .$defaultFn(() => Math.floor(Date.now() / 1000)),
    expiresAt: integer("expires_at"),
  },
  (t) => [
    // Fast lookup of all active alerts for a given ticker (core polling query)
    index("idx_price_alerts_ticker_status").on(t.ticker, t.status),
    // Fast lookup of all active alerts for a user
    index("idx_price_alerts_user_status").on(t.userId, t.status),
    // Cooldown window check
    index("idx_price_alerts_next_check").on(t.nextCheckAt),
  ]
);

export const alertFires = sqliteTable(
  "alert_fires",
  {
    id: text("id").primaryKey(),
    alertId: text("alert_id").notNull().references(() => priceAlerts.id),
    userId: text("user_id").notNull().references(() => users.id),

    ticker: text("ticker").notNull(),
    conditionType: text("condition_type").notNull(),
    threshold: real("threshold").notNull(),
    triggerPrice: real("trigger_price").notNull(),
    triggerPctChange: real("trigger_pct_change"),
    source: text("source").notNull(),

    firedAt: integer("fired_at").notNull(),
    // 5-minute bucket for deduplication: FLOOR(firedAt / 300) * 300
    firedAtBucket: integer("fired_at_bucket").notNull(),

    deliveredChannels: text("delivered_channels").notNull(), // JSON array
    readAt: integer("read_at"),                // NULL until user marks read in UI
  },
  (t) => [
    // Hard deduplication: same alert cannot fire twice within same 5-min window
    uniqueIndex("uq_alert_fire_dedupe").on(t.alertId, t.firedAtBucket),
    // User notification feed (newest first)
    index("idx_alert_fires_user_feed").on(t.userId, t.firedAt),
  ]
);

export const priceCache = sqliteTable("price_cache", {
  ticker: text("ticker").primaryKey(),
  regularMarketPrice: real("regular_market_price").notNull(),
  regularMarketChangePercent: real("regular_market_change_percent"),
  preMarketPrice: real("pre_market_price"),
  postMarketPrice: real("post_market_price"),
  previousClose: real("previous_close"),
  fetchedAt: integer("fetched_at").notNull(),
  source: text("source").notNull().default("yahoo"),
});
```

---

### Scale Path Summary

| Phase | Users | Active Alerts | Tickers | Architecture | Cost Delta |
|---|---|---|---|---|---|
| MVP | 1–50 | ≤250 | ≤75 | In-process node-cron, Yahoo Finance quoteCombine, SQLite writes | $0 |
| Growth | 50–150 | 250–750 | 75–150 | Same + add request backoff + Twelve Data paid fallback | +$29/mo (Twelve Data Basic) |
| Scale | 150–500 | 750–2500 | 150–300 | Separate Railway worker service, Twelve Data primary, Drizzle batch writes | +$79/mo (Twelve Data Growth) + ~$2/mo (Railway worker) |
| Inflection | 500–1000 | 2500+ | 300+ | Postgres (Neon), BullMQ + Redis for distribution, WebSocket data feed | Significant architecture revision |

---

*Research compiled 2026-07-16. All Railway pricing, Twelve Data credit limits, and library behaviors verified against current documentation and community reports as of this date.*
