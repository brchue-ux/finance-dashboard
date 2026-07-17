# Finance Intelligence Dashboard — Buildable Spec

**Date:** 2026-07-16 (post-completion analysis corrections applied)
**Status:** Ready to build. All decisions locked. No further decisions required before execution.

---

## 1. What This App Is

A personal finance intelligence dashboard for a single Canadian user, designed for multi-user expansion from day one. It aggregates Wealthsimple portfolio data, bank transactions from RBC, Tangerine, and Scotiabank, and TradingView market alerts — then uses Claude as an advisory engine to surface actionable insights across budgeting and investing.

The user is transitioning from a Wealthsimple auto-managed (robo-advisory) portfolio to self-directed investing. The north star metric is **total net worth growth**. Every feature serves that goal.

**Distribution:** Web (hosted) + sideloadable Android APK. Play Store path open without rewriting.

---

## 2. Architecture

### Topology

```
┌─────────────────────┐     HTTPS      ┌──────────────────────┐
│   Expo React Native │ ◄────────────► │  Next.js API Routes  │
│   (Vercel, free)    │                │  (Railway, $5/mo)    │
└─────────────────────┘                └──────────┬───────────┘
                                                  │
                          ┌───────────────────────┼────────────────────────┐
                          │                       │                        │
                   ┌──────▼──────┐      ┌────────▼────────┐     ┌────────▼────────┐
                   │   Turso DB  │      │  External APIs  │     │  Claude API     │
                   │  (SQLite)   │      │  Plaid/SnapTrade│     │  (Anthropic)    │
                   └─────────────┘      │  Yahoo Finance  │     └─────────────────┘
                                        │  TradingView MCP│
                                        └─────────────────┘
```

Backend and frontend are **always separated** — no Next.js monolith. The backend is a persistent Node.js process on Railway. The frontend is a static Expo web build on Vercel plus a sideloadable Android APK built via Expo EAS.

### Tech Stack

| Layer | Technology | Notes |
|---|---|---|
| Backend | Next.js API routes | Runs as persistent Node.js on Railway — no serverless timeout |
| Frontend | Expo React Native | One codebase: web (Vercel) + Android APK (EAS) |
| Mobile build | Expo EAS Build | Generates sideloadable APK; Play Store ready without rewrite |
| Auth | Better Auth (self-hosted) | Full token control; moves with backend |
| Database | Turso (SQLite) + Drizzle ORM | Free tier; migrate to Neon (Postgres) at scale via Drizzle dialect swap |
| LLM | Vercel AI SDK (`streamText`) | Model-agnostic abstraction over Anthropic SDK; ESM-only, requires Node.js 22+ |
| UI | NativeWind (Tailwind for React Native) | Consistent styling across web and mobile |
| Data fetching | TanStack Query (`refetchInterval`) | Polling-based real-time; no WebSocket infrastructure |
| Scheduled jobs | Railway cron | Background sync, daily portfolio refresh |
| Wealthsimple | SnapTrade API | OAuth per-user, ToS-compliant, free tier ($0 for ≤5 connections) |
| Banks | Plaid (Trial plan) | Free, self-serve, all 6 accounts confirmed |
| Market data | Yahoo Finance npm library | Alpha Vantage free tier as documented fallback |
| Charts | Lightweight Charts v5 + deepentropy | 446+ indicators; Apache 2.0 licensed; self-hosted |
| Price alerts | `node-cron` + `yahoo-finance2` `quoteCombine` | In-process poller, 5-min intervals, market hours aware via `@sebspark/trading-hours` |
| TradingView alerts | Webhook → Railway endpoint | Best-effort delivery; stored in Turso; optional enhancement for paid TradingView users |
| TradingView data | `twelvedata/mcp` (official Twelve Data MCP server) | HTTP transport; Claude queries live indicator data (RSI, MACD, MA20/50, volume) as tool calls; free tier 800 calls/day |

---

## 3. Auth & Security

### Sign-up Model
No public sign-up UI at launch. A single user account is seeded at deploy time via a Drizzle seed script (`db/seed.ts`). The script reads `SEED_EMAIL` and `SEED_PASSWORD` from Railway environment variables, creates the user in Turso, and exits. If the user already exists, it skips silently. The script runs as a Railway deploy hook on first deploy.

`PUBLIC_SIGNUP_ENABLED` environment variable (default: `false`) controls whether the sign-up route is active. Flip to `true` when publishing to the Play Store.

### Credential Storage
All third-party tokens encrypted **before** writing to Turso using AES-256-GCM. Encryption key stored in Railway environment variable `ENCRYPTION_KEY` (Railway encrypts env vars at rest). Decrypted at runtime in Railway's memory only — never written to disk or logs.

Tokens stored this way:
- Plaid `access_token` per bank connection
- SnapTrade user auth token (Wealthsimple)
- Google OAuth tokens (used only during one-time historical import; deleted after import completes)

**Better Auth `encryptOAuthTokens` note:** Better Auth v1.5 introduced `encryptOAuthTokens: true` as a configuration option that encrypts OAuth tokens before database storage natively. This covers tokens Better Auth manages directly (Google OAuth during the import flow). Plaid `access_token` and SnapTrade auth tokens are not managed by Better Auth's OAuth layer and require manual AES-256 encryption as described above. Evaluate at build time whether the `encryptOAuthTokens` option can handle Google OAuth tokens, reducing custom encryption code to Plaid and SnapTrade only.

### HTTPS
Enforced everywhere. Railway and Vercel both provide HTTPS automatically. No configuration required.

### Session Model
Better Auth handles sessions. Session tokens stored in Turso per user. Sessions expire per Better Auth defaults. The Expo frontend stores the session token in secure storage (Expo SecureStore).

### Multi-User Security Model
Each user's data is isolated by `user_id` on every Turso table. No query ever runs without a `WHERE user_id = ?` clause. LLM context is assembled per-user at request time — no cross-user data exposure at any layer. Claude has no persistent memory between sessions; each advisory session is stateless beyond what the app explicitly injects.

---

## 4. Database Schema

All tables use Drizzle ORM with Turso (LibSQL) dialect. IDs are UUIDs generated at the application layer.

### `users`
```
id           TEXT PRIMARY KEY
email        TEXT UNIQUE NOT NULL
created_at   INTEGER NOT NULL  -- Unix timestamp
```
Password hash managed by Better Auth in its own table.

