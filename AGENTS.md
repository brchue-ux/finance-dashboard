# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

Standing product rules, environment/credential locations and the current phase of work live in
`.claude/CLAUDE.md`; build history lives in `.claude/CHANGELOG.md`. This file holds the sharp
edges an agent only finds by hitting them.

## `.env.local` can point a throwaway server at the REAL database

`backend/.env.local` is gitignored, so each checkout carries its own — and the **primary
checkout's copy sets `DATABASE_URL` to an ABSOLUTE path to `backend/local.db`, the real
financial data**. A worktree that inherits or copies that file will serve and mutate the real
database from an ordinary `next dev`, with nothing in the output saying so.

Before starting any server in a worktree: point `backend/.env.local` at a **relative** scratch
target (`file:./scratch-test.db`), seed it with `db/seed-test.ts`, and confirm afterwards that
the primary checkout's `backend/local.db` is byte-identical (`md5sum`) with no `-wal`/`-shm`
sibling. This is the concrete form of the mandatory protocol in `.claude/CLAUDE.md`.

Telling the two apart at runtime: test-seed account names carry a `[TEST]` marker; the real
database is the multi-thousand-transaction one across 8 named real accounts. Logins and env-file
wiring for both live in the dev-server bullet of `.claude/CLAUDE.md`; the test seed's own row
count is whatever `db/seed-test.ts` reports when you run it.

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

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
