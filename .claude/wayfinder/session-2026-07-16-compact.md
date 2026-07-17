# Session Compact — 2026-07-16

## What Happened This Session

### 1. Completed All 4 Remaining Research Tickets
Ran all 4 in parallel as general-purpose agents:
- **001** — Wealthsimple data access (updated findings: Hive Gateway migration risk, Flinks correction, SnapTrade pricing confirmed, Open Banking Bill C-15 timeline)
- **002** — TradingView integration (new: webhook timeout corrected to 3s, two distinct MCP projects distinguished, Advanced Charts license excludes personal projects, webhook plan requirements)
- **003** — Tech stack options (new: Vercel AI SDK v7 ESM-only/Node 22+, Better Auth took over Auth.js, prompt cache TTL → 5 min, CVE-2025-29927, EAS Hosting)
- **008** — Google Sheets integration (new: OAuth "Testing" 7-day token revocation, googleapis #2350 bug, Drive push channel expiry 1hr, quota charging coming)

All 4 tickets closed.

### 2. Post-Completion Analysis (CLAUDE.md mandatory step)
Ran a full analysis of all 12 tickets against the spec. Found:

**3 CRITICAL issues:**
- Wrong MCP server — `tradesdontlie` is a local dev tool, not a deployable server
- Vercel AI SDK v7 requires Node.js 22+ (ESM-only) — not in spec
- Webhook timeout 3s (not 5s as spec stated)

**3 HIGH issues:**
- Prompt cache TTL is 5 min (not 60 min) — cost model assumption wrong
- Google OAuth "Testing" status revokes refresh tokens after 7 days
- Better Auth `encryptOAuthTokens` not evaluated

**Several MEDIUM/LOW issues** — all corrected in spec.

### 3. Applied All Spec Corrections
14 edits to `spec.md`. Deferred items tracked in `build-reminders.md` and referenced in `CLAUDE.md`.

### 4. Pre-Build Issue Review (6 items)
Identified 6 issues requiring deeper work before building. Working through them one by one.

**Item 1: MCP server vetting**
- `atilaahmettaner/tradingview-mcp` evaluated and rejected: 3 blockers (stdio-only transport incompatible with Vercel AI SDK v7 production deployment; core dependency `python-tradingview-ta` archived June 2024; cloud IP blocked by TradingView scanner endpoint)
- Replacement selected: **`twelvedata/mcp`** — official vendor-maintained MCP server, HTTP transport, 130+ indicators including all needed (RSI, MACD, MA20, MA50, volume), free tier 800 calls/day (sufficient for solo use at ~20-40 calls/day), $29/mo Grow plan at scale. Indicator values consistent with TradingView's own readings.
- Spec updated throughout (§2 table, §5.5 rewritten, §11 updated)

**Item 2: TradingView paid plan friction**
- Problem: TradingView Free plan users get silent failure on alerts (webhooks require Essential+ plan)
- Decision: **Native price alert system** — backend monitors prices independently; TradingView webhooks become optional enhancement for paid-plan users
- Architecture researched and locked:
  - **Poller:** in-process `node-cron` in existing Railway Node.js process (zero new services, zero cost delta at MVP)
  - **Data source:** `yahoo-finance2` `quoteCombine()` (batches all tickers in one HTTP request via 50ms debounce) — Twelve Data REST as fallback only (free tier math fails at scale for polling)
  - **Market hours:** `@sebspark/trading-hours` npm — skip nights, weekends, holidays
  - **MVP conditions:** price_above, price_below, pct_change_up, pct_change_down (all from single Yahoo quote response, no extra API calls)
  - **Deduplication:** one price fetch per distinct ticker per cycle; `alert_fires.firedAtBucket` unique constraint for hard DB-level deduplication
  - **Alert lifecycle:** one-time fire → triggered → manual re-arm; optional `cooldown_seconds` for recurring
  - **Scale path:** 0-50 users $0 delta → 50-150 add Twelve Data paid fallback ($29/mo) → 150-500 separate Railway worker + Twelve Data primary ($79/mo) → 500+ Postgres + BullMQ
- **3 new tables added to spec schema:**
  - `price_alerts` — standing monitoring instructions; `conditionParams` JSON column makes it forward-compatible for MA crossover, RSI, volume spike without structural migration
  - `alert_fires` — unified event log (source: native | tradingview); 5-min bucket deduplication
  - `price_cache` — last-known-good prices; prevents false alerts on failed poll cycles
- `TWELVE_DATA_API_KEY` added to Railway env vars
- `node-cron` + `@sebspark/trading-hours` added to tech stack table

**Items 3–6: Not yet started**
3. LLM unknown merchant categorization (Ticket 004 vs spec §6 inconsistency)
4. Tangerine data lag in LLM system prompt + UI
5. Prompt cache TTL → add Batch API nightly analysis to LLM design
6. Scotiabank fragility → post-launch KPI tracking + CDBA H2 2027 scheduled priority

---

## Current Spec State
- File: `C:\Users\bchue\.claude\projects\C--Users-bchue\wayfinder\spec.md`
- Status: **Not yet ready to build** — items 3–6 of pre-build review still outstanding
- Last updated: 2026-07-16

## Files Created/Updated This Session
- `research/001-wealthsimple-data-access-findings.md` — updated
- `research/002-tradingview-integration-findings.md` — updated
- `research/003-tech-stack-options-findings.md` — updated
- `research/008-google-sheets-integration-findings.md` — updated
- `post-completion-analysis.md` — created
- `build-reminders.md` — created (8 deferred items with build-time + post-launch tracking)
- `research/mcp-tradingview-evaluation.md` — created
- `research/price-alert-architecture.md` — created
- `spec.md` — 20+ corrections and additions applied
- `session-2026-07-16-compact.md` — this file

## Where to Resume
Next session: start Item 3 — LLM unknown merchant categorization.
Read `spec.md` §6 (Categorization Engine) and the Ticket 004 decision before starting.
The question: async LLM categorization job post-sync, or stay with user review queue? Resolve the inconsistency and update the spec.
