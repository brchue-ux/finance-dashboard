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

## Current state (as of 2026-07-27, `main`)

Backend is in **REAL-DATA mode** against `local.db` — the real multi-thousand-transaction data
across 8 accounts. (No count here on purpose; `AGENTS.md` explains how to tell it from the test
seed at runtime.) Backend is **deployed as a systemd user service** (`wayfinder-backend`, port
3011, standalone build — code changes no longer hot-reload, ship via `npm run build && systemctl
--user restart wayfinder-backend`), reachable at `https://homeserver.tail25a02d.ts.net:7443` via
tailscale serve. `build-reminders.md` items 1–9 are done; item 10 (realistic seed) done; item 5
(region/currency) deferred. Root `npm test` runs **both** workspaces (`backend` and `frontend`).
No test count is recorded here on purpose — the hand-maintained one drifted twice; run the command.

**CI exists and gates every PR** — `.github/workflows/ci.yml`, on `pull_request` and on push to
`main`: `npm ci` at the root, both test suites, `npm run typecheck`, then both builds. Two facts
worth not rediscovering: it needs **no secrets and cannot reach the real database** (the only env
it sets is the inline literal `DATABASE_URL: 'file::memory:'`, required because `db/index.ts`
builds its libsql client at import time), and both builds complete on a standard runner — the 6GB
heap in `backend`'s build script is a ceiling, not a requirement. Detail: `AGENTS.md` CI section.

**Security posture (standing, not narrative):** Plaid webhooks are signature-verified in
`lib/plaid-webhook.ts` and rejected `401` — never read a webhook body before it verifies. Both
OAuth callbacks log the provider's error server-side (sanitized) and reflect **nothing** back to
the browser; HTML escaping lives in `lib/close-page.ts`. Money-write routes (transaction update,
splits, allocations/reallocate) gate body shape and integer coercion through `lib/request-body.ts`
— `Number([]) === 0` passes `Number.isInteger`, which once wrote allocations for year 0. Route new
handlers through these helpers rather than re-deriving them. Why, in `.claude/CHANGELOG.md`.

**Expo web is a supported target** — sign-in and all nine gradient-title screens verified in a
desktop browser (not on the phone). Its sharp edges (origin trust, the `*.web.tsx` platform split)
live in the root `AGENTS.md`.

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

**Not yet device-verified (browser or tests only — the phone has not confirmed any of these):**
scope chips; import-excel screen layout; the Reports "Spent" headline + its new "Not in any
category" row; the Expo-web target fixes; and the unified connection-status UI, which includes a
**deliberate** user-visible hue change ("Live" on Settings and System status moved from
`COLORS.success` to the softer `COLORS.moneyIn`) — intended, not a refactor slip.

**Approved but NOT started:** migrating money storage from floating point to **integer cents**
(amounts are `real` columns in `backend/db/schema.ts`). The user has approved this; it is planned
work, not an open question — don't re-litigate it, and don't start it unprompted.

**Known-open issue — port 3001 vs 3011.** The documented and deployed port is **3011**, but
`backend/package.json`'s `dev`/`start` scripts and both `.env.example` files still say 3001.
Deliberately not fixed yet; pass `--port 3011` explicitly and don't lose an hour to it.

Full detail, every commit hash, and every fixed bug for the above: `.claude/CHANGELOG.md`.

## Standing product rules

- **One-press nav rule (user, 2026-07-22):** anything the app surfaces or names that CAN be
  navigated to MUST ship with a clean one-press way to get there. Audit this on every new
  surfaced-item feature.
- **A surface labelled "Spent" shows `summary.totalOutflow`, never `summary.totalSpent`.**
  `totalSpent` counts only spend that reached an envelope, so it shrinks as categorization
  coverage gets worse and misses the ledger by `unattributedSpent`; `totalOutflow` reconciles
  (`totalIncome − totalOutflow` = actual account movement). If the surface also lists the
  envelope rows, itemise the uncategorized remainder so the list still sums to the headline.
  Pinned by the "canonical Spent" tests in `backend/lib/budget/summarize.test.ts`.
- **Envelope sets can't be rigid or forced.** Cluster the user's OWN merchants and propose —
  never ship one household's taxonomy as a default.
- **Never mark the frontend verified without an explicit user OK.** "User said commit/push" is
  NOT "user confirmed it works."
- **Rules are SCOPED, not catch-all.** Region/currency is a keep-door-open constraint — no
  hardcoded CAD assumptions in new code (single-user Canadian today, but not a hard dependency).
- **RN lesson:** never use a `flex: 1` root in a content-sized (`maxHeight`-only) bottom sheet —
  it collapses to zero height. Size to content, bound any inner ScrollView.

## Dev-server / environment

- **`backend/.env.local` points `DATABASE_URL` at the REAL database by ABSOLUTE path**, so a dev
  server started in *any* checkout or worktree that inherits it serves and mutates live financial
  data with nothing in its output saying so. Full protocol (scratch DB, seeding, md5 check) is in
  the root `AGENTS.md` — read it before starting any server.
- Run Expo from `frontend/`, NOT the repo root (root has no `main`/`App.tsx`).
- **Metro is ALWAYS port 8082** (8081 = home-automation orchestrator, permanent — don't rediscover this).
- Device reaches the API via `frontend/.env.local` → `EXPO_PUBLIC_API_URL=http://192.168.68.62:3011` (gitignored, recreate if missing; env only reloads on `expo start` restart).
- Backend dev: `next dev --port 3011` with `--env-file=.env.local --env-file=.env.test` → serves **test.db** (seeded by `db/seed-test.ts` — that script's own output is the transaction count, don't hardcode one here; login `demo@test.local`/`test1234`). Without `--env-file=.env.test`, serves **local.db** (the real data; device login `dev@example.com`, password in `~/.secrets/finance-dashboard-local-dev-seed.txt`). Switching back to real data needs a sign-out/in — the 30-day signed cookie cache survives the swap.
- Production: systemd user service `wayfinder-backend` on 3011, real data, linger enabled. An OOM leaves a partial standalone build that 404s — but the build script's 6GB
  heap is a ceiling, not a requirement (see the CI section of `AGENTS.md`).
- Repo: `~/projects/home_budget_app` (Linux homeserver) ⇄ GitHub `brchue-ux/finance-dashboard` (private). npm workspaces monorepo (`backend`, `frontend`).
- **USER TODO still open:** add the tailscale https redirect URI to Entra app `b2d0ac8c` or new OneDrive consents fail.

## Reference

- `spec.md` (what to build) and `remediation-decisions-2026-07-18.md` (why) — both in `.claude/wayfinder/`.
- `.claude/wayfinder/build-reminders.md` — deferred items that must surface at build time or post-launch. Check before starting a build session.
- `.claude/wayfinder/handoff-2026-07-16.md` — prior handoff doc.
- Full build history, every commit, every fixed bug: `.claude/CHANGELOG.md`.

## Standing Preferences

- Research standard: before any decision is locked, research must cover known bugs, scaling issues, runtime gotchas, hidden advantages, and prior art from publicly available projects. No shallow answers.
- Research subagents run in parallel and are given full time to do deep dives.
- Post-completion analysis: once all wayfinder tickets are resolved, conduct a full analysis of every completed ticket — reasoning applied, research methods used, gaps in coverage, opportunities missed. Mandatory final step before the spec is written.
- Wayfinder tracker: local-markdown (no GitHub repo for this project). Map and tickets live in `.claude/wayfinder/`. Research findings in `.claude/wayfinder/research/`.
- Claude Code pinned at v2.1.81 — do not suggest updating (breaks Wispr Flow voice paste on Windows).
