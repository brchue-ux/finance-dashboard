# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

Standing product rules, environment/credential locations and the current phase of work live in
`.claude/CLAUDE.md`; build history lives in `.claude/CHANGELOG.md`; the domain vocabulary — what
Envelope, Outflow, Transfer, Refund and the rest mean and where their boundaries fall — lives in
`CONTEXT.md`. This file holds the sharp edges an agent only finds by hitting them.

## `.env.local` can point a throwaway server at the REAL database

`backend/.env.local` is gitignored, so each checkout carries its own — and the **primary
checkout's copy sets `DATABASE_URL` to an ABSOLUTE path to `backend/local.db`, the real
financial data**. A worktree that inherits or copies that file will serve and mutate the real
database from an ordinary `next dev`, with nothing in the output saying so.

Before starting any server in a worktree: point `backend/.env.local` at a **relative** scratch
target (`file:./scratch-test.db`), seed it with `db/seed-test.ts`, and confirm afterwards that
the primary checkout's `backend/local.db` is byte-identical (`md5sum`) with no `-wal`/`-shm`
sibling. This is the concrete form of the mandatory protocol in `.claude/CLAUDE.md`.
Keep the scratch filename matching `/test/i` — `db/seed-test.ts` refuses any other `DATABASE_URL`.

Telling the two apart at runtime: test-seed account names carry a `[TEST]` marker; the real
database is the multi-thousand-transaction one across 8 named real accounts. Logins and env-file
wiring for both live in the dev-server bullet of `.claude/CLAUDE.md`; the test seed's own row
count is whatever `db/seed-test.ts` reports when you run it.

The real database also moves on its own: the `wayfinder-backend` systemd service runs against it
continuously with cron jobs. An md5 that changed while you were idle is therefore not proof you
touched it — check whether any server of yours was running at that mtime before concluding either way.

## Other worktree sharp edges

- **Metro's transform cache is shared across worktrees and will resolve `node_modules` against the
  wrong one.** `expo start` and `expo export` both need `--clear` on first run in a new worktree,
  or the bundle/export fails with `Unable to resolve module <other-worktree-path>/...`.
  Pass it on the command line — neither `npm start` nor `build:web` carries `--clear`, deliberately,
  because it would pay the cache rebuild on every run for a first-run-only problem.
  (`.claude/CHANGELOG.md` documents the original occurrence.)
- Never run `npm run build` in `backend/` while a `next dev` is live — they share `.next` and the
  dev server breaks with a webpack chunk mismatch.

## Ledger money is integer cents in the DB, dollars in TypeScript

`backend/lib/money.ts` is the ONE conversion seam, and `moneyCents` — the drizzle custom column
type it exports — is how the ledger-money columns (listed in `backend/db/money-columns.ts`) are
declared in `db/schema.ts`. Consequences worth knowing before you touch a money path:

- **Do not write `Math.round(x * 100)` at a call site.** The rounding rule (half away from zero,
  evaluated on the decimal string so `$1.005` does not silently become 100¢) lives in `toCents`.
- **Callers above `db/` still work in dollars.** Reads come back as dollars and writes take
  dollars, because the mappers run at the driver boundary — including on `eq`/`lt`/`gt`/`inArray`
  operands and on `returning()`. Nulls bypass both mappers. This is deliberate: converting the
  *arithmetic and display* to cents is a separate, later piece of work.
- **The one thing the seam cannot cover is a hand-written `sql` fragment naming a money column** —
  raw SQL yields raw cents. There are none today (all summing happens in TypeScript); if you add
  one, convert its result with `fromCents`.
- **`fromCents` throws on a non-integer.** That is the "this column was never migrated" alarm, and
  it is meant to be loud rather than to render every figure 100× too small.
- Most of the schema's other `real` columns are NOT money-in-cents — share quantities, per-share
  and market prices, percentages, and derived portfolio valuations are fractional or estimates.
  `db/money-columns.ts` says which columns are in scope and why.
- **`bank_accounts.balance_*` and `bank_balance_snapshots.balance_*` must always share a unit.**
  One Plaid sync writes both and the net-worth series reads both; the snapshot table is
  append-only, so a period where they disagreed could not be recomputed afterwards. If either ever
  changes representation again, both change in the same migration.