### `bank_connections`
```
id                   TEXT PRIMARY KEY
user_id              TEXT NOT NULL REFERENCES users(id)
institution_name     TEXT NOT NULL  -- "RBC", "Tangerine", "Scotiabank"
plaid_item_id        TEXT NOT NULL
plaid_access_token   TEXT NOT NULL  -- AES-256 encrypted
status               TEXT NOT NULL  -- "active" | "relink_required" | "error"
last_synced_at       INTEGER        -- Unix timestamp
created_at           INTEGER NOT NULL
```

### `bank_accounts`
```
id                TEXT PRIMARY KEY
user_id           TEXT NOT NULL REFERENCES users(id)
connection_id     TEXT NOT NULL REFERENCES bank_connections(id)
plaid_account_id  TEXT NOT NULL UNIQUE
name              TEXT NOT NULL
type              TEXT NOT NULL  -- "chequing" | "savings" | "credit"
mask              TEXT           -- last 4 digits
institution       TEXT NOT NULL
```

### `transactions`
```
id                   TEXT PRIMARY KEY
user_id              TEXT NOT NULL REFERENCES users(id)
account_id           TEXT NOT NULL REFERENCES bank_accounts(id)
plaid_transaction_id TEXT UNIQUE
date                 TEXT NOT NULL  -- ISO 8601 YYYY-MM-DD
description          TEXT NOT NULL  -- raw bank description
merchant_name        TEXT           -- cleaned by categorization engine
amount               REAL NOT NULL  -- negative = debit, positive = credit
category             TEXT           -- envelope name assigned
pending              INTEGER NOT NULL DEFAULT 0  -- boolean
created_at           INTEGER NOT NULL
```
Transactions are append-only. Never deleted. Corrections update `category` and `merchant_name` only.

### `budget_envelopes`
```
id                TEXT PRIMARY KEY
user_id           TEXT NOT NULL REFERENCES users(id)
name              TEXT NOT NULL
monthly_target    REAL NOT NULL
category_rules    TEXT NOT NULL  -- JSON: array of merchant/keyword rules
active            INTEGER NOT NULL DEFAULT 1
sort_order        INTEGER NOT NULL DEFAULT 0
created_at        INTEGER NOT NULL
```

### `envelope_allocations`
One row per envelope per month. Allows envelope targets to flex month-to-month without changing the base target.
```
id            TEXT PRIMARY KEY
user_id       TEXT NOT NULL REFERENCES users(id)
envelope_id   TEXT NOT NULL REFERENCES budget_envelopes(id)
year          INTEGER NOT NULL
month         INTEGER NOT NULL  -- 1-12
allocated     REAL NOT NULL     -- may differ from envelope monthly_target after reallocation
UNIQUE(envelope_id, year, month)
```

### `wealthsimple_connections`
```
id                      TEXT PRIMARY KEY
user_id                 TEXT NOT NULL REFERENCES users(id)
snaptrade_user_id       TEXT NOT NULL
snaptrade_auth_token    TEXT NOT NULL  -- AES-256 encrypted
status                  TEXT NOT NULL  -- "active" | "reconnect_required"
last_synced_at          INTEGER
created_at              INTEGER NOT NULL
```

### `portfolio_snapshots`
One row per sync. Never overwritten — append only. This is the time-series that powers LLM trend analysis.
```
id              TEXT PRIMARY KEY
user_id         TEXT NOT NULL REFERENCES users(id)
snapshot_at     INTEGER NOT NULL  -- Unix timestamp
total_value     REAL NOT NULL
cash_value      REAL NOT NULL
accounts        TEXT NOT NULL  -- JSON: { tfsa: number, rrsp: number, non_reg: number, crypto: number }
created_at      INTEGER NOT NULL
```

### `holdings`
```
id              TEXT PRIMARY KEY
user_id         TEXT NOT NULL REFERENCES users(id)
snapshot_id     TEXT NOT NULL REFERENCES portfolio_snapshots(id)
ticker          TEXT NOT NULL
name            TEXT NOT NULL
quantity        REAL NOT NULL
cost_basis      REAL NOT NULL   -- per share
market_value    REAL NOT NULL   -- total position value at snapshot time
account_type    TEXT NOT NULL   -- "tfsa" | "rrsp" | "non_reg" | "crypto"
created_at      INTEGER NOT NULL
```

### `portfolio_transactions`
```
id              TEXT PRIMARY KEY
user_id         TEXT NOT NULL REFERENCES users(id)
date            TEXT NOT NULL   -- ISO 8601
type            TEXT NOT NULL   -- "buy" | "sell" | "dividend" | "deposit" | "withdrawal"
ticker          TEXT
quantity        REAL
price           REAL
amount          REAL NOT NULL
account_type    TEXT NOT NULL
created_at      INTEGER NOT NULL
```

### `price_alerts`
```
id                   TEXT PRIMARY KEY
user_id              TEXT NOT NULL REFERENCES users(id)
ticker               TEXT NOT NULL
holding_id           TEXT REFERENCES holdings(id)         -- optional: links to a held position
label                TEXT                                 -- user-defined, e.g. "AAPL stop-loss"
condition_type       TEXT NOT NULL                        -- "price_above" | "price_below" | "pct_change_up" | "pct_change_down"
                                                          -- v2: "ma_cross_above" | "ma_cross_below" | "rsi_above" | "rsi_below" | "volume_spike"
threshold            REAL NOT NULL                        -- dollar price OR decimal pct (0.03 = 3%)
condition_params     TEXT                                 -- JSON: extra parameters for complex conditions (NULL for simple threshold alerts)
                                                          -- e.g. ma_cross_above: {"period":20,"ma_type":"SMA"}
                                                          -- e.g. rsi_above:      {"period":14}
                                                          -- e.g. volume_spike:   {"baseline_period":20,"multiplier":2.0}
extended_hours       INTEGER NOT NULL DEFAULT 0           -- 0 = regular session only, 1 = include pre/post market
status               TEXT NOT NULL DEFAULT 'active'       -- "active" | "triggered" | "paused" | "expired"
cooldown_seconds     INTEGER                              -- NULL = one-time fire (default); set value for recurring alerts
next_check_at        INTEGER                              -- Unix timestamp; NULL = check every poll
last_triggered_at    INTEGER                              -- Unix timestamp of most recent fire
trigger_count        INTEGER NOT NULL DEFAULT 0
source               TEXT NOT NULL DEFAULT 'native'       -- "native" | "tradingview"
notification_channels TEXT NOT NULL DEFAULT '["in_app"]' -- JSON array
created_at           INTEGER NOT NULL
updated_at           INTEGER NOT NULL
expires_at           INTEGER
```
Indexes: `(ticker, status)` for polling query; `(user_id, status)` for user alert list; `(next_check_at)` for cooldown window.

