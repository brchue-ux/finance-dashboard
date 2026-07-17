---
label: wayfinder:map
status: open
---

# Finance Intelligence Dashboard

## Destination

A complete, buildable spec for a hosted, mobile-responsive personal finance intelligence dashboard integrating Wealthsimple (portfolio/account data), Google Sheets (budget data), TradingView (market charts, data, alerts), and the Claude API (advisory engine) — spec ready for a fresh Claude Code session to execute without further decisions.

## Notes

- Domain: personal finance, investment portfolio management, LLM advisory
- Skills to consult each session: /research, /grilling, /domain-modeling, /prototype
- Claude API (Anthropic) powers the advisory engine; user has Anthropic account with credits
- Single user initially, but auth layer designed for multi-user expansion from day one
- Deployment: hosted web app, mobile-responsive (not a native app)
- Tech stack: TBD (see "What tech stack should the app be built on?")
- **Research standard (applies to every ticket):** Before any decision is locked, exhaustive research must cover: known bugs and failure modes, scaling issues, runtime gotchas, hidden advantages, and prior art from publicly available projects (GitHub repos, blog postmortems, community write-ups). Research subagents run in parallel and are given full time to do deep dives. No shallow answers.
- Research scope for "prior art": publicly available projects others have built — not the user's own projects.

## Decisions so far

<!-- one line per closed ticket: gist + link -->
- **004** — Budget tracker scope: app owns all budget data; Google Sheet retired after one-time historical import; auto-import from RBC + Tangerine; monthly budget period; envelope-style reallocation (manual + LLM-suggested, user approves); granular subcategories; fully automatic categorization with on-demand correction. New ticket 012 flagged for Canadian bank aggregator research.
- **007** — Tech stack: separated backend (Next.js API on Railway) + frontend (Expo React Native on Vercel); Better Auth self-hosted; Turso + Drizzle ORM; Vercel AI SDK for LLM; TanStack Query polling; NativeWind for UI; Expo EAS for APK builds; Play Store path open without rewrite.
- **009** — Auth & deployment: seeded account + `PUBLIC_SIGNUP_ENABLED` flag; AES-256 encrypted tokens in Turso; HTTPS everywhere; auto-deploy on `main` with staging gate path; custom domain deferred to build time; 15-min staleness sync, pull-to-refresh, 2-min debounce, 2am background sync; LLM never runs on sync.
- **005** — Wealthsimple sync: SnapTrade API (free tier, OAuth per-user, ToS-compliant); daily 2am append-snapshot sync + pull-to-refresh on demand; full cache in Turso (all holdings, balances, transactions, performance — time-series, never overwritten); LLM checks staleness and asks user before advisory, never auto-syncs; last-known-good data + soft reconnect banner on auth failure; SnapTrade API key in Railway env vars, per-user token AES-256 encrypted in Turso.
- **012** — Canadian bank aggregator: Plaid selected; all 6 accounts confirmed; free Trial plan ($0, 10 Items, single-user covered); RBC HIGH stability (direct API deal Q3 2024); Scotiabank MEDIUM; Tangerine LOW (open MFA bug, 5-9 day lag, frequent relinks — affects all aggregators, mitigated by ITEM_LOGIN_REQUIRED webhook + relink banner); Flinks/Wealthica/Salt Edge/MX all ruled out; CDBA Phase 1 read access realistic H2 2027 — build behind aggregator abstraction for future swap. Findings: `research/012-canadian-bank-aggregator-findings.md`
- **006** — TradingView integration: Lightweight Charts v5 + deepentropy (446+ indicators) for primary charts; TradingView widgets for ticker tape + economic calendar only; Yahoo Finance for market data (Polygon.io upgrade path for real-time intraday); webhook alerts → Turso → alert feed → user-triggered LLM analysis; full Wealthsimple portfolio overlays (cost basis, entry date, position size) on all charts; mobile handled natively; "visualize every data point" principle carried to ticket 011.
- **010** — LLM advisory engine: sync-delta trigger (run only when new data exists, cache otherwise); full history context; per-user context assembly from Turso, stateless sessions, no cross-user leakage; system prompt: Canadian tax context, defensive→aggressive investment posture, self-directed transition, net worth north star; web search ungated; `tradesdontlie` MCP enabled; structured cards (insights + approve/dismiss actions); auto-cards batch-render, conversational sessions stream; prompt caching enabled; ~$0.02–0.04/session, ~$1–3/month.
- **011** — UI structure: Gradient theme (dark, purple/blue, glassmorphism); 4-tab bottom nav (Budget, Portfolio, Alerts, Settings); envelope grid + LLM cards + transaction feed on Budget; ticker tape + portfolio value + holdings list + LLM cards on Portfolio; alert feed with severity dots + Analyze with Claude on Alerts; connected accounts + preferences on Settings; working HTML prototype at `prototype/ui-prototype.html`.

## Not yet specified

- Detail tab contents for each main view — what each tab shows depends on what the LLM advisory engine produces and what data integrations expose; too early to specify until the LLM design is locked
- LLM prompt architecture and context window design — how much data gets passed, in what shape, what the system prompt looks like, how tool use (web search) is invoked
- Notification and alert delivery mechanism — in-app only, email, push notification, or TradingView webhook relay; depends on TradingView capabilities research
- Database schema and data persistence strategy — what needs to be persisted vs fetched live; depends on Wealthsimple sync strategy and tech stack
- Final spec document structure — how the spec is organized and what sections it contains

## Out of scope

<!-- populated if work is explicitly ruled out of this effort -->
