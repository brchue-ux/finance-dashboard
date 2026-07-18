# Claude Code — Global Instructions

## Active Projects

### Finance Intelligence Dashboard (Wayfinder map)
A personal finance intelligence dashboard integrating Wealthsimple, bank transactions (RBC + Tangerine + Scotiabank), TradingView, and the Claude API (advisory engine). **Spec build-ready. Auth + Plaid Sandbox loop verified working (2026-07-17, from the Linux homeserver checkout).**

**Codebase:** synced between `C:\Users\bchue\finance-dashboard\` (Windows) and `~/projects/home_budget_app` (Linux homeserver) via `scripts/sync-*.sh`/`.ps1`.
- `backend/` — Next.js API-only (Railway, port 3001; local dev used 3011 on the homeserver — 3001 is taken by an unrelated container, `home-agent-orchestrator`)
- `frontend/` — Expo React Native (Vercel web + EAS Android APK) — **not yet touched this session, still scaffold-only**

**Architecture locked:** Separated backend + frontend (no monolith). See spec: `wayfinder/spec.md` (in-repo, `.claude/wayfinder/`)

**Build status:**
- Scaffold: complete (all files written)
- Schema: 19 tables live in local SQLite (`backend/local.db`) — the original 13, +3 for price alerts (`price_alerts`/`alert_fires`/`price_cache`), +4 for Better Auth (`user`/`session`/`account`/`verification`, replacing the old minimal `users` table)
- **Auth: verified working end-to-end.** Better Auth's schema was never actually generated before this session — no authenticated route could ever succeed. Fixed via `npx @better-auth/cli generate`; `seed.ts` rewritten to create the seed account through Better Auth's real sign-up path. Confirmed: sign-in returns a session cookie, protected routes correctly 401/200.
- **Plaid Sandbox loop: verified working end-to-end.** link token → sandbox public_token → exchange → sync, confirmed real transaction and account data lands in `local.db`. Fixed a real bug along the way: `link/token/create` was unconditionally sending an unregistered `redirect_uri`, which made Plaid reject `linkTokenCreate` for every institution, not just RBC's OAuth flow (now optional via `PLAID_REDIRECT_URI`). Also added `lib/plaid-accounts.ts` to populate real account names/types from Plaid instead of placeholder values.
- Next.js patched 15.3.3 → 15.5.20 (critical CVE-2025-66478, non-breaking patch bump)
- Turso cloud: token added, dashboard commands run (per earlier session — not verified this session; local dev uses SQLite only, `DATABASE_AUTH_TOKEN` is intentionally empty in `backend/.env.local`)
- Spec: corrected post-completion analysis (2026-07-16) — all critical/high issues resolved; all 6 pre-build items complete as of 2026-07-17. **Spec is build-ready.**
- Item 1 done: MCP server → `twelvedata/mcp` (official, HTTP transport, free tier 800 calls/day)
- Item 2 done: TradingView paid plan friction → native price alert system added (node-cron + yahoo-finance2 quoteCombine; TradingView webhooks now optional enhancement only)
- Item 3 done: LLM merchant categorization — §6 documents uncategorized transactions go to user review queue (not LLM fallback), closing the Ticket 004 inconsistency
- Item 4 done: Tangerine data lag — §5.1 has the UI staleness indicator; §8 System Prompt now has a DATA FRESHNESS section so the LLM doesn't make false-precision claims on stale Tangerine data
- Item 5 done: Prompt cache TTL cost model — §8 has the 5-min TTL note; added a nightly Batch API pre-generation job (§7/§8) at 50% off, synchronous calls reserved for on-demand/alert-triggered sessions
- Item 6 done: Scotiabank fragility — §5.1 known-issue paragraph; §11 has an explicit 4x/year/user relink KPI and a Q3 2027 CDBA migration review date

**Known open items (not yet fixed):**
- `lib/market-data/yahoo.ts` and `lib/snaptrade.ts` have pre-existing TypeScript errors (predate this session) — will block `next build` (though not `next dev`) until fixed
- `PLAID_REDIRECT_URI` / the RBC OAuth Link flow is unbuilt — needs a real frontend redirect page, not yet started
- `SNAPTRADE_CLIENT_ID`, `SNAPTRADE_CONSUMER_KEY`, `TRADINGVIEW_WEBHOOK_SECRET`, `ANTHROPIC_API_KEY`, `ALPHA_VANTAGE_API_KEY` are still empty placeholders in `backend/.env.local` — needed before their respective integrations can be tested
- Frontend hasn't been run or tested at all yet

**Key env file:** `backend/.env.local` — populated for auth (`ENCRYPTION_KEY`, `BETTER_AUTH_SECRET`, `SEED_EMAIL`/`SEED_PASSWORD` — see `~/.secrets/finance-dashboard-local-dev-seed.txt`) and Plaid Sandbox (`PLAID_CLIENT_ID`/`PLAID_SECRET`, from `~/.secrets/Plaid.txt`). Gitignored, local to each machine — Windows and Linux checkouts need this filled in separately.

**Handoff doc (start here in a new session):**
`~/.claude/projects/C--Users-bchue/wayfinder/handoff-2026-07-16.md`

**Build reminders (deferred items — must surface at build time and post-launch):**
See `~/.claude/projects/C--Users-bchue/wayfinder/build-reminders.md` — contains 8 items that MUST be called out at the relevant build phase or post-launch. Do not begin a build session without checking this file.

See memory file: `finance-dashboard-wayfinder.md`

## Standing Preferences

- Research standard: before any decision is locked, research must cover known bugs, scaling issues, runtime gotchas, hidden advantages, and prior art from publicly available projects. No shallow answers.
- Research subagents run in parallel and are given full time to do deep dives.
- Post-completion analysis: once all wayfinder tickets are resolved, conduct a full analysis of every completed ticket — reviewing the reasoning applied, the research methods used, gaps in coverage, and opportunities missed. This is a mandatory final step before the spec is written.
- Wayfinder tracker: local-markdown (no GitHub repo for this project). Map and tickets live in `~/.claude/projects/C--Users-bchue/wayfinder/`. Research findings live in `wayfinder/research/`.
- Claude Code pinned at v2.1.81 — do not suggest updating (breaks Wispr Flow voice paste on Windows).