### `alert_fires`
```
id                   TEXT PRIMARY KEY
alert_id             TEXT NOT NULL REFERENCES price_alerts(id)
user_id              TEXT NOT NULL REFERENCES users(id)
ticker               TEXT NOT NULL
condition_type       TEXT NOT NULL
threshold            REAL NOT NULL
trigger_price        REAL NOT NULL                        -- actual price at fire time
trigger_pct_change   REAL                                 -- populated for pct_change conditions
source               TEXT NOT NULL                        -- "native" | "tradingview"
fired_at             INTEGER NOT NULL                     -- Unix timestamp
fired_at_bucket      INTEGER NOT NULL                     -- FLOOR(fired_at / 300) * 300 — 5-min deduplication bucket
delivered_channels   TEXT NOT NULL                        -- JSON array
read_at              INTEGER                              -- NULL until user marks read
```
Unique constraint: `(alert_id, fired_at_bucket)` — hard DB-level deduplication preventing double-fire within same 5-minute poll window.

### `price_cache`
```
ticker                        TEXT PRIMARY KEY
regular_market_price          REAL NOT NULL
regular_market_change_percent REAL
pre_market_price              REAL
post_market_price             REAL
previous_close                REAL
fetched_at                    INTEGER NOT NULL             -- Unix timestamp of last successful fetch
source                        TEXT NOT NULL DEFAULT 'yahoo'
```
Last-known-good prices. Prevents false alerts from null/stale data when a poll cycle fails mid-way.

### `tradingview_alerts`
```
id              TEXT PRIMARY KEY
user_id         TEXT NOT NULL REFERENCES users(id)
ticker          TEXT NOT NULL
condition_text  TEXT NOT NULL
price           REAL
interval        TEXT
raw_payload     TEXT NOT NULL  -- JSON: full webhook body
received_at     INTEGER NOT NULL
analyzed_at     INTEGER        -- NULL until user triggers analysis
```
Raw TradingView webhook event log — append-only, immutable. Separate from `price_alerts` (which is a standing monitoring instruction). The unified Alerts UI queries `alert_fires` (with `source` field) rather than merging this table directly.

### `llm_analysis_cache`
```
id               TEXT PRIMARY KEY
user_id          TEXT NOT NULL REFERENCES users(id)
view             TEXT NOT NULL   -- "budget" | "portfolio"
last_analyzed_at INTEGER NOT NULL
output           TEXT NOT NULL   -- JSON: array of card objects
created_at       INTEGER NOT NULL
UNIQUE(user_id, view)
```
On re-analysis, the existing row is overwritten (upsert). This is the exception to append-only — analysis output is always the latest.

### `import_jobs`
```
id              TEXT PRIMARY KEY
user_id         TEXT NOT NULL REFERENCES users(id)
source          TEXT NOT NULL   -- "google_sheets" | "csv"
status          TEXT NOT NULL   -- "pending" | "processing" | "complete" | "failed"
rows_imported   INTEGER DEFAULT 0
error_message   TEXT
created_at      INTEGER NOT NULL
completed_at    INTEGER
```

---

## 5. Data Integrations

### 5.1 Plaid — Bank Transactions

**Accounts:** RBC Visa, RBC chequing (one Plaid Item), Tangerine Mastercard + 2 Tangerine accounts (one Item), Scotiabank chequing (one Item). ~3 Items total — within Plaid Trial plan free tier (10 Items max).

**Connection flow:**
1. Backend: `POST /link/token/create` with `country_codes: ['CA']`, `products: ['transactions']`, `client_user_id`
2. Frontend: Initialize Plaid Link widget with `link_token`
3. For RBC (OAuth-based): user redirected to RBC login portal; `redirect_uri` must be registered in Plaid dashboard and updated when custom domain is set (see §10 Deployment Checklist)
4. Frontend: receives `public_token` on success
5. Backend: exchange for `access_token` + `item_id` via `POST /item/public_token/exchange`
6. Store `access_token` AES-256 encrypted in `bank_connections`

**Sync:**
- Use `/transactions/sync` (not deprecated `/transactions/get`)
- Listen for `SYNC_UPDATES_AVAILABLE` and `ITEM_LOGIN_REQUIRED` webhooks
- On `ITEM_LOGIN_REQUIRED`: set `bank_connections.status = 'relink_required'`; surface reconnect banner in UI
- Transactions appended to `transactions` table; never deleted

**Tangerine known issue:** Open MFA bug — MFA is invalidated shortly after initial connection. Background sync fails regularly. When `ITEM_LOGIN_REQUIRED` fires for a Tangerine Item, the app surfaces: *"Tangerine connection needs attention — tap to reconnect."* User re-runs Plaid Link in update mode. This is a known Plaid/Tangerine issue with no resolution timeline. Expected frequency: potentially weekly. Build the relink flow robustly.

**Tangerine transaction lag:** Even with a healthy Tangerine connection, transaction data may be 5–9 days delayed. This is a Tangerine-side limitation, not an aggregator bug. Surface this in the Tangerine connection status row in Settings: *"Tangerine transactions may take up to 9 days to appear."*

**Scotiabank connection stability:** Plaid's Scotiabank connection is credential/scraping-based (no formal bank API deal as of 2026). Estimated 2–4 auth breaks per year when Scotiabank changes their web UI or auth flows. The `ITEM_LOGIN_REQUIRED` webhook handles this identically to Tangerine relinks. Reliability: MEDIUM.

**Data enrichment:** Plaid's Canadian merchant enrichment is weaker than US. Raw `description` field from the bank is the reliable signal. The app's own categorization engine (§6) does the cleanup.

### 5.2 SnapTrade — Wealthsimple Portfolio

**Connection flow:**
1. Create SnapTrade user: `POST /api/v1/snapTrade/users` with internal `user_id`
2. Generate connection link: `POST /api/v1/snapTrade/login` → returns OAuth URL
3. User authenticates with Wealthsimple via SnapTrade's hosted UI
4. Store `snaptrade_user_id` and `snaptrade_auth_token` (encrypted) in `wealthsimple_connections`