**Order matters when this meets a database with data in it:** migrate BEFORE the new schema
arrives (a deploy, or a `drizzle-kit push`). A push sets the declared column type without
converting a value, and that type is the migration's idempotency marker, so migrating afterwards
skips columns still holding dollars. The migration probes for that and refuses, but the probe
cannot see a whole-dollar row — the ordering is the real protection.

Migrating an existing database is `db/migrate-money-to-cents.ts` (dry-run by default, one
transaction, idempotent, rebuilds each table because SQLite cannot ALTER a column's type), and
`db/verify-money-cents.ts --before <backup.db>` proves it — per-table row counts across ALL tables,
declared types, and an exact per-row check against the rounding rule. Take the backup first: the
verification is impossible without the values it started from.

## Tests

- `npm test` at the root runs **both** workspaces: `backend` and `frontend`. Do not record a total
  here or in `.claude/CLAUDE.md` — the hand-maintained one has already drifted; run the command.
- The frontend config (`frontend/vitest.config.ts`) is pure and RN-free (`lib/**` only), so a module
  importing `react-native` cannot be tested there. That constraint is why `frontend/lib/csv-signs.ts`
  and `frontend/lib/connection-status.ts` are deliberately RN-free.
- `backend/lib/web-origins.test.ts` parses `frontend/package.json` and asserts every expo-start
  script names an explicit `--port` **and** that each port is trusted. Add an expo script without a
  port, or on a new port, and it fails until `DEV_ORIGINS` agrees — do not hardcode a port there.

## CI — `.github/workflows/ci.yml`

Every PR runs both test suites, `npm run typecheck`, and both builds on a clean `npm ci`. Two
facts that make it work and are not obvious from the scripts:

- **`next build` needs a `DATABASE_URL` to exist.** `db/index.ts` builds its libsql client at
  import time, so page-data collection dies with `URL_INVALID: 'undefined'` if it is unset. CI
  passes `file::memory:` — no file, no real data. Every other integration credential is genuinely
  optional at build time; the build needs no secrets at all.
- **The `--clear` Metro trap does not apply on a runner.** That trap is a *shared* cache across
  local worktrees; a CI checkout starts with an empty cache, so `build:frontend` is safe as-is.

The 6GB heap in `backend`'s build script is a ceiling, not a requirement — the build peaks near
2.5GB RSS, well inside a standard runner.

## Route handlers are unit-testable — `vitest.config.ts` already includes `app/**/*.test.ts`

The suite was pure-logic-only for a long time, which reads as "routes can't be tested here". They
can. A route test imports the handler directly and stubs its collaborators:

```ts
vi.mock("@/lib/auth-guard", () => ({ requireUser: vi.fn(async () => ({ userId: "user-1" })) }));
vi.mock("@/db", () => ({ db: { /* chainable stub: select().from().where().limit() */ } }));
const { POST } = await import("./route");   // after the mocks, not a top-level import
```

`db/index.ts` builds a libsql client at import time, which is why the config sets
`DATABASE_URL=file::memory:`; stubbing `@/db` avoids it entirely. Worked examples:
`app/api/plaid/webhook/route.test.ts`, `app/api/llm/analyze/route.test.ts`.

## Integrations are verified through injectable seams, not credentials

`lib/plaid-webhook.ts` takes an injectable `fetchKey`, so the real ES256 verification is tested
against a locally generated P-256 key pair with no Plaid account involved. Prefer that shape over
weakening a check because credentials are absent.

## Web target

Expo web is a supported target.

- Two layers must agree on origins or sign-in fails confusingly: CORS (`middleware.ts`) and Better
  Auth's `trustedOrigins`, both fed by `backend/lib/web-origins.ts`. **A passing CORS preflight
  proves nothing about auth** — the auth layer returns `403 INVALID_ORIGIN` independently. Native
  never surfaces either problem, because React Native sends no `Origin` header.
- Web-only component implementations use the `*.web.tsx` platform split (`GradientText.web.tsx`,
  `ChartView.web.tsx`). `@react-native-masked-view` has **no real web implementation** — its
  `.web.js` renders the mask element and discards the children — so anything built on it needs a
  web counterpart or it renders an uncoloured mask.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
