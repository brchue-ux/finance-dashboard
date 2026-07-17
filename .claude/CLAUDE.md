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
- Spec: corrected post-completion analysis (2026-07-16) — all critical/high issues resolved; 6 pre-build items in progress (2 of 6 complete)
- Item 1 done: MCP server → `twelvedata/mcp` (official, HTTP transport, free tier 800 calls/day)
- Item 2 done: TradingView paid plan friction → native price alert system added (node-cron + yahoo-finance2 quoteCombine; TradingView webhooks now optional enhancement only)
- Items 3–6 remaining: LLM unknown merchant categorization, Tangerine data lag, prompt cache TTL cost model, Scotiabank fragility KPIs

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
