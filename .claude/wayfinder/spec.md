# Finance Intelligence Dashboard — Buildable Spec

**Date:** 2026-07-18 (remediation decisions folded in — supersedes the 2026-07-16 revision)
**Status:** Build-ready at the decision level. Reopened 2026-07-17 after a frontend↔backend contract scan; every item found (and every original ticket decision) was then re-derived, decided, and cross-reviewed as a set in `.claude/wayfinder/remediation-decisions-2026-07-18.md`, and this document now reflects those decisions. That log remains the decision-history record; this spec is the buildable source of truth. **Nothing in this spec is implemented beyond what `.claude/CLAUDE.md` explicitly lists as built** — implementation is gated on the standing rule at the top of `.claude/CLAUDE.md`.

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
│   (Vercel, free)    │                │ (Railway, ~$15-25/mo)│
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
| Auth | Better Auth (self-hosted) + `@better-auth/expo` | Server plugin + `expoClient({scheme, storage: SecureStore})` on the client — one backend serves Expo web (cookies) and native (SecureStore-mimicked cookies). Requires `trustedOrigins: ["finance-dashboard://"]`. CORS: credentialed explicit-origin allowlist (Vercel prod + preview + localhost), never wildcard — native needs no CORS |
| Database | Turso (SQLite) + Drizzle ORM | Free tier; migrate to Neon (Postgres) at scale via Drizzle dialect swap |
| LLM | Vercel AI SDK v7 (`ai@7`, `@ai-sdk/anthropic@4`) | `streamText` + `toUIMessageStreamResponse()`; frontend consumes via `@ai-sdk/react` (`useChat`), no hand-rolled stream parsing. MCP client via separate `@ai-sdk/mcp` package. Nightly batch job uses raw `@anthropic-ai/sdk` (AI SDK has no batch support). ESM-only, requires Node.js 22+ |
| UI | NativeWind (Tailwind for React Native) | Consistent styling across web and mobile |
| Data fetching | TanStack Query (`refetchInterval`) | Polling-based real-time; no WebSocket infrastructure |
| Scheduled jobs | Railway cron | Background sync, daily portfolio refresh |
| Wealthsimple | SnapTrade API | OAuth per-user, ToS-compliant, free tier ($0 for ≤5 connections) |
| Banks | Plaid (Trial plan) | Free, self-serve, all 6 accounts confirmed |
| Market data | `yahoo-finance2@3.x` (`new YahooFinance()`, one shared instance) | v2.14.0 is a gutted transitional release (no `chart()`) — do not use. Alpha Vantage free tier as documented fallback |
| Charts | Lightweight Charts v5 + deepentropy | 446+ indicators; Apache 2.0 licensed; self-hosted. Native Android: chart canvas only inside `react-native-webview` (bundled static asset, `postMessage` data flow); web: direct render. All non-chart UI stays native/NativeWind |
| Price alerts | `node-cron@4` + `yahoo-finance2` batch `quote(string[])` | In-process poller registered via `instrumentation.ts`, 5-min intervals. Correctness gate is per-symbol `marketState` from the quote response itself (covers NYSE/NASDAQ/TSX/index symbols, holidays, half-days); Mon–Fri ~4:00–20:00 ET cron window is a cost skip only. No market-calendar dependency |
| TradingView alerts | Webhook → Railway endpoint | Best-effort delivery; stored in Turso; optional enhancement for paid TradingView users. Authenticated via per-user hashed secret in `webhook_credentials`, not an env var |
| Indicator data (MCP) | `twelvedata/mcp`, **self-hosted** as a second Railway service | HTTP transport, public URL + bearer auth. Chat path connects client-side via `@ai-sdk/mcp`; nightly batch path connects via Anthropic's server-side `mcp_servers` connector. Free tier 800 credits/day, 8 calls/min |

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
- Google OAuth tokens (spreadsheet import — persist while a live Google Sheets connection exists; deleted when the user disconnects or used a one-time CSV/import instead)
- Microsoft identity platform tokens (live Excel/OneDrive import connections, same lifecycle as Google)
- TradingView webhook secrets are stored hashed in `webhook_credentials` (the plaintext arrives in each webhook body for comparison; never stored)

**Better Auth `encryptOAuthTokens` note:** Better Auth v1.5 introduced `encryptOAuthTokens: true` as a configuration option that encrypts OAuth tokens before database storage natively. This covers tokens Better Auth manages directly (Google OAuth during the import flow). Plaid `access_token` and SnapTrade auth tokens are not managed by Better Auth's OAuth layer and require manual AES-256 encryption as described above. Evaluate at build time whether the `encryptOAuthTokens` option can handle Google OAuth tokens, reducing custom encryption code to Plaid and SnapTrade only.

### HTTPS
Enforced everywhere. Railway and Vercel both provide HTTPS automatically. No configuration required.

### Session Model
Better Auth handles sessions. Session tokens stored in Turso per user. Sessions expire per Better Auth defaults. Cross-platform mechanism: `@better-auth/expo` server plugin + `@better-auth/expo/client` with `expoClient({scheme: "finance-dashboard", storage: SecureStore})` — web uses normal browser cookies; native mimics cookies via SecureStore. `trustedOrigins: ["finance-dashboard://"]` required server-side. No hand-rolled Bearer headers.

### Multi-User Security Model
Each user's data is isolated by `user_id` on every Turso table. No query ever runs without a `WHERE user_id = ?` clause. LLM context is assembled per-user at request time — no cross-user data exposure at any layer. Claude has no persistent memory between sessions; each advisory session is stateless beyond what the app explicitly injects.

---

## 4. Database Schema

All tables use Drizzle ORM with Turso (LibSQL) dialect. IDs are UUIDs generated at the application layer.

### `user` / `session` / `account` / `verification`
Owned and generated by Better Auth (`npx @better-auth/cli generate`) — not hand-edited. All app tables FK into `user.id`. No app columns are added to these four tables; app-level per-user data lives in app tables (see `webhook_credentials`).

### `bank_connections`
```
id                   TEXT PRIMARY KEY
user_id              TEXT NOT NULL REFERENCES user(id)
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
user_id           TEXT NOT NULL REFERENCES user(id)
connection_id     TEXT REFERENCES bank_connections(id)   -- NULL for type = "manual"
plaid_account_id  TEXT UNIQUE                            -- NULL for type = "manual"
name              TEXT NOT NULL
type              TEXT NOT NULL  -- "chequing" | "savings" | "credit" | "manual"
mask              TEXT           -- last 4 digits
institution       TEXT NOT NULL
balance_available REAL           -- Plaid /accounts/get balances.available; current value, overwritten each sync
balance_current   REAL           -- balances.current
balance_limit     REAL           -- balances.limit (credit accounts)
iso_currency_code TEXT           -- balances.iso_currency_code
```
`type = "manual"` is the synthetic account representing spreadsheet/CSV-sourced data for users with no linked bank — created automatically on first import so the transaction feed, budget math, and categorization work identically regardless of source. Balance history lives in `bank_balance_snapshots` (append-only), not here.

