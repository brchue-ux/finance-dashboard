# Claude Code — Global Instructions

## Active Projects

### Finance Intelligence Dashboard (Wayfinder map)

This file holds only what's true **right now**. Full session-by-session build history,
every fixed bug, and every "verified live" narrative lives in `.claude/CHANGELOG.md` —
read it only when you need archaeology on a specific past decision, not by default.

**Session-update convention:** when a session ends, append a dated entry to `.claude/CHANGELOG.md`
describing what was done. Only edit THIS file if a standing fact changed — the current phase,
an environment/credential detail, a standing product rule, or a deferred item. Don't let
"session found X, fixed Y, verified Z" narrative accumulate back into this file.

## ⚠ DB SAFETY PROTOCOL — MANDATORY, user-ordered 2026-07-22

Two silent-data-loss incidents happened in one night against the REAL database. These rules are not optional:

1. **`drizzle-kit push` can destroy a table's rows and still print "✓ Changes applied."** Protocol: before every push, `cp` both DBs to `~/.secrets/local-db-backups/`; after every push, diff row counts across ALL tables against the backup — the tool's success output speaks for schema, never for data.
2. **Direct-sqlite3 writes made near a server kill can vanish with the WAL.** Protocol: direct DB surgery only against a STABLE server (not one about to be killed/swapped); `PRAGMA wal_checkpoint(TRUNCATE)` after writing; re-verify through the RUNNING SERVER'S API, not just a fresh sqlite3 read. Any verification done before a process transition is STALE — re-verify after.
3. A probe that "can't happen" (e.g. a dedup reporting duplicates of deleted rows) is evidence, not noise — chase it before building on top.

## Current state (as of 2026-07-22 late night, commit `1be5f2d`)

Backend is in **REAL-DATA mode** against `local.db` — 3,920 real transactions across 8 accounts
(RBC Visa, Wealthsimple RESP/Chequing/TFSA/Non-registered/FHSA, Tangerine Chequing/Credit Card).
Backend is **deployed as a systemd user service** (`wayfinder-backend`, port 3011, standalone
build — code changes no longer hot-reload, ship via `npm run build && systemctl --user restart
wayfinder-backend`), reachable at `https://homeserver.tail25a02d.ts.net:7443` via tailscale serve.
`build-reminders.md` items 1–9 are done; item 10 (realistic seed) done; item 5 (region/currency)
deferred. 277 tests passing.

**Shipped and device-confirmed:** budget tab overhaul (4 group tiles → category cards → pace/trend
detail), per-transaction recategorize + learning-rule loop, envelope proposal from the user's own
merchants, import category preview/warn with in-app success state, refunds-as-income netting with
one-tap nav to the original purchase, transfer auto-marking (user-approved patterns), feed
day-card redesign (the reusable dense-list pattern going forward), first live Wealthsimple connect
via SnapTrade (portfolio account-type groups + drill-down + in-app naming), realistic seed data,
LLM card length/numeric validation. Excel/Graph OneDrive import is proven end-to-end for the
terminal-orchestrated flow; the in-app connect button still needs a deployed https redirect URI
before it works from the phone.

**Deferred polish (user-named, do NOT action unprompted):** swipe-to-dismiss feel is janky; the
3 header icons + overall UI theme need a pass; the "Make this a rule?" proposal display/scope is
unresolved (exploratory, user said "I don't know" — don't redesign unprompted).

**Not yet device-verified:** scope chips, import-excel screen layout.

Full detail, every commit hash, and every fixed bug for the above: `.claude/CHANGELOG.md`.

## Standing product rules

- **One-press nav rule (user, 2026-07-22):** anything the app surfaces or names that CAN be
  navigated to MUST ship with a clean one-press way to get there. Audit this on every new
  surfaced-item feature.
- **Envelope sets can't be rigid or forced.** Cluster the user's OWN merchants and propose —
  never ship one household's taxonomy as a default.
- **Never mark the frontend verified without an explicit user OK.** "User said commit/push" is
  NOT "user confirmed it works."
- **Rules are SCOPED, not catch-all.** Region/currency is a keep-door-open constraint — no
  hardcoded CAD assumptions in new code (single-user Canadian today, but not a hard dependency).
- **RN lesson:** never use a `flex: 1` root in a content-sized (`maxHeight`-only) bottom sheet —
  it collapses to zero height. Size to content, bound any inner ScrollView.

## Dev-server / environment

- Run Expo from `frontend/`, NOT the repo root (root has no `main`/`App.tsx`).
- **Metro is ALWAYS port 8082** (8081 = home-automation orchestrator, permanent — don't rediscover this).
- Device reaches the API via `frontend/.env.local` → `EXPO_PUBLIC_API_URL=http://192.168.68.62:3011` (gitignored, recreate if missing; env only reloads on `expo start` restart).
- Backend dev: `next dev --port 3011` with `--env-file=.env.local --env-file=.env.test` → serves **test.db** (367 txns, login `demo@test.local`/`test1234`). Without `--env-file=.env.test`, serves **local.db** (the real 3,920-txn data; device login `dev@example.com`, password in `~/.secrets/finance-dashboard-local-dev-seed.txt`). Switching back to real data needs a sign-out/in — the 30-day signed cookie cache survives the swap.
- Production: systemd user service `wayfinder-backend` on 3011, real data, linger enabled. Build needs 6GB heap; an OOM leaves a partial standalone build that 404s.
- Repo: `~/projects/home_budget_app` (Linux homeserver) ⇄ GitHub `brchue-ux/finance-dashboard` (private). npm workspaces monorepo (`backend`, `frontend`).
- **USER TODO still open:** add the tailscale https redirect URI to Entra app `b2d0ac8c` or new OneDrive consents fail.

## Reference

- `spec.md` (what to build) and `remediation-decisions-2026-07-18.md` (why) — both in `.claude/wayfinder/`.
- `~/.claude/projects/C--Users-bchue/wayfinder/build-reminders.md` — deferred items that must surface at build time or post-launch. Check before starting a build session.
- `~/.claude/projects/C--Users-bchue/wayfinder/handoff-2026-07-16.md` — prior handoff doc.
- Full build history, every commit, every fixed bug: `.claude/CHANGELOG.md`.

## Standing Preferences

- Research standard: before any decision is locked, research must cover known bugs, scaling issues, runtime gotchas, hidden advantages, and prior art from publicly available projects. No shallow answers.
- Research subagents run in parallel and are given full time to do deep dives.
- Post-completion analysis: once all wayfinder tickets are resolved, conduct a full analysis of every completed ticket — reasoning applied, research methods used, gaps in coverage, opportunities missed. Mandatory final step before the spec is written.
- Wayfinder tracker: local-markdown (no GitHub repo for this project). Map and tickets live in `~/.claude/projects/C--Users-bchue/wayfinder/`. Research findings in `wayfinder/research/`.
- Claude Code pinned at v2.1.81 — do not suggest updating (breaks Wispr Flow voice paste on Windows).