**Sync (daily 2am + on-demand):**
1. Fetch all accounts: `GET /api/v1/accounts`
2. Fetch holdings per account: `GET /api/v1/accounts/{accountId}/holdings`
3. Fetch recent transactions: `GET /api/v1/accounts/{accountId}/activities`
4. Write new `portfolio_snapshots` row (append — never overwrite)
5. Write `holdings` rows linked to that snapshot
6. Append new `portfolio_transactions`
7. Update `wealthsimple_connections.last_synced_at`

**On auth failure:** Set `wealthsimple_connections.status = 'reconnect_required'`; surface soft reconnect banner. User re-runs SnapTrade OAuth flow.

**Cost:** SnapTrade free tier covers ≤5 connections at $0. Scale path: pay-as-you-go at $1.50/connected user/month + $0.05/manual sync → custom plan at volume.

### 5.3 Yahoo Finance — Market Data

Used exclusively to feed OHLCV data into Lightweight Charts. Not used for portfolio valuation (SnapTrade provides that at sync time).

**Implementation:** Use a maintained Yahoo Finance npm library (e.g., `yahoo-finance2`). Fetch on chart load for the requested ticker and time range. Cache responses in Turso for 24 hours to avoid redundant calls.

**Fallback:** If Yahoo Finance npm library is unavailable or rate-limited, fall behind to Alpha Vantage free tier (25 req/day). Implement as a `MarketDataProvider` interface with two concrete implementations: `YahooFinanceProvider` and `AlphaVantageProvider`. The backend tries Yahoo first; falls back to Alpha Vantage on error. The switch is automatic — no user action.

**Scope:** Historical OHLCV for chart rendering only. Live intraday real-time is deferred — Polygon.io is the documented upgrade path when needed.

### 5.4 TradingView Alerts — Webhook

**Endpoint:** `POST /api/webhooks/tradingview`

**Authentication:** No auth headers available from TradingView. Validate a shared secret embedded in the alert message body. Alert message JSON format:
```json
{
  "secret": "{{your-shared-secret}}",
  "ticker": "{{ticker}}",
  "interval": "{{interval}}",
  "price": {{close}},
  "time": "{{time}}",
  "condition": "RSI Oversold"
}
```
The endpoint rejects payloads where `secret` does not match `TRADINGVIEW_WEBHOOK_SECRET` env var.

**Processing:** Validate → write to `tradingview_alerts` → return 200 within 3 seconds (TradingView drops after 3s, including DNS resolution time). Do not process synchronously — write and return immediately.

**Delivery constraints:** No retries, no delivery guarantee, 15 alerts per 3-minute rate limit. Missed alerts are accepted. Do not use for time-critical automated actions.

**TradingView plan requirement:** Webhooks are not available on the TradingView Free plan. At minimum, the Essential plan is required. The Premium plan is recommended for production use — it includes 800 active alerts with no expiry vs. Essential's 20 alerts with ~60-day expiry. HTTP 4xx responses and timeouts are silently dropped with no retry; only HTTP 5xx triggers up to 3 retries at 5-second intervals.

**UI:** Alerts tab shows chronological feed. Badge count for unread. Tap → detail view with "Analyze with Claude" button.

### 5.5 Twelve Data MCP Server — Live Indicator Data