### `transactions`
```
id                   TEXT PRIMARY KEY
user_id              TEXT NOT NULL REFERENCES user(id)
account_id           TEXT NOT NULL REFERENCES bank_accounts(id)
plaid_transaction_id TEXT UNIQUE    -- NULL for imported/manual rows
date                 TEXT NOT NULL  -- ISO 8601 YYYY-MM-DD (posted date)
authorized_date      TEXT           -- Plaid authorized_date (vs posted)
description          TEXT NOT NULL  -- raw bank description
merchant_name        TEXT           -- cleaned by categorization engine
merchant_logo_url    TEXT           -- Plaid merchant enrichment
merchant_website     TEXT           -- Plaid merchant enrichment
amount               REAL NOT NULL  -- negative = debit, positive = credit
iso_currency_code    TEXT
category             TEXT           -- envelope name assigned (app's own engine)
pf_category_primary  TEXT           -- Plaid personal_finance_category.primary (second signal, cross-check)
pf_category_detailed TEXT           -- Plaid personal_finance_category.detailed
payment_channel      TEXT           -- "online" | "in store" | "other"
location             TEXT           -- JSON: Plaid location object (address/city/lat/lon)
pending              INTEGER NOT NULL DEFAULT 0  -- boolean
created_at           INTEGER NOT NULL
```
Transactions are append-only. Never deleted. Corrections update `category` and `merchant_name` only. The Plaid-enrichment columns (`authorized_date`, `merchant_logo_url`, `merchant_website`, `iso_currency_code`, `pf_category_*`, `payment_channel`, `location`) are all free fields already present in the `/transactions/sync` response — captured per the capture-now rule; all NULL for imported rows.

### `budget_envelopes`
```
id                TEXT PRIMARY KEY
user_id           TEXT NOT NULL REFERENCES user(id)
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
user_id       TEXT NOT NULL REFERENCES user(id)
envelope_id   TEXT NOT NULL REFERENCES budget_envelopes(id)
year          INTEGER NOT NULL
month         INTEGER NOT NULL  -- 1-12
allocated     REAL NOT NULL     -- may differ from envelope monthly_target after reallocation
UNIQUE(envelope_id, year, month)
```

### `wealthsimple_connections`
```
id                      TEXT PRIMARY KEY
user_id                 TEXT NOT NULL REFERENCES user(id)
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
user_id         TEXT NOT NULL REFERENCES user(id)
snapshot_at     INTEGER NOT NULL  -- Unix timestamp
total_value     REAL NOT NULL
cash_value      REAL NOT NULL
accounts        TEXT NOT NULL  -- JSON: { tfsa: number, rrsp: number, non_reg: number, crypto: number }
created_at      INTEGER NOT NULL
```

### `holdings`
```
id              TEXT PRIMARY KEY
user_id         TEXT NOT NULL REFERENCES user(id)
snapshot_id     TEXT NOT NULL REFERENCES portfolio_snapshots(id)
ticker          TEXT NOT NULL
name            TEXT NOT NULL
quantity        REAL NOT NULL
cost_basis      REAL NOT NULL   -- per share
market_value    REAL NOT NULL   -- total position value at snapshot time
open_pnl        REAL            -- broker-computed unrealized P&L from SnapTrade Position.open_pnl;
                                -- stored alongside (not replacing) the app's own marketValue − costBasis × qty
account_type    TEXT NOT NULL   -- "tfsa" | "rrsp" | "non_reg" | "crypto"
created_at      INTEGER NOT NULL
```

### `portfolio_transactions`
```
id              TEXT PRIMARY KEY
user_id         TEXT NOT NULL REFERENCES user(id)
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
user_id              TEXT NOT NULL REFERENCES user(id)
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
user_id              TEXT NOT NULL REFERENCES user(id)
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
user_id         TEXT NOT NULL REFERENCES user(id)
ticker          TEXT NOT NULL
condition_text  TEXT NOT NULL
price           REAL
interval        TEXT
raw_payload     TEXT NOT NULL  -- JSON: full webhook body
received_at     INTEGER NOT NULL
read_at         INTEGER        -- NULL until user marks read (mirrors alert_fires.read_at)
analyzed_at     INTEGER        -- NULL until user triggers LLM analysis — a different fact than read_at
```
Raw TradingView webhook event log — append-only, immutable. Separate from `price_alerts` (which is a standing monitoring instruction). **The unified Alerts feed is delivered at the API layer:** `/api/alerts` queries `alert_fires` (native) and this table (TradingView) and normalizes both into one response shape. TradingView rows are never inserted into `alert_fires` — three of its NOT NULL columns (`alert_id`, `threshold`, `trigger_price`) are structurally impossible for a webhook event, and nullable-ifying them would silently break the dedup guard (SQLite unique indexes treat NULLs as distinct). `alert_fires.source` is retained but always `"native"` in practice.

### `llm_analysis_cache`
```
id               TEXT PRIMARY KEY
user_id          TEXT NOT NULL REFERENCES user(id)
view             TEXT NOT NULL   -- "budget" | "portfolio"
last_analyzed_at INTEGER NOT NULL
output           TEXT NOT NULL   -- JSON: array of card objects
created_at       INTEGER NOT NULL
UNIQUE(user_id, view)
```
On re-analysis, the existing row is overwritten (upsert). This is the exception to append-only — analysis output is always the latest.

### `job_runs`
Generalized observability spine — every background execution writes a row. Replaces the old `import_jobs` table (dropped in the culmination migration; it was schema-only with zero writers — import history is `job_runs` filtered by type).
```
id              TEXT PRIMARY KEY
user_id         TEXT REFERENCES user(id)   -- NULL for system-wide jobs (alert poll)
job_type        TEXT NOT NULL   -- "plaid_sync" | "snaptrade_sync" | "alert_poll" | "nightly_batch"
                                -- | "import_csv" | "import_google_sheets" | "import_excel"
                                -- | "tradingview_webhook" | "graph_subscription_renewal"
status          TEXT NOT NULL   -- "running" | "complete" | "failed"
started_at      INTEGER NOT NULL
finished_at     INTEGER
error_message   TEXT
metadata        TEXT            -- JSON: capture every data point available per run (rule: trim later,
                                -- can't backfill) — tickers polled, alerts fired, rows synced/imported,
                                -- tokens used, batch IDs, etc.
```

