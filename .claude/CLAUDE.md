# Claude Code — Global Instructions

## Active Projects

### Finance Intelligence Dashboard (Wayfinder map)
A personal finance intelligence dashboard integrating Wealthsimple, bank transactions (RBC + Tangerine + Scotiabank), TradingView, and the Claude API (advisory engine). **Spec written and scaffold complete.**

**Codebase:** `C:\Users\bchue\finance-dashboard\`
- `backend/` — Next.js API-only (Railway, port 3001)
- `frontend/` — Expo React Native (Vercel web + EAS Android APK)

**Architecture locked:** Separated backend + frontend (no monolith). See spec: `~/.claude/projects/C--Users-bchue/wayfinder/spec.md`

**Build status:**
- Scaffold: complete (all files written, deps installed)
- Schema: pushed to local SQLite (`backend/local.db`) — all 13 tables live
- Turso cloud: token added, dashboard commands run
- Spec: corrected post-completion analysis (2026-07-16) — all critical/high issues resolved; all 6 pre-build items complete as of 2026-07-17. **Spec is build-ready.**
- Item 1 done: MCP server → `twelvedata/mcp` (official, HTTP transport, free tier 800 calls/day)
- Item 2 done: TradingView paid plan friction → native price alert system added (node-cron + yahoo-finance2 quoteCombine; TradingView webhooks now optional enhancement only)
- Item 3 done: LLM merchant categorization — §6 documents uncategorized transactions go to user review queue (not LLM fallback), closing the Ticket 004 inconsistency
- Item 4 done: Tangerine data lag — §5.1 has the UI staleness indicator; §8 System Prompt now has a DATA FRESHNESS section so the LLM doesn't make false-precision claims on stale Tangerine data
- Item 5 done: Prompt cache TTL cost model — §8 has the 5-min TTL note; added a nightly Batch API pre-generation job (§7/§8) at 50% off, synchronous calls reserved for on-demand/alert-triggered sessions
- Item 6 done: Scotiabank fragility — §5.1 known-issue paragraph; §11 has an explicit 4x/year/user relink KPI and a Q3 2027 CDBA migration review date

**Key env file:** `backend/.env.local` (ENCRYPTION_KEY + BETTER_AUTH_SECRET already generated) — **exact location TBD**

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