**Project:** [`twelvedata/mcp`](https://github.com/twelvedata/mcp) — the official vendor-maintained MCP server from Twelve Data. Exposes 130+ technical indicators including RSI, MACD, MA20, MA50, volume analysis, and technical summary via HTTP transport to `https://mcp.twelvedata.com/mcp`. No separate Railway service required — it runs as a remote MCP endpoint.

**Why not the alternatives:**
- `tradesdontlie/tradingview-mcp`: development-time tool only; connects to TradingView Desktop locally via Chrome DevTools Protocol; cannot be deployed as a server.
- `atilaahmettaner/tradingview-mcp`: core dependency (`python-tradingview-ta`) archived June 2024; hits unofficial TradingView scanner endpoints that return 403 from cloud IPs (confirmed on Railway-equivalent infrastructure).

**Setup:** Configure Vercel AI SDK v7 to connect to `https://mcp.twelvedata.com/mcp` as a remote MCP endpoint with the Twelve Data API key. No additional Railway service needed.

**Usage:** Claude calls it when it needs technical context on a holding — e.g., "let me check the current RSI on AAPL before recommending a position change." Claude decides when to invoke it; user can also explicitly ask for technical analysis.

**Cost:** Free tier: 800 API calls/day — sufficient for solo use (estimated 20–40 calls/day at normal advisory usage). Grow plan: $29/month for higher volume. Upgrade triggered when multi-user scale pushes past free tier.

**Indicator accuracy:** Twelve Data computes indicators server-side using industry-standard calculation methods consistent with TradingView's own readings. No divergence risk between app indicator values and what the user sees on TradingView charts.

### 5.6 Native Price Alert System

**Architecture:** In-process `node-cron` scheduler registered once at server startup inside the existing Railway persistent Node.js process. No separate service required at MVP. Zero cost delta.

**Polling interval:** Every 5 minutes during market hours only. Market hours check via `@sebspark/trading-hours` npm package (`isTradingTime('NYSE') || isTradingTime('TSX')`). Off-hours, weekends, and market holidays skip polling entirely.

**Data source:** `yahoo-finance2` `quoteCombine()` as primary — batches all distinct active-alert tickers into a single HTTP request via a 50ms debounce window. Twelve Data REST `/price` endpoint as fallback on Yahoo 429 or persistent errors (note: Twelve Data free tier supports only ~8 poll cycles/day at 100 tickers — used as infrequent fallback only; upgrade to Twelve Data paid at ~150 users when Yahoo reliability pressures).

**Ticker deduplication:** One price fetch per distinct ticker per poll cycle, evaluated against all users' alerts for that ticker. At 100 users with 500 alerts across 100 tickers: 100 price fetches, not 500.

**Poll cycle (pseudocode):**
```
1. isTradingTime check → exit if market closed
2. mutex check → exit if previous cycle still running
3. SELECT DISTINCT ticker FROM price_alerts WHERE status = 'active' AND (next_check_at IS NULL OR next_check_at <= now())
4. quoteCombine(all tickers) → in-memory price map
5. Write prices to price_cache (last-known-good)
6. SELECT * FROM price_alerts WHERE status = 'active' AND ticker IN (fetched tickers)
7. For each alert: evaluate condition against price map
8. On match: INSERT alert_fires (with firedAtBucket deduplication), UPDATE price_alerts.status = 'triggered', UPDATE price_alerts.last_triggered_at
9. release mutex
```

**MVP condition types:**
- `price_above` — `currentPrice > threshold`
- `price_below` — `currentPrice < threshold`
- `pct_change_up` — `regularMarketChangePercent > threshold` (e.g., 0.03 = 3% up today)
- `pct_change_down` — `regularMarketChangePercent < -threshold`

All four use data already in the Yahoo Finance quote response. No additional API calls. `conditionParams` JSON column is NULL for all four MVP types.

**v2 condition types** (deferred — requires price history accumulation):
- `ma_cross_above/below` — `conditionParams: {"period":20,"ma_type":"SMA"}`
- `rsi_above/below` — `conditionParams: {"period":14}` (integrate with Twelve Data MCP)
- `volume_spike` — `conditionParams: {"baseline_period":20,"multiplier":2.0}`

**Alert lifecycle:** One-time fire by default — alert fires once, status → `triggered`, user manually re-arms. Optional `cooldown_seconds` for recurring alerts (status stays `active`, `next_check_at` set to `now() + cooldown_seconds`).

**Deduplication:** `alert_fires.firedAtBucket` unique constraint on `(alert_id, FLOOR(fired_at/300)*300)` — hard DB-level guard prevents double-fire within the same 5-minute poll window even if application logic has a bug.

**Relationship to TradingView alerts:** `price_alerts` (standing monitoring instruction) and `tradingview_alerts` (raw webhook event log) remain separate tables. The unified Alerts UI queries `alert_fires` with `source = 'native' | 'tradingview'` — one feed, two sources. Users on TradingView Free plan get full alert functionality via native polling; TradingView webhooks are an optional enhancement for paid-plan users who want Pine Script-driven conditions.

**Scale path:**
- 0–50 users: in-process node-cron, Yahoo Finance, $0 delta
- 50–150 users: add request backoff + Twelve Data paid fallback ($29/mo)
- 150–500 users: move poller to separate Railway worker service; Twelve Data as primary ($79/mo)
- 500+: Postgres migration, BullMQ, WebSocket data feed — significant revision

### 5.7 Historical Data Import Pipeline

**Architecture:** A generic import pipeline with pluggable source adapters. All adapters normalize data into the same internal format before writing to Turso.

**Adapters at launch:**
- `GoogleSheetsAdapter` — OAuth 2.0 via `google-spreadsheet` npm; reads transaction rows; uses `UNFORMATTED_VALUE`; converts date serials via `new Date((serial - 25569) * 86400 * 1000)`; maps categories to envelope names; disconnects Google OAuth immediately after import completes. **Important:** when initializing the OAuth client, always pass `expiry_date` alongside `access_token` and `refresh_token` in `setCredentials` — auto-refresh does not reliably trigger without `expiry_date` set (googleapis/google-api-nodejs-client #2350).
- `CsvAdapter` — parses uploaded CSV; maps columns via a user-configured mapping UI; same normalization pipeline

**Onboarding flow:** After connecting bank accounts, app prompts: "Import historical data? (Google Sheets / CSV / Skip)". Can also be triggered later from Settings → "Import historical data." Import status tracked in `import_jobs` table.

**Deduplication:** On import, check `plaid_transaction_id` uniqueness. For imported rows (no Plaid ID), use a composite key of `(date, amount, description)` to detect duplicates. Flag conflicts for user review rather than silently dropping.

---

## 6. Budget System

### Envelope Model
Each `budget_envelope` has a `monthly_target` and a set of `category_rules` — an array of merchant name patterns and keywords that auto-assign transactions to that envelope. Category assignment runs automatically on every new transaction sync.

### Categorization Engine
On each transaction write:
1. Normalize `description` (uppercase, strip branch numbers, common suffixes)
2. Test against each envelope's `category_rules` in priority order
3. First match wins → set `transactions.category` to envelope name
4. No match → set `category = 'uncategorized'`, flag for user review

**Note on LLM fallback:** The LLM is NOT called for uncategorized transactions during sync. Ticket 004 referenced "LLM resolves unknown merchants" — this is explicitly not implemented at sync time, as it would violate the design principle that LLM never runs on sync (§7). Uncategorized transactions go directly to the user review queue. The LLM may reference uncategorized transaction patterns in advisory cards but does not auto-categorize individual transactions.

Rules are JSON arrays per envelope:
```json
["TIM HORTONS", "STARBUCKS", "SECOND CUP", "TIMS"]
```
Exact and substring matching. Case-insensitive. Rules are user-editable in Settings → Categories.

**On-demand correction:** User taps a transaction → changes category → choice is saved and optionally applied as a new rule ("Always categorize X as Y?").

**Accuracy requirement:** High. The categorization engine is the foundation of LLM budget advice quality. Prefer false positives (over-categorized) over false negatives (uncategorized). Ship with a sensible default rule set for common Canadian merchants.

### Budget Periods
Monthly periods. `envelope_allocations` stores the actual allocated amount per envelope per month — this can differ from `monthly_target` when reallocation occurs.

**Reallocation:** When Claude suggests moving budget between envelopes, it creates a proposed change to `envelope_allocations`. User sees an action card: "Move $20 from Transport to Restaurants?" with Approve / Dismiss. Approved changes write to `envelope_allocations`. Dismissed changes are logged but not applied.

### Pay Frequency
Flexible config stored as a user preference: `pay_frequency` (weekly, biweekly, semi-monthly, monthly) and `pay_day`. Used by the LLM for income projection and budget period planning. Not used for anything structural — the budget period is always monthly.

---

## 7. Sync Strategy

### Staleness Model
Two timestamps tracked per data source in their respective connection tables: `last_synced_at`.

One timestamp per LLM view in `llm_analysis_cache`: `last_analyzed_at`.

**On app open (any view):**
- If `last_synced_at` < 15 minutes ago → serve cached data instantly, no sync
- If `last_synced_at` ≥ 15 minutes ago → sync in background, show last-known data while syncing

**Pull-to-refresh:** Always triggers a sync regardless of staleness. User explicitly requested it.

**Hard debounce:** If `last_synced_at` < 2 minutes ago → ignore sync request entirely. Prevents runaway API costs.

**Background sync:** Daily at 2am via Railway cron. Syncs all data sources. Ensures trend history is never gapped even on days the app isn't opened.

### LLM Trigger
On page load for Budget and Portfolio views:
- If `last_synced_at` > `last_analyzed_at` → new data exists since last analysis → auto-run LLM, cache result in `llm_analysis_cache`
- If `last_analyzed_at` ≥ `last_synced_at` → nothing new → serve cached cards instantly with "Analyzed X ago" timestamp

LLM **never** runs on sync itself. LLM **never** runs on pull-to-refresh unless new data was returned.

**Re-analyze button:** Always visible. Forces fresh LLM run regardless of staleness state. Subject to 2-minute debounce.

---

## 8. LLM Advisory Engine

### Model
Claude via Vercel AI SDK (`streamText`). Model-agnostic — switching Claude model versions requires changing one constant. Anthropic is the provider at launch.

### Trigger Model (detail)
- **Auto-generated cards** (Budget/Portfolio page load with new data): batch render — Claude generates all cards, app parses structured output, renders fully-formed cards simultaneously. No streaming animation.
- **User-initiated conversation** (follow-up questions, alert analysis, explicit "Ask Claude" sessions): `streamText` with token-by-token streaming. Standard chat UX.
- **Alert-triggered:** User taps alert → taps "Analyze with Claude" → opens conversation bottom sheet with alert context pre-loaded. Never auto-fires on alert receipt.

### Context Assembly

Context is assembled per-user at request time from Turso. Never shared across users.

**Budget view context:**
```
System prompt (see below)
+ Last 12 months of transactions, grouped by month and envelope (full row detail)
+ Months older than 12 months: monthly category summaries only (envelope name + total)
+ All envelope targets and current allocations
+ Pay frequency and schedule
+ Current month transactions in full detail
```

**Portfolio view context:**
```
System prompt (see below)
+ All portfolio snapshots (full history — time-series of total_value and account breakdown)
+ All current holdings (ticker, quantity, cost basis, market value, account type)
+ Recent portfolio transactions (last 90 days)
+ If alert-triggered: the alert payload (ticker, condition, price, interval)
```

**Context rollup trigger:** When total transaction row count exceeds 5,000 (~2-3 years of history), months older than 12 months switch from row-level detail to monthly category summaries. This threshold is a named constant. **Post-launch review required:** after the first cohort of data crosses the 12-month threshold, verify that LLM advice quality does not degrade on trend-based recommendations.

### System Prompt

```
You are a personal finance advisor for a single user. You have full access to their financial data.

ROLE: Direct, opinionated advisor. Give concrete recommendations. Do not reflexively hedge.
Treat the user as an informed adult. Note genuine uncertainty when it exists.

CANADIAN CONTEXT:
- TFSA: tax-free growth and withdrawals. Selling inside a TFSA has no capital gains implications.
- RRSP: contributions are tax-deductible. Withdrawals are taxable income.
- Non-registered accounts: capital gains on disposition are 50% taxable.
- Always factor account type into any sell/buy recommendation.

INVESTMENT POSTURE:
- User is transitioning from Wealthsimple auto-managed (robo-advisory, ETF-based) to self-directed investing.
- Current objective: sell ETF holdings and build a self-directed portfolio.
- Current defensive stance: minimize equity exposure, favor fixed income and defensive assets.
  Rationale: perceived market overvaluation.
- Intent: shift to aggressive equity positioning following a significant market correction.
- Proactively flag when market indicators suggest conditions are shifting relative to this strategy.
- When advising on selling ETFs: factor account type (TFSA/RRSP/non-reg) and capital gains implications.

BUDGET PHILOSOPHY:
- Envelope-style budgeting. User sets monthly targets per envelope. These are the source of truth.
- North star: increase total net worth. Frame budget advice around freeing capital for investment.
- Connect budget and investment views: quantify what spending reductions mean for annual investment capacity.
- When suggesting reallocations: be specific about source and destination envelopes and amounts.

PRIVACY: This context is private to this user. Never reference other users or general population data.

DATA CONTEXT:
[Injected at request time: current date, last sync timestamps, view-specific data]
```

User-configurable preferences (risk posture, savings goals, investment time horizon) are stored in Turso and appended to the system prompt at request time.

### Tool Use
- **Web search:** Enabled, ungated. Claude uses it when it needs external context (interest rates, earnings news, macro events, ticker-specific news). User can also explicitly request: "search for X." Results rendered inline.
- **`tradesdontlie` MCP:** Enabled. Claude calls it to query live TradingView indicator data (RSI, MACD, moving averages, volume) on any ticker during advisory sessions. Claude decides when to invoke it based on the advisory context.

### Output Structure

**Auto-generated cards** (structured JSON output from Claude, parsed by the backend):
```json
{
  "cards": [
    {
      "type": "insight",
      "title": "Restaurants trending over budget",
      "body": "3rd consecutive month above target. $420 spent vs $400 target.",
      "reasoning": "Based on 3-month trend across June, July, August 2026."
    },
    {
      "type": "action",
      "title": "Move $20 from Transport to Restaurants",
      "body": "Transport is at 40% of budget with 2 weeks remaining. Transfer covers the overage.",
      "reasoning": "Transport historically underspends in summer months.",
      "envelope_from": "Transport",
      "envelope_to": "Restaurants",
      "amount": 20
    }
  ]
}
```

Card rendering:
- **Insight cards:** Yellow-tinted, non-actionable, collapsible reasoning
- **Action cards:** Blue-tinted, Approve / Dismiss buttons, collapsible reasoning
- Approve writes the action (envelope reallocation, noted recommendation)
- Dismiss logs the dismissal — Claude will not repeat the same suggestion within the same calendar month

**Conversation mode:** Standard streaming text. Last 10 exchanges kept in session context. Oldest exchange dropped when the 11th is added.

### Token Budget
- Estimated input: 4,000–7,000 tokens per auto-analysis session
- Estimated output: 500–1,000 tokens per session (structured cards)
- Cost: ~$0.02–0.04 per session at current Claude Sonnet pricing
- Prompt caching: system prompt + static context cached via Vercel AI SDK; repeated tokens billed at ~10% of normal input price. **Note:** Anthropic's prompt cache TTL is 5 minutes (changed from 60 minutes in early 2026). For a personal finance app with sessions hours apart, the cache will almost always be cold — do not count on caching savings between user sessions. Cache hits may occur within a single session but not across sessions.
- Expected monthly cost: ~$1–3 for normal single-user usage (estimated at uncached rates; caching provides negligible savings at this usage pattern)
- No hard limits set. Revisit if multi-user deployment changes usage patterns significantly.

---

## 9. UI Structure

### Theme
Dark background (#13111C), purple/blue gradient accents (#7C3AED → #2563EB), glassmorphism cards (`rgba(255,255,255,0.05)` background + `rgba(255,255,255,0.08)` border), Inter font. NativeWind utility classes implement this across web and mobile from a single class system.

Reference: `wayfinder/prototype/ui-prototype.html` — Theme 3 (Gradient).

### Navigation
Bottom tab bar. 4 tabs:

| Tab | Icon | Badge |
|---|---|---|
| Budget | 💰 | — |
| Portfolio | 📈 | — |
| Alerts | 🔔 | Unread alert count |
| Settings | ⚙️ | — |

Active tab label uses the gradient accent color. Inactive tabs use `rgba(248,250,252,0.35)`.

### Budget Screen

1. **Header:** "Budget" title with gradient text
2. **Month navigation:** `< July 2026 >` with net position (red if negative)
3. **Summary strip:** 3 glassmorphism stat cards — Spent / Remaining / Saved
4. **Envelope grid:** One card per active envelope showing name, spent/target, progress bar (gradient fill; red gradient if over)
5. **LLM bar:** "✦ Analyzed X ago" + Re-analyze button
6. **LLM cards:** Insight and action cards (see §8)
7. **Transaction feed:** Recent transactions with merchant name, category, amount
8. **Spending trend chart:** 12-month bar chart (one bar per month, colored by on/over budget). Rendered with Lightweight Charts or a simple canvas bar chart — no external data feed required (data is local).

Month navigation swipes or taps `< >` to move between periods. Swiping the screen left/right also navigates months.

### Portfolio Screen

1. **Ticker tape:** TradingView Ticker Tape widget — scrolling price strip across top
2. **Portfolio hero:** Total value, day change, all-time return percentage
3. **Portfolio value chart:** Lightweight Charts line chart. Data: `portfolio_snapshots.total_value` time-series from Turso. No external data required — this is your actual portfolio history.
4. **Holdings list:** One row per current holding — ticker, name, current value, unrealized P&L (colored)
5. **LLM bar + cards:** Same pattern as Budget screen
6. **Economic Calendar widget:** TradingView Economic Calendar widget below cards (optional, collapsible)

Tapping a holding → **Holding Detail Screen** (see below).

### Holding Detail Screen

1. **Header:** Ticker + company name
2. **Candlestick chart:** Lightweight Charts v5. Data from Yahoo Finance (OHLCV). Portfolio overlays:
   - Horizontal dashed line at cost basis price
   - Vertical marker at purchase date
   - Label: "X shares @ $Y.YY"
3. **Indicator bar:** Toggleable indicator chips — RSI, MACD, MA20, MA50. Rendered via deepentropy library below the main chart pane.
4. **Position summary:**
   - Cost basis (per share + total)
   - Current price + total market value
   - Unrealized P&L (amount + percentage, colored)
   - Account type badge: "TFSA — No capital gains on sale" / "Non-Reg — Capital gains apply"
5. **LLM context:** If the user navigated here from an alert, the alert condition is shown. "Analyze with Claude" button opens conversation bottom sheet.

### Alerts Screen

1. **Header:** "Alerts" + unread count badge
2. **Unread section:** Alert cards — ticker, condition text, price, time ago, "Analyze with Claude →" link
3. **Earlier section:** Read alerts, same format, lower visual weight

Alert card tap → Holding Detail Screen for that ticker, with alert context pre-loaded and "Analyze with Claude" button prominent.

Alert severity dot color:
- Red: conditions suggesting risk or urgent attention (oversold, breakdown, stop-loss)
- Yellow: neutral signals (MA crossover, volume spike)
- Green: positive conditions (overbought, breakout, target reached)
Color is set by the alert condition text — a simple keyword classifier on the backend.

### Settings Screen

1. **Connected Accounts section:**
   - One row per connection (RBC, Tangerine, Scotiabank, Wealthsimple)
   - Status: "● Live" (green) or "⚠ Relink" (orange) — tapping Relink opens the reconnect flow
   - Last synced timestamp
2. **Preferences section:**
   - Risk posture (tap to change: Conservative / Defensive / Moderate / Aggressive)
   - Staleness threshold (default 15 min, configurable)
   - Background sync time (default 2:00 AM)
3. **Data section:**
   - Import historical data (triggers import pipeline)
   - Export data (future)
4. **Account section:**
   - Sign out

### LLM Conversation Bottom Sheet

Slides up from bottom of any screen. Contains:
1. **Card stack:** Auto-generated cards (fully rendered, no streaming)
2. **Conversation thread:** Streaming text responses to follow-up questions
3. **Input bar:** Text field + Send button at bottom
4. **Close button:** Dismisses sheet; does not end session (session state persists while app is open)

### Mobile vs Web Layout
Everything above is the mobile layout — single column, full width, bottom tab nav. This is the primary layout.

On web/tablet (viewport ≥ 768px): optional two-column layout where appropriate — chart pane left, data/cards right on Portfolio and Holding Detail screens. NativeWind responsive prefixes (`md:`) implement this without separate components.

---

## 10. Deployment

### Services

| Service | Provider | Plan | Purpose |
|---|---|---|---|
| Backend | Railway | Starter ($5/mo min; ~$15-25/mo actual) | Next.js API, persistent Node.js, Railway cron |
| Frontend (web) | Vercel | Hobby (free) | Static Expo web build |
| Database | Turso | Free tier | SQLite via LibSQL |
| Mobile APK | Expo EAS Build | Free tier | Android APK generation |

### Environment Variables

**Railway (backend):**
```
DATABASE_URL          -- Turso connection string
DATABASE_AUTH_TOKEN   -- Turso auth token
ENCRYPTION_KEY        -- AES-256 key for token encryption (32-byte hex)
BETTER_AUTH_SECRET    -- Better Auth session secret
PLAID_CLIENT_ID       -- Plaid API credentials
PLAID_SECRET          -- Plaid API credentials
PLAID_ENV             -- "sandbox" | "production"
SNAPTRADE_CLIENT_ID   -- SnapTrade API credentials
SNAPTRADE_CONSUMER_KEY
TRADINGVIEW_WEBHOOK_SECRET  -- Shared secret for webhook validation
TWELVE_DATA_API_KEY   -- Twelve Data REST + MCP (free tier at launch; upgrade path to paid)
ANTHROPIC_API_KEY     -- Claude API
ALPHA_VANTAGE_API_KEY -- Fallback market data
SEED_EMAIL            -- Initial user email (used once by seed script)
SEED_PASSWORD         -- Initial user password (used once by seed script)
PUBLIC_SIGNUP_ENABLED -- "false" at launch; "true" when opening to public
```

**Vercel (frontend):**
```
NEXT_PUBLIC_API_URL   -- Railway backend base URL
```

### CI/CD
- Auto-deploy on push to `main`: Railway redeploys backend, Vercel redeploys frontend
- Working pattern: feature branches → test locally → merge to `main` to ship
- Staging gate: add Railway/Vercel staging environments via config when real external users exist. No code change required.

### Expo EAS
- `eas build --platform android --profile preview` generates sideloadable APK
- New APK build required for native code changes only; JS/UI changes deploy via Expo OTA update
- Play Store submission path: `eas build --platform android --profile production` + Google Play Console

### Deployment Checklist (First Deploy)
1. Create Turso database; copy `DATABASE_URL` and `DATABASE_AUTH_TOKEN` to Railway
2. Generate `ENCRYPTION_KEY` (32-byte random hex); store in Railway
3. **Confirm Railway Node.js version is 22+.** Vercel AI SDK v7 is ESM-only and requires Node.js 22+. Set `NODE_VERSION=22` in Railway environment variables if not already the default.
4. Set all other environment variables in Railway and Vercel
5. Run `drizzle-kit push` to apply schema to Turso
6. Run `db/seed.ts` (Railway deploy hook) to create initial user account
6. **If using Google OAuth for historical import:** Set the Google Cloud project's OAuth consent screen to **Published** status (not Testing). In Testing status, refresh tokens are revoked after 7 days, causing silent `invalid_grant` failures. Alternatively, add your own email to the test user allowlist before running the import.
7. Connect SnapTrade account (Wealthsimple) via in-app Settings → Connected Accounts
8. Connect Plaid accounts (RBC, Tangerine, Scotiabank) via in-app Settings → Connected Accounts
9. Set up TradingView alerts with Railway backend webhook URL + `TRADINGVIEW_WEBHOOK_SECRET` in alert message JSON. **TradingView plan note:** webhooks require at minimum the Essential plan — they are not available on the Free plan.
10. **Register Railway URL as `redirect_uri` in Plaid dashboard** (required for RBC OAuth flow)
11. **When custom domain is configured:** update Plaid dashboard `redirect_uri` to production domain

### Scale Path

| Layer | Now | At scale |
|---|---|---|
| Backend | Railway Starter ($5/mo) | Larger Railway instance → AWS/GCP/Azure (standard Node.js) |
| Database | Turso free tier | Neon (Postgres) — change Drizzle dialect + connection string |
| Auth | Better Auth self-hosted | Unchanged — moves with backend |
| Frontend | Vercel Hobby | Vercel Pro or self-hosted static |
| SnapTrade | Free tier (≤5 connections) | Pay-as-you-go → custom plan |
| Plaid | Trial plan (≤10 Items) | Pay-as-you-go → negotiated plan |
| LLM cost | ~$1–3/mo | Per-user subscription covers it |
| Signup | Seeded account, no public sign-up | Flip `PUBLIC_SIGNUP_ENABLED=true` |
| CI/CD | Auto-deploy on `main` | Add staging environment + manual production gate via Railway/Vercel config |

---

## 11. Post-Launch Review Items

These are not blockers — they are scheduled reviews to conduct after the app has been running.

1. **LLM context quality at 12-month rollover:** After the first batch of transaction data crosses the 12-month threshold and monthly summaries replace row-level detail for older data, evaluate whether LLM trend-based advice quality degrades. Adjust the rollover threshold or summarization strategy if needed.

2. **Tangerine sync reliability:** Monitor `ITEM_LOGIN_REQUIRED` frequency for Tangerine Items. If relink frequency is unacceptably high (more than biweekly), evaluate whether Flinks becomes accessible via a commercial arrangement or whether CDBA Phase 1 (expected H2 2027) resolves it via standardized APIs.

3. **Yahoo Finance stability:** Monitor for breakage in the Yahoo Finance npm library. If it breaks and Alpha Vantage's 25 req/day free tier is insufficient, evaluate Polygon.io paid plan for real-time intraday data.

4. **CDBA Phase 1 (H2 2027):** When Canada's Consumer-Driven Banking APIs go live, evaluate migrating Plaid bank connections to CDBA-accredited providers for improved stability, standardized data schema, and potentially lower cost. The `BankSyncProvider` abstraction makes this a contained change. The screen-scraping ban will also be activated once CDBA is operational — Plaid's OAuth-based RBC connection is compliant; Scotiabank and Tangerine connections may need to migrate.

5. **Twelve Data MCP reliability:** Monitor for API endpoint changes or free tier quota exhaustion. If free tier (800 calls/day) is consistently exceeded, upgrade to Grow plan ($29/month). If the service has an outage, advisory sessions degrade gracefully — Claude can still advise from portfolio snapshot and transaction data without live indicators.

---

## 12. What Is Not In Scope (This Version)

- Automated trade execution (read-only advisory only)
- Push notifications (in-app alerts only; revisit with Expo Notifications when real users exist)
- Email notifications
- Multi-currency support (CAD primary; USD holdings displayed in CAD at sync-time exchange rate from SnapTrade)
- Tax reporting or T5/T3 generation
- Bill payment or e-transfer initiation
- Budget sharing or household multi-user budgeting (single financial household assumed)
- Custom domain (configured at build time; no architectural impact)

---

*All decisions in this spec are locked and were reached through grilling and research sessions documented in `wayfinder/tickets/` and `wayfinder/research/`. No further planning decisions are required before building.*