### `bank_balance_snapshots`
Append-only balance history — the banking-side analog of `portfolio_snapshots`. Powers net-worth-over-time (§9 Reports). One row per account per daily sync. Cannot be backfilled; capture starts day one. Manual/CSV accounts have no balances and never appear here.
```
id                TEXT PRIMARY KEY
account_id        TEXT NOT NULL REFERENCES bank_accounts(id)
user_id           TEXT NOT NULL REFERENCES user(id)
balance_available REAL
balance_current   REAL
balance_limit     REAL
iso_currency_code TEXT
captured_at       INTEGER NOT NULL
```

### `webhook_credentials`
Per-user webhook secrets — the secret itself is the user identity for unauthenticated inbound webhooks (TradingView sends it in the request body). Replaces the `TRADINGVIEW_WEBHOOK_SECRET` env var and the `DEFAULT_USER` hardcode; multi-user needs zero redesign.
```
id           TEXT PRIMARY KEY
user_id      TEXT NOT NULL REFERENCES user(id)
service      TEXT NOT NULL   -- "tradingview"
secret_hash  TEXT NOT NULL   -- hash of the shared secret; plaintext arrives per-request, never stored
created_at   INTEGER NOT NULL
last_used_at INTEGER
```

### `ohlcv_cache`
Durable OHLCV persistence in Turso — replaces the in-memory-only Map the code previously used (the route's comment claimed Turso caching that never existed). Yahoo's community library is an accepted fragility risk; historical price data that isn't durably stored is one breakage away from unrecoverable.
```
ticker      TEXT NOT NULL
range       TEXT NOT NULL      -- "1mo" | "3mo" | "6mo" | "1y" | "2y" | "5y"
bars        TEXT NOT NULL      -- JSON: OHLCV bar array
fetched_at  INTEGER NOT NULL
PRIMARY KEY (ticker, range)
```

---

## 5. Data Integrations

### 5.1 Plaid — Bank Transactions

**Accounts:** RBC Visa, RBC chequing (one Plaid Item), Tangerine Mastercard + 2 Tangerine accounts (one Item), Scotiabank chequing (one Item). ~3 Items total — within Plaid Trial plan free tier (10 Items max).

**Connection mechanism: Plaid Hosted Link** (raw WebView embedding of Link is Plaid's own deprecated path — do not use). No native Plaid SDK, no custom EAS dev client; stays in Expo Go.

**Connection flow:**
1. Backend: `POST /link/token/create` with `country_codes: ['CA']`, `products: ['transactions']`, `client_user_id`, and `hosted_link` config → response includes `hosted_link_url`
2. Frontend: open `hosted_link_url` via `expo-web-browser`'s `openAuthSessionAsync` (wraps `ASWebAuthenticationSession` on iOS / Custom Tabs on Android)
3. **Two distinct redirect URIs — do not conflate:** `completion_redirect_uri` (Hosted Link's own "session done" signal back into the app — custom scheme, e.g. `finance-dashboard://plaid-hosted-link-complete`) vs. `redirect_uri` (RBC's OAuth handoff only; must be a registered frontend page URL — see §10 Deployment Checklist). Whether `redirect_uri` may itself be a custom scheme was not confirmed during planning — **pin down against Plaid's docs at implementation time**; an unregistered value breaks Link for every institution, not just RBC.
4. Frontend: receives `public_token` on completion
5. Backend: exchange for `access_token` + `item_id` via `POST /item/public_token/exchange`
6. Store `access_token` AES-256 encrypted in `bank_connections`

**Onboarding wizard:** the 4 initial connections (RBC, Tangerine, Scotiabank via Plaid; Wealthsimple via SnapTrade) are chained into one continuous "Connect your accounts" wizard with a graphical step indicator — auto-advances after each browser session returns. Each institution still requires its own browser handoff underneath; the wizard packages that into one sitting. Also reachable later from the Banks tab's "+ Add account" (primary entry) and Settings.

**Sync:**
- Use `/transactions/sync` (not deprecated `/transactions/get`) — persist the full free field set (§4 `transactions`: `authorized_date`, `personal_finance_category`, `payment_channel`, `location`, merchant logo/website, `iso_currency_code`)
- `/accounts/get` (already called per sync): write current balances to `bank_accounts` AND append a row per account to `bank_balance_snapshots`
- Listen for `SYNC_UPDATES_AVAILABLE` and `ITEM_LOGIN_REQUIRED` webhooks
- On `ITEM_LOGIN_REQUIRED`: set `bank_connections.status = 'relink_required'`; surface via the small badge/dot on the **Settings tab icon** (reuses the `AlertsBadge` pattern — rare event, so no persistent cross-screen banner); the per-connection status row in Settings → Connected Accounts is the destination
- Transactions appended to `transactions` table; never deleted
- Every sync writes a `job_runs` row

**Tangerine known issue:** Open MFA bug — MFA is invalidated shortly after initial connection. Background sync fails regularly. When `ITEM_LOGIN_REQUIRED` fires for a Tangerine Item, the app surfaces: *"Tangerine connection needs attention — tap to reconnect."* User re-runs Plaid Link in update mode. This is a known Plaid/Tangerine issue with no resolution timeline. Expected frequency: potentially weekly. Build the relink flow robustly.

**Tangerine transaction lag:** Even with a healthy Tangerine connection, transaction data may be 5–9 days delayed. This is a Tangerine-side limitation, not an aggregator bug. Surface this in the Tangerine connection status row in Settings: *"Tangerine transactions may take up to 9 days to appear."*

**Scotiabank connection stability:** Plaid's Scotiabank connection is credential/scraping-based (no formal bank API deal as of 2026). Estimated 2–4 auth breaks per year when Scotiabank changes their web UI or auth flows. The `ITEM_LOGIN_REQUIRED` webhook handles this identically to Tangerine relinks. Reliability: MEDIUM.

**Data enrichment:** Plaid's Canadian merchant enrichment is weaker than US. Raw `description` field from the bank is the reliable signal. The app's own categorization engine (§6) does the cleanup.

### 5.2 SnapTrade — Wealthsimple Portfolio

**Connection flow:**
1. Create SnapTrade user: `POST /api/v1/snapTrade/users` with internal `user_id`
2. Generate connection link: `loginSnapTradeUser()` **with `customRedirect` set to point back into the app** (consistent with the wizard's `openAuthSessionAsync` return mechanism — without it the user finishes Wealthsimple OAuth stranded on a SnapTrade default page)
3. User authenticates with Wealthsimple via SnapTrade's hosted portal (browser session, same handoff pattern as Plaid Hosted Link)
4. Store `snaptrade_user_id` and `snaptrade_auth_token` (encrypted) in `wealthsimple_connections`

**Sync (daily 2am + on-demand):**
1. Fetch all accounts: `GET /api/v1/accounts`
2. Fetch holdings per account: `GET /api/v1/accounts/{accountId}/holdings` — persist `Position.open_pnl` (broker-computed unrealized P&L) alongside the app's own calculation
3. Fetch recent transactions: `GET /api/v1/accounts/{accountId}/activities`
4. Write new `portfolio_snapshots` row (append — never overwrite)
5. Write `holdings` rows linked to that snapshot
6. Append new `portfolio_transactions`
7. Update `wealthsimple_connections.last_synced_at`

**On auth failure:** Set `wealthsimple_connections.status = 'reconnect_required'`; surface via the Settings tab-icon badge (same mechanism as Plaid relinks — §5.1). User re-runs the SnapTrade browser flow.

**Cost:** SnapTrade free tier covers ≤5 connections at $0. Scale path: pay-as-you-go at $1.50/connected user/month + $0.05/manual sync → custom plan at volume.

### 5.3 Yahoo Finance — Market Data

Used exclusively to feed OHLCV data into Lightweight Charts. Not used for portfolio valuation (SnapTrade provides that at sync time).

**Implementation:** `yahoo-finance2@3.x` — instantiate once (`new YahooFinance()`) and share the instance between the OHLCV route and the alert poller. **Do not use the 2.x line:** 2.14.0 (what `^2.13.0` resolves to) is a gutted transitional release with only `quote`/`autoc` — no `chart()` at all. Fetch on chart load for the requested ticker and time range. Cache responses in the `ohlcv_cache` Turso table for 24 hours (durable — survives Railway restarts; §4).

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
The endpoint hashes the incoming `secret` and looks it up in `webhook_credentials` — the matching row identifies the owning user (no env var, no hardcoded user ID; multi-user works day one). No match → 403.

**Processing:** Validate → write to `tradingview_alerts` (attributed to the resolved user) + a `job_runs` row → return 200 within 3 seconds (TradingView drops after 3s, including DNS resolution time). Do not process synchronously — write and return immediately.

**Delivery constraints:** No retries, no delivery guarantee, 15 alerts per 3-minute rate limit. Missed alerts are accepted. Do not use for time-critical automated actions.

**TradingView plan requirement:** Webhooks are not available on the TradingView Free plan. At minimum, the Essential plan is required. The Premium plan is recommended for production use — it includes 800 active alerts with no expiry vs. Essential's 20 alerts with ~60-day expiry. HTTP 4xx responses and timeouts are silently dropped with no retry; only HTTP 5xx triggers up to 3 retries at 5-second intervals.

**UI:** Alerts tab shows chronological feed. Badge count for unread. Tap → detail view with "Analyze with Claude" button.

### 5.5 Twelve Data MCP Server — Live Indicator Data

**Project:** [`twelvedata/mcp`](https://github.com/twelvedata/mcp) — the official vendor-maintained, open-source MCP server from Twelve Data. Exposes 130+ technical indicators including RSI, MACD, MA20, MA50, volume analysis, and technical summary via HTTP transport. **Self-hosted as a second Railway service** (Dockerfile provided; Python 3.10+; uses this project's own `TWELVE_DATA_API_KEY`) — the underlying Twelve Data API has a 99.95% SLA and long track record, but the vendor's *own hosting of the MCP wrapper* (`mcp.twelvedata.com`) has no published reliability history; self-hosting removes that unproven layer at the same cost. The service gets a **public URL + bearer auth** (not Railway-internal-only) because the nightly batch path requires Anthropic's servers to reach it (see Setup).

**Why not the alternatives:**
- `tradesdontlie/tradingview-mcp`: development-time tool only; connects to TradingView Desktop locally via Chrome DevTools Protocol; cannot be deployed as a server.
- `atilaahmettaner/tradingview-mcp`: core dependency (`python-tradingview-ta`) archived June 2024; hits unofficial TradingView scanner endpoints that return 403 from cloud IPs (confirmed on Railway-equivalent infrastructure).

**Setup — two connection styles to the same service:**
- **Chat / synchronous path:** `@ai-sdk/mcp` client (MCP support moved out of core `ai` in v7), connected **persistently at module level** — this backend is a persistent Railway process, not serverless; connect once at startup, reuse across requests.
- **Nightly batch path:** Anthropic's server-side `mcp_servers` connector in each batch request (raw `@anthropic-ai/sdk`) — client-executed tool loops are impossible inside a batch item, but Anthropic's batch worker runs server tools (web search, MCP connector) in its own agentic loop.

**Usage:** Claude calls it when it needs technical context on a holding — e.g., "let me check the current RSI on AAPL before recommending a position change." Claude decides when to invoke it; user can also explicitly ask for technical analysis.

**Cost:** Free tier: 800 API calls/day — sufficient for solo use (estimated 20–40 calls/day at normal advisory usage). Grow plan: $29/month for higher volume. Upgrade triggered when multi-user scale pushes past free tier.

**Indicator accuracy:** Twelve Data computes indicators server-side using industry-standard calculation methods consistent with TradingView's own readings. No divergence risk between app indicator values and what the user sees on TradingView charts.

### 5.6 Native Price Alert System

**Architecture:** In-process `node-cron@4` scheduler registered once at server startup via Next.js `instrumentation.ts` `register()` inside the existing Railway persistent Node.js process. No separate service required at MVP. Zero cost delta.

**Polling window:** Every 5 minutes, Mon–Fri ~4:00–20:00 ET (covers pre-market through post-market for `extended_hours` alerts). This window is a **cost optimization only** — the correctness gate is per-symbol `marketState` (below). No market-calendar dependency of any kind (the originally-cited `@sebspark/trading-hours` covers only European markets and has no `isTradingTime` API — verified and discarded).

**Market-state gate (correctness):** Yahoo's quote response carries `marketState` per symbol (`"REGULAR" | "CLOSED" | "PRE" | "POST" | …`). An alert's condition is evaluated only when its own symbol's market is open — `REGULAR`, or `PRE`/`POST` when the alert has `extended_hours = 1`. Per-symbol means NYSE, NASDAQ, TSX, and index symbols (`^GSPC`, `^IXIC`) each gate themselves — divergent US/Canadian holidays and half-days handled automatically, and it closes a false-refire bug where a recurring `pct_change` alert with a cooldown would re-fire against the prior session's stale change figure on a closed day.

**Data source:** `yahoo-finance2@3.x` batch `quote(string[])` — all distinct active-alert tickers in one HTTP request (the originally-cited `quoteCombine()` does not exist in the package; plain `quote()` batches natively, verified live across all target venues). Twelve Data REST `/price` endpoint as fallback on Yahoo 429 or persistent errors (note: Twelve Data free tier supports only ~8 poll cycles/day at 100 tickers — used as infrequent fallback only; upgrade to Twelve Data paid at ~150 users when Yahoo reliability pressures).

**Ticker deduplication:** One price fetch per distinct ticker per poll cycle, evaluated against all users' alerts for that ticker. At 100 users with 500 alerts across 100 tickers: 100 price fetches, not 500.

**Poll cycle (pseudocode):**
```
1. window check (Mon–Fri, ~4:00–20:00 ET) → exit outside window
2. mutex check → exit if previous cycle still running
3. SELECT DISTINCT ticker FROM price_alerts WHERE status = 'active' AND (next_check_at IS NULL OR next_check_at <= now())
4. quote([...tickers]) → in-memory price map incl. marketState per symbol
5. Write prices to price_cache (last-known-good)
6. SELECT * FROM price_alerts WHERE status = 'active' AND ticker IN (fetched tickers)
7. For each alert: skip unless symbol marketState permits (REGULAR, or PRE/POST for extended_hours alerts);
   evaluate condition against price map
8. On match: INSERT alert_fires (with firedAtBucket deduplication), UPDATE price_alerts.status = 'triggered', UPDATE price_alerts.last_triggered_at
9. write job_runs row (tickers polled, alerts evaluated/fired), release mutex
```

**Alert creation & management (API + UI):**
- `POST /api/alerts` — create a `price_alerts` row. Accepts **arbitrary symbols, not just holdings** (`holding_id` nullable; index alerts like `^GSPC` are first-class).
- `PATCH /api/alerts/:id` — pause, edit, or re-arm a one-time-fired alert.
- `DELETE /api/alerts/:id`.
- UI entry points: **"Set alert"** on the Holding Detail screen (primary — user is looking at the chart deciding levels) and **"Manage alerts"** on the Alerts tab (lists standing `price_alerts` — distinct from the fires feed — with re-arm/pause, plus new-alert creation with symbol search for non-held tickers).
- Implementation-time decision (recorded, not made): whether an alert whose condition is already true at creation fires on the first poll or requires a crossing.

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

**Relationship to TradingView alerts:** `price_alerts` (standing monitoring instruction) and `tradingview_alerts` (raw webhook event log) remain separate tables. **One feed, two sources — unified at the API layer:** `/api/alerts` queries `alert_fires` (native) + `tradingview_alerts` (webhook log) and normalizes both into one response shape (`id, source, ticker, condition label, price, timestamp, severity, unread, analyzed_at`); TradingView rows never enter `alert_fires` (see §4 `tradingview_alerts` note). Mark-as-read: `PATCH /api/alerts/:id/read` routes to the correct table's `read_at` by the item's `source`. Users on TradingView Free plan get full alert functionality via native polling; TradingView webhooks are an optional enhancement for paid-plan users who want Pine Script-driven conditions.

**Scale path:**
- 0–50 users: in-process node-cron, Yahoo Finance, $0 delta
- 50–150 users: add request backoff + Twelve Data paid fallback ($29/mo)
- 150–500 users: move poller to separate Railway worker service; Twelve Data as primary ($79/mo)
- 500+: Postgres migration, BullMQ, WebSocket data feed — significant revision

### 5.7 Spreadsheet Import Pipeline

**This is a per-user onboarding feature, not a one-time admin action** — anyone migrating off Excel/Sheets does this at their own signup time, indefinitely. (An earlier CLI-script design was retired for exactly this reason — recorded so it isn't revived.)

**Three parallel, user-selectable paths** — a real scope increase over one generic mechanism, taken deliberately because manual re-export on every edit is unacceptable friction for someone using their spreadsheet as an ongoing source of truth:
- `CsvAdapter` — parses uploaded CSV; maps columns via a user-configured mapping UI. Covers both Google Sheets and Excel exports with zero OAuth trust/consent friction — first-class for one-time historical dumps, not a compromise.
- `GoogleSheetsAdapter` — Sheets API + OAuth 2.0 (`googleapis`); live connection with ongoing sync. Two known risks designed around, not just accepted: **(a)** always pass `expiry_date` alongside `access_token`/`refresh_token` in `setCredentials` — auto-refresh does not reliably trigger without it (googleapis/google-api-nodejs-client #2350); **(b)** the OAuth consent screen must be **Published** (not Testing) or refresh tokens die after 7 days (see §10 Deployment Checklist).
- `ExcelAdapter` — Microsoft Graph API (Excel workbook endpoints) + Microsoft identity platform OAuth; live connection. Two Graph-specific realities: **(a)** OneDrive change-notification subscriptions are **folder-level, not file-level** — subscribe to the containing folder and filter per notification; **(b)** subscriptions expire and need periodic renewal (a `graph_subscription_renewal` cron job — Microsoft's analog of the refresh-token lifecycle).

All adapters normalize into the same internal format before writing to Turso. Users with zero linked banks get a synthetic `bank_accounts` row with `type = "manual"` created on first import (§4) so the entire app works identically regardless of data source.

**Onboarding flow:** After connecting bank accounts, app prompts: "Import historical data? (CSV / Google Sheets / Excel / Skip)". Can also be triggered later from Settings → "Import historical data" (a picker across the three paths). Import status tracked in `job_runs` (types `import_csv` / `import_google_sheets` / `import_excel`).

**Deduplication:** On import, check `plaid_transaction_id` uniqueness. For imported rows (no Plaid ID), fingerprint `(date, description, amount)` and skip already-imported matches — re-exports realistically contain the full history each time. Flag ambiguous conflicts for user review rather than silently dropping.

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

**Nightly batch analysis:** Immediately after the 2am sync completes, submit Budget and Portfolio auto-card generation to Anthropic's Batch API (50% off standard token pricing — see §8 Token Budget). **Wiring:** the batch job uses the raw `@anthropic-ai/sdk` (the AI SDK has no batch support), declaring the web search server tool and the `mcp_servers` connector pointing at the self-hosted Twelve Data MCP service — Anthropic's batch worker runs the full server-side agentic loop, so batch-generated cards get the same tool access as chat (§8 Tool Use). A Railway job polls batch status and writes results to `llm_analysis_cache` on completion (typically minutes, up to 24h worst case per Batch API SLA). This means cards are usually already pre-generated by the time the user opens the app. On-demand conversations and alert-triggered analysis are unaffected — they always run synchronously via `streamText`, never through the Batch API.

**In-process cron inventory** (all `node-cron@4` via `instrumentation.ts`, all writing `job_runs` rows): alert poller (§5.6, 5-min), 2am sync + batch submit, batch status poller, Microsoft Graph subscription renewal (§5.7), `job_runs` pruning (policy at implementation).

### LLM Trigger
On page load for Budget and Portfolio views:
- If `last_synced_at` > `last_analyzed_at` → new data exists since last analysis → auto-run LLM, cache result in `llm_analysis_cache`
- If `last_analyzed_at` ≥ `last_synced_at` → nothing new → serve cached cards instantly with "Analyzed X ago" timestamp

In normal operation this synchronous path rarely fires — the nightly Batch API job (see Background sync, above) already pre-generates cards before the user opens the app. It fires as a fallback when the user syncs intraday and new data is returned (pull-to-refresh), or opens the app before that day's batch job has completed.

LLM **never** runs on sync itself. LLM **never** runs on pull-to-refresh unless new data was returned.

**Re-analyze button:** Always visible. Forces fresh LLM run regardless of staleness state. Subject to 2-minute debounce.

---

## 8. LLM Advisory Engine

### Model
Claude via Vercel AI SDK v7 (`ai@7` + `@ai-sdk/anthropic@4`) — `streamText` with `toUIMessageStreamResponse()` on the backend; the frontend consumes streams via `@ai-sdk/react` (`useChat` or equivalent), never hand-parsed wire bytes. Model-agnostic — switching Claude model versions requires changing one constant. Anthropic is the provider at launch. (v7 breaking changes verified against installed type defs: `maxTokens` → `maxOutputTokens`, `toDataStreamResponse()` removed, MCP client moved to `@ai-sdk/mcp`.)

### Trigger Model (detail)
- **Auto-generated cards** (Budget/Portfolio page load with new data): normally pre-generated nightly via the Batch API (see §7 Staleness Model, Nightly batch analysis) before the user opens the app. Synchronous fallback uses the same batch-render approach — Claude generates all cards, app parses structured output, renders fully-formed cards simultaneously, no streaming animation — at standard (non-Batch) pricing.
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

DATA FRESHNESS:
- Tangerine transactions may lag 5–9 days behind real-time even on a healthy connection (Plaid/Tangerine limitation, not a sync failure — see §5.1).
- Do not make high-confidence claims about current-week or "this month so far" spending for Tangerine-linked envelopes without noting that recent Tangerine data may be incomplete. Prefer trend language ("running below target through last week's data") over point-in-time precision for those envelopes.
- RBC and Scotiabank data does not carry this caveat.

PRIVACY: This context is private to this user. Never reference other users or general population data.

DATA CONTEXT:
[Injected at request time: current date, last sync timestamps, view-specific data]
```

User-configurable preferences (risk posture, savings goals, investment time horizon) are stored in Turso and appended to the system prompt at request time.

### Tool Use
- **Web search:** Anthropic's native provider-executed tool — `anthropic.tools.webSearch_20260209()` (use the current dated version, not the older `webSearch_20250305`). Anthropic's servers do the searching, billed through the same API call — no separate search vendor or infrastructure. Used for external context (interest rates, earnings news, macro events, ticker-specific news); user can also explicitly request. Results rendered inline.
- **Twelve Data MCP (`twelvedata/mcp`, self-hosted — §5.5):** Claude queries live indicator data (RSI, MACD, moving averages, volume) on any ticker. Chat path: persistent module-level `@ai-sdk/mcp` client. Batch path: `mcp_servers` connector (§7).
- **Availability scope — both tools, both paths, unrestricted:** auto-cards AND chat get full access. Deliberate UX-over-cost choice; the original ~$1–3/mo estimate assumed zero tool use and is superseded (see §11 post-launch review item).
- **Graceful degradation — precisely defined, not "fall back to web search":** MCP is the *sole* source of computed indicator numbers; web search is a separate tool for a separate purpose and stays available regardless. If the MCP service is unreachable, its tools are omitted from that call's tool list and the system prompt gains an explicit instruction (same pattern as the Tangerine staleness note) never to estimate or fabricate indicator values from any other source. The guarantee is that no approximated number is ever produced — not that a fallback is disguised as the real thing.
- **Rate-limit design:** free tier is 800 credits/day AND 8 calls/min — the per-minute cap is the realistic risk with an LLM autonomously deciding when to call. App-level conservative cap on indicator lookups per session (specific number at implementation).

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
- Expected monthly cost: ~$1–3 for normal single-user usage **with zero tool use — superseded**: unrestricted web search + MCP on both paths (§8 Tool Use) raises this by a currently-unestimated amount, accepted deliberately; re-measured at the §11 item-7 post-launch review
- **Batch API:** The nightly auto-card generation job (§7, Nightly batch analysis) runs at 50% off standard input/output pricing via Anthropic's Batch API. On-demand conversations and alert-triggered analysis remain synchronous at standard pricing — the discount applies only to the pre-generation job, which is the majority of total session volume for a single daily-active user.
- No hard limits set. Revisit if multi-user deployment changes usage patterns significantly.

---

## 9. UI Structure

### Theme
Dark background (#13111C), purple/blue gradient accents (#7C3AED → #2563EB), glassmorphism cards (`rgba(255,255,255,0.05)` background + `rgba(255,255,255,0.08)` border), Inter font. NativeWind utility classes implement this across web and mobile from a single class system.

Reference: `wayfinder/prototype/ui-prototype.html` — Theme 3 (Gradient). **The prototype is a rough/early placeholder, explicitly not the final vision (user, 2026-07-18)** — treat as historical reference. Governing principle: structural/data decisions are locked now; visual/layout polish is cheap to iterate post-baseline and deliberately under-specified here.

### Navigation
Bottom tab bar. 5 tabs:

| Tab | Icon | Badge |
|---|---|---|
| Budget | 💰 | — |
| Banks | 🏦 | — |
| Portfolio | 📈 | — |
| Alerts | 🔔 | Unread alert count |
| Settings | ⚙️ | Dot when any connection has status `relink_required`/`reconnect_required` |

Active tab label uses the gradient accent color. Inactive tabs use `rgba(248,250,252,0.35)`.

### Budget Screen

1. **Header:** "Budget" title with gradient text + **Reports icon** (→ Reports screen, shared with Portfolio)
2. **Month navigation:** `< July 2026 >` with net position (red if negative)
3. **Summary strip:** 3 glassmorphism stat cards — Spent / Remaining / Saved
4. **Envelope grid:** One card per active envelope showing name, spent/target, progress bar (gradient fill; red gradient if over)
5. **Notable transactions:** deterministic (non-LLM, free, always-current) surfacing, distinct from and complementary to the AI cards. Two signals: **(a)** category approaching/over its monthly cap (already computed in `/api/budget`'s envelope summaries); **(b)** a single transaction consuming ≥ **15%** of its own envelope's allocation (`abs(amount) / allocated ≥ 0.15` — percentage-of-own-envelope scales naturally by bucket size; 15% is a starting config constant, tuned after real usage). Rendering: one small card **per category** with notable transactions, each swipeable through that category's items, capped at **3 per category**. Tapping a transaction navigates to the Banks tab's per-account view, scrolled/highlighted to it — no separate transaction-detail screen.
6. **LLM bar:** "✦ Analyzed X ago" + Re-analyze button
7. **LLM cards:** Insight and action cards (see §8)
8. **Transaction feed:** Recent transactions with merchant name, category, amount — cross-account, budget-lens view (complementary to Banks' raw per-account browsing, not duplicative)
9. **Spending trend chart:** 12-month bar chart (one bar per month, colored by on/over budget). Rendered with Lightweight Charts or a simple canvas bar chart — no external data feed required (data is local).

Month navigation swipes or taps `< >` to move between periods. Swiping the screen left/right also navigates months.

### Banks Screen (new tab)

Primary account browsing and the primary "+ Add account" entry point (Settings remains the administrative/status view, not a duplicate).

1. **Account cards:** one per connected account (RBC Visa, RBC Chequing, Tangerine ×3, Scotiabank Chequing, manual/CSV account if used) — institution, masked account number, last-synced time, connection status, and **balance masked-by-default with tap-to-reveal toggle** (eye icon; the real number one tap away)
2. **"+ Add another account":** launches the same onboarding wizard as §5.1
3. **Card tap → per-account transaction history screen:** reuses the existing `TransactionFeed` component filtered to one `account_id` (every transaction already carries it). This screen is also the navigation target for Budget's notable transactions (scrolled/highlighted to the tapped transaction).

### Portfolio Screen

1. **Header addition:** **Reports icon** (→ Reports screen, shared with Budget)
2. **Ticker tape:** TradingView Ticker Tape widget — scrolling price strip across top
3. **Portfolio hero:** Total value, day change, all-time return percentage
4. **Portfolio value chart:** Lightweight Charts line chart. Data: `portfolio_snapshots.total_value` time-series from Turso. No external data required — this is your actual portfolio history.
5. **Holdings list:** One row per current holding — ticker, name, current value, unrealized P&L (colored; broker `open_pnl` stored alongside the app's own calc — display choice at implementation)
6. **LLM bar + cards:** Same pattern as Budget screen
7. **Economic Calendar widget:** TradingView Economic Calendar widget below cards (optional, collapsible)

Tapping a holding → **Holding Detail Screen** (see below).

### Holding Detail Screen

**Rendering mechanism (native Android):** only item 2 — the chart canvas — lives inside a `react-native-webview` loading a small bundled HTML/JS page (static app asset, not network-fetched) running Lightweight Charts + deepentropy. Everything else stays native/NativeWind (one theme source of truth, native accessibility, smallest WebView failure surface). Data flows in via `postMessage` (OHLCV bars, overlay markers, theme colors); indicator-chip taps happen on native chips and post a message in; WebView signals ready before native sends state. On Expo web the chart renders directly — no WebView. Expo DOM Components were evaluated and ruled out (Expo's own docs steer away from them for real-time charting).

1. **Header:** Ticker + company name + **"Set alert"** (→ pre-filled alert creation for this symbol — §5.6)
2. **Candlestick chart:** Lightweight Charts v5. Data from Yahoo Finance (OHLCV, via `ohlcv_cache`). Portfolio overlays:
   - Horizontal dashed line at cost basis price
   - Vertical marker at purchase date
   - Label: "X shares @ $Y.YY"
3. **Indicator bar:** Toggleable indicator chips — RSI, MACD, MA20, MA50. Rendered via deepentropy library below the main chart pane (native chips outside the WebView).
4. **Position summary:**
   - Cost basis (per share + total)
   - Current price + total market value
   - Unrealized P&L (amount + percentage, colored)
   - Account type badge: "TFSA — No capital gains on sale" / "Non-Reg — Capital gains apply"
5. **LLM context:** If the user navigated here from an alert, the alert condition is shown. "Analyze with Claude" button opens conversation bottom sheet.

### Alerts Screen

Feed shows the **unified feed** (§5.6 — native fires + TradingView events, normalized at the API).

1. **Header:** "Alerts" + unread count badge + **"Manage alerts"** entry (standing `price_alerts` list: re-arm one-time-fired alerts, pause, edit, delete, create new with symbol search — distinct from the fires feed)
2. **Unread section:** Alert cards — ticker, condition label, price, time ago, source, "Analyze with Claude →" link
3. **Earlier section:** Read alerts, same format, lower visual weight

Alert card tap → Holding Detail Screen for that ticker, with alert context pre-loaded and "Analyze with Claude" button prominent.

Alert severity dot color:
- Red: conditions suggesting risk or urgent attention (oversold, breakdown, stop-loss)
- Yellow: neutral signals (MA crossover, volume spike)
- Green: positive conditions (overbought, breakout, target reached)
TradingView fires: keyword classifier on the free-text condition. Native fires: direct mapping from `condition_type` (the classifier doesn't apply to enum conditions).

### Settings Screen

**Organization rule (user-stated):** top level is end-user surfaces only; ALL dev-related things live inside exactly one "Developer" entry.

1. **Connected Accounts section** (secondary status/administrative view — Banks tab owns primary browsing and "+ Add account"):
   - One row per connection (RBC, Tangerine, Scotiabank, Wealthsimple)
   - Status: "● Live" (green) or "⚠ Relink" (orange) — tapping Relink opens the reconnect flow
   - Last synced timestamp
2. **Preferences section:**
   - Risk posture (tap to change: Conservative / Defensive / Moderate / Aggressive)
   - Staleness threshold (default 15 min, configurable)
   - Background sync time (default 2:00 AM)
3. **Data section:**
   - Import historical data (picker: CSV / Google Sheets / Excel — §5.7)
   - Export data (future)
4. **System status section** (end-user trust signals, not logs):
   - Per-connection last successful sync
   - Alert engine heartbeat ("last checked N min ago" — must treat market-closed gaps as healthy, not stale)
   - Last nightly analysis run
   - Import history (`job_runs` filtered to import types)
5. **Developer entry** (single item, bottom; opens its own screen — no gating, single-user app):
   - Browsable `job_runs` feed, filterable by job type, with error detail
   - Raw TradingView webhook payloads (`tradingview_alerts.raw_payload`)
   - Reads the DB only — deep debugging stays in Railway's own log viewer (its API is deliberately not integrated)
6. **Account section:**
   - Sign out

### Reports Screen (shared destination)

Reached via the header icon on **both** Budget and Portfolio — one screen, not a sixth tab (five tabs is the ceiling; Settings stays administrative). All reports are **deterministic — no LLM** (the AI cards remain the commentary layer). Sections, net worth first:

1. **Net worth over time** — `bank_balance_snapshots` + `portfolio_snapshots`, one line. (History accumulates from launch day — neither source can be backfilled. Manual/CSV accounts carry no balances and are excluded.)
2. **Monthly spending report** — browsable by month: total spent, per-category spent vs. allocated, top merchants. (Months predating envelope allocations show spent-only.)
3. **Category trends** — per-category spend across the last N months
4. **Income vs. expenses** — inflows vs. outflows per month from the transaction stream
5. **Portfolio performance** — summary framing over the Portfolio tab's existing data; per-period returns addable later with no new data

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
| Backend | Railway | Starter ($5/mo min; ~$15-25/mo actual) | Next.js API, persistent Node.js, in-process cron jobs (§7) |
| Indicator MCP | Railway (second service) | Included in usage | Self-hosted `twelvedata/mcp` (Python/Docker); public URL + bearer auth (§5.5) |
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
PLAID_REDIRECT_URI     -- Optional. RBC OAuth Link flow only; must be registered in Plaid
                          dashboard first and must be a frontend page URL (not Railway/backend)
                          -- unset until registered, or ALL institutions fail to link, not just RBC
SNAPTRADE_CLIENT_ID   -- SnapTrade API credentials
SNAPTRADE_CONSUMER_KEY
TWELVE_DATA_API_KEY   -- Twelve Data REST + self-hosted MCP service (free tier at launch)
MCP_SERVICE_URL       -- Self-hosted twelvedata/mcp public URL (second Railway service)
MCP_SERVICE_TOKEN     -- Bearer token protecting the MCP service
ANTHROPIC_API_KEY     -- Claude API (sync + Batch)
ALPHA_VANTAGE_API_KEY -- Fallback market data
GOOGLE_CLIENT_ID      -- Google OAuth (Sheets live import path)
GOOGLE_CLIENT_SECRET
MS_CLIENT_ID          -- Microsoft identity platform (Excel/Graph live import path)
MS_CLIENT_SECRET
SEED_EMAIL            -- Initial user email (used once by seed script)
SEED_PASSWORD         -- Initial user password (used once by seed script)
PUBLIC_SIGNUP_ENABLED -- "false" at launch; "true" when opening to public
```
(`TRADINGVIEW_WEBHOOK_SECRET` is intentionally gone — per-user hashed secrets live in `webhook_credentials`, §4.)

**Vercel (frontend):**
```
EXPO_PUBLIC_API_URL   -- Railway backend base URL (consumed via app.config.ts extra.apiUrl)
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
7. **If using Google OAuth for historical import:** Set the Google Cloud project's OAuth consent screen to **Published** status (not Testing). In Testing status, refresh tokens are revoked after 7 days, causing silent `invalid_grant` failures. Alternatively, add your own email to the test user allowlist before running the import.
8. Connect SnapTrade account (Wealthsimple) via in-app Settings → Connected Accounts
9. Connect Plaid accounts (RBC, Tangerine, Scotiabank) via in-app Settings → Connected Accounts
10. Deploy the self-hosted `twelvedata/mcp` service (second Railway service, Dockerfile) with `TWELVE_DATA_API_KEY` + bearer auth; set `MCP_SERVICE_URL`/`MCP_SERVICE_TOKEN` on the backend
11. Generate the user's TradingView webhook secret (stored hashed in `webhook_credentials`); set up TradingView alerts with the Railway webhook URL + that secret in the alert message JSON. **TradingView plan note:** webhooks require at minimum the Essential plan — they are not available on the Free plan.
12. **Register the frontend's production URL as `redirect_uri` in the Plaid dashboard** (Team Settings -> API -> Allowed redirect URIs), then set `PLAID_REDIRECT_URI` in Railway to that same URL. Required for RBC's OAuth Link flow only — leave unset until registered, since Plaid rejects `linkTokenCreate` for all institutions if it's set but unregistered. Also configure Hosted Link's separate `completion_redirect_uri` (custom scheme back into the app — §5.1, two distinct URIs).
13. **Register the Microsoft identity platform app** (Excel/Graph import path) and set `MS_CLIENT_ID`/`MS_CLIENT_SECRET`
14. **When custom domain is configured:** update both the Plaid dashboard registration and `PLAID_REDIRECT_URI` to the production domain

### Scale Path

| Layer | Now | At scale |
|---|---|---|
| Backend | Railway Starter (~$15-25/mo actual) | Larger Railway instance → AWS/GCP/Azure (standard Node.js) |
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

3. **Scotiabank connection stability:** Log every `ITEM_LOGIN_REQUIRED` event by institution from day one. If Scotiabank's relink frequency exceeds 4x/year/user on average, treat it as a churn-risk signal distinct from the Tangerine MFA issue — Scotiabank's connection is credential/scraping-based with no formal Plaid API deal (§5.1), a different failure mode with a slower expected cadence than Tangerine's.

4. **Yahoo Finance stability:** Monitor for breakage in the Yahoo Finance npm library. If it breaks and Alpha Vantage's 25 req/day free tier is insufficient, evaluate Polygon.io paid plan for real-time intraday data.

5. **CDBA Phase 1 (H2 2027):** When Canada's Consumer-Driven Banking APIs go live, evaluate migrating Plaid bank connections to CDBA-accredited providers for improved stability, standardized data schema, and potentially lower cost. The `BankSyncProvider` abstraction makes this a contained change. The screen-scraping ban will also be activated once CDBA is operational — Plaid's OAuth-based RBC connection is compliant; Scotiabank and Tangerine connections may need to migrate. **Schedule this review for Q3 2027** — gives a buffer before year-end within the H2 2027 window, and lines up with the Scotiabank relink-frequency KPI (item 3, above) as an additional migration trigger if breached before then.

6. **Twelve Data MCP reliability:** Monitor for API endpoint changes or free tier quota exhaustion. If free tier (800 credits/day) is consistently exceeded, upgrade to Grow plan ($29/month). If the self-hosted service has an outage, advisory sessions degrade per §8's precise rules — indicator tools omitted, no fabricated numbers, web search unaffected.

7. **LLM tool-call volume and cost:** Review after N weeks of real usage. Both tools are unrestricted on both paths (auto-cards + chat) as a deliberate launch choice, which invalidates the original ~$1–3/mo estimate (computed with zero tool use) and exposes the 8-calls/min Twelve Data cap. Decide between tapering auto-card tool access or upgrading the Twelve Data plan — from observed usage, not guesses.

8. **`yahoo-finance2` v4:** v4.0.0 shipped 2026-07-11, one week before this spec revision — too fresh to adopt. Review once it has soak time; the project pins 3.x.

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

*All decisions in this spec are locked. Original decisions were reached through grilling and research sessions documented in `wayfinder/tickets/` and `wayfinder/research/`; the 2026-07-18 revision folds in the full remediation walkthrough and cross-decision review recorded in `wayfinder/remediation-decisions-2026-07-18.md` (the decision-history record — this spec supersedes it as the buildable source of truth). No further planning decisions are required before building. Implementation is gated on the standing rule in `.claude/CLAUDE.md`.*
