# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

`.claude/CLAUDE.md` remains the authoritative doc for **current product state, standing product
rules, and the DB safety protocol**; `.claude/CHANGELOG.md` is the build history. This file holds
the sharp edges that bite any session regardless of what it is working on.

## Working in a git worktree

- **`backend/.env.local` in the primary checkout points `DATABASE_URL` at an ABSOLUTE path to the
  real `backend/local.db`.** It is gitignored, so a fresh worktree has none — but if one is ever
  copied in, `next dev` in that worktree serves and can mutate the real financial database.
  Before starting any server in a worktree: write your own `.env.local` with a **relative** scratch
  URL (`file:./scratch-test.db`), and `md5sum` the real `local.db` before and after to prove it is
  untouched. `db/seed-test.ts` refuses any `DATABASE_URL` without `/test/i` in it — keep the
  scratch filename matching that guard.
- **Metro's transform cache is shared across worktrees and will resolve `node_modules` against the
  wrong one.** `expo start` and `expo export` both need `--clear` on first run in a new worktree,
  or the bundle/export fails with `Unable to resolve module <other-worktree-path>/...`.
  Pass it on the command line — neither `npm start` nor `build:web` carries `--clear`, deliberately,
  because it would pay the cache rebuild on every run for a first-run-only problem.
  (`.claude/CHANGELOG.md` documents the original occurrence.)
- Never run `npm run build` in `backend/` while a `next dev` is live — they share `.next` and the
  dev server breaks with a webpack chunk mismatch.

## Tests

- `npm test` at the root runs **both** workspaces: `backend` (vitest, `lib/**` + `app/**`) and
  `frontend` (vitest, `lib/**` only). Both configs are pure-logic — no DB, no network, no Metro
  transform, so a module that imports `react-native` cannot be tested there. That constraint is
  why `frontend/lib/csv-signs.ts` is deliberately RN-free.
- `backend/lib/web-origins.test.ts` parses `frontend/package.json`'s start script and asserts the
  trusted-origin list contains the port Metro actually binds. Change the start script's port and
  that test tells you to update `DEV_ORIGINS` — do not hardcode the port in the test.

## Web target

- Expo web is supported. Two layers must agree on origins or sign-in fails in a confusing way:
  CORS (`middleware.ts`) and Better Auth's `trustedOrigins`, both fed by `backend/lib/web-origins.ts`.
  A passing CORS preflight proves nothing about auth — the auth layer returns `403 INVALID_ORIGIN`
  independently. Native never surfaces either problem (RN sends no `Origin` header).
- Web-only component implementations use the `*.web.tsx` platform split (`GradientText.web.tsx`,
  `ChartView.web.tsx`). `@react-native-masked-view` has **no real web implementation** — its
  `.web.js` renders the mask element and discards the children — so anything relying on it needs a
  web counterpart.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
