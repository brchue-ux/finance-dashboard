# Build-Time & Post-Build Reminders

Items in this file were identified during post-completion analysis but deferred from pre-build spec work. They MUST be reviewed at the start of each relevant build phase and again after launch. Do not bypass these without documenting why.

---

## AT BUILD TIME — Must be decided before shipping the feature

### 1. Better Auth `encryptOAuthTokens` — RESOLVED 2026-07-20: not applicable, keep the manual AES layer
**Phase:** Auth setup (first backend sprint)
**Context:** Better Auth v1.5 introduced `encryptOAuthTokens: true` which encrypts OAuth tokens before DB storage natively. The spec mandates manual AES-256-GCM for all third-party tokens. The concern was that these overlap.

**Decision: they do not overlap. `encryptOAuthTokens` has nothing to encrypt in this app — do not set it.** The setting only governs tokens Better Auth itself obtains and stores via its own OAuth/social-provider layer, and this app never uses that layer.

Verified against the running code and DB on 2026-07-20, not assumed:
- `lib/auth.ts` configures **only** `emailAndPassword` plus the `expo()` plugin. There is no `socialProviders` block, so Better Auth performs no OAuth flow.
- The Better Auth `account` table contains only `provider_id: "credential"` — no OAuth account rows exist.
- All four third-party tokens are obtained by this app's own routes and encrypted through `lib/crypto.ts`: Google Sheets (`lib/import/google.ts`) and Microsoft Graph/Excel (`lib/import/excel.ts`) into `spreadsheet_connections`, Plaid (`app/api/plaid/hosted-complete`), and SnapTrade (`app/api/snaptrade/connect`).

**Consequence:** the manual AES-256-GCM path stays as the single encryption mechanism for third-party credentials. There is no second, silent mechanism — which was the maintenance liability this item existed to prevent. Re-open only if Better Auth `socialProviders` is ever added (e.g. "sign in with Google"), at which point the tokens *it* stores would be a genuinely separate set from the import tokens above.

### 2. TradingView paid plan onboarding gate — Build the gate, not just a note
**Phase:** Alerts tab + Settings → Connected Accounts
**Context:** TradingView webhooks require at minimum the Essential plan. Free plan users will set up the app, configure alerts, and wait for data that never arrives. The spec now documents the plan requirement in §5.4 but does not specify how it's surfaced in the UI.
**Decision to make at build:** Where does the plan requirement appear?
- Option A: Hard gate in onboarding — "To use TradingView alerts, you need TradingView Essential or higher. Continue?"
- Option B: Soft indicator in Settings → Alerts setup screen — shows plan requirement inline
- Option C: Alerts tab shows empty state with explanation until first webhook is received
**Do not ship the Alerts tab without one of these implemented.** Silent failure is the worst outcome.

### 3. Twelve Data MCP — Verify free tier credit counting before wiring in
**Phase:** LLM advisory engine integration (when connecting MCP tools to Vercel AI SDK)
**Context:** `twelvedata/mcp` is the selected MCP server (vendor-maintained, HTTP transport, 130+ indicators). Decision locked 2026-07-16. Before wiring in:
- Confirm whether the MCP server batches multiple indicators per ticker into one API credit, or fires a separate credit per indicator. This determines real-world daily credit burn at solo scale.
- Confirm `TWELVE_DATA_API_KEY` is in Railway env vars before deploying.
- At build time the free tier (800 calls/day) is assumed sufficient. If daily usage consistently exceeds it during development, upgrade to Grow ($29/month) before launch.

### 4. Walmart receipt barcode → itemized digitization — BLOCKED on Walmart Canada, revisit
**Phase:** Transaction splits / receipt ingestion
**Status:** Deferred 2026-07-20. Not a design choice — the capability does not exist in Canada yet.
**Context:** Walmart paper receipts carry a barcode intended to be scanned in the Walmart app to
digitize an itemized list. **That feature is not shipped in Canada** (user-confirmed: the barcode
scans but leads nowhere). US parity would make this the cheapest possible path to line items.

Verified alongside it, so it isn't re-investigated from scratch:
- Walmart Canada e-receipt emails carry **no line items at all** — the body is an order number
  and a tracked link. Nothing to parse.
- The e-receipt page exposes exactly one GraphQL field:
  `GetReceiptImage` → `getReceiptImage(hash:ID!){content}`, persisted hash
  `793f1e7db1ce08440ec7af85f6c222b714ef8f65592095a28308e2c56635974d`.
  It returns an **image** of the receipt. No structured item data exists on this path, so any
  extraction from it is necessarily a vision/OCR problem, not parsing.
- `www.walmart.ca/orchestra/*graphql` is **PerimeterX-protected** (`appId PXnp9B16Cq`); an
  unattended server-side call returns **HTTP 412** with a `/blocked` challenge. PX fingerprints
  headless browsers, so Playwright relocates the fight rather than winning it. Automated
  zero-touch fetching is also squarely against Walmart's ToS.

**Revisit when:** Walmart Canada ships receipt-barcode scanning in its app. At that point
re-evaluate whether it yields structured items (preferred) or just an image.
**Do not, in the meantime,** build a PerimeterX-evading scraper — the realistic ceiling on the
current stack is one user tap per receipt (real browser session), which does not rot.

---

### 5. Merchant rules are Canada-only — revisit before any non-CA user
**Phase:** Categorization / import, whenever the user base stops being just Canada.
**Status:** Raised 2026-07-21. Deliberately deferred — the app is single-user and Canadian today.
**Context:** `lib/categorization.ts`'s `DEFAULT_RULES` is entirely Canadian merchants
(Loblaws, Tim Hortons, Presto, Petro-Canada, Rogers, Shoppers Drug Mart). This surfaced
concretely when a US-merchant CSV (Aldi, Safeway, Target, ExxonMobil, PG&E, Trader Joe's)
was imported into the test database: **41 of 50 rows came back `uncategorized`**, because
essentially nothing overlapped. The engine worked correctly — it simply had no rules that
could match.

**Why this matters more than it looks:** an uncategorized transaction is not a visible
error. It silently contributes to no envelope, so budgets under-report spending with no
warning. A US or EU user's first import would look like it succeeded while leaving most of
their spending invisible to the budget.

**When revisiting, decide:**
- Region-scoped rule sets (`DEFAULT_RULES_CA` / `_US` / `_EU`) chosen at onboarding, vs one
  merged global set. Merged is simpler but worsens the ordering hazard below.
- Currency: amounts are currently unit-less numbers. Multi-region implies a currency field
  and a display/aggregation decision, which touches budget math, reports and LLM context.
- **Ordering hazard compounds with size.** `categorize()` is first-match-wins by
  `sortOrder`, which is already why `TACO BELL` must be listed in Restaurants ahead of
  Utilities' `BELL`, and why `Costco Gas` matches Groceries' `COSTCO` instead of Transport.
  A larger multi-region rule set makes such collisions more likely, not less — consider
  most-specific-match rather than first-match before growing the list.
**Do not** simply append US/EU merchants to the existing Canadian arrays without addressing
the match-precedence question.

---

### 6. Envelopes must bend to the user, not the reverse — the remaining rigidity
**Phase:** Categorization / budget UX. Raised by the user 2026-07-21: *"envelope sets can't
be rigid or thrust upon and forced to conform. they need to be friendly to the users
categories."*
**Status:** One concrete bug found and FIXED (`4a5d345` — rename silently destroyed history,
because `transactions.category` / `transaction_splits.category` store the envelope *name*
and PATCH only updated the envelope row; proven at $400 → $0 before fixing). The rest below
is deliberately deferred.

**a. A user cannot recategorize a single transaction.** There is no route for it —
`/api/transactions/[id]` exposes only `/splits`. If the engine files a butcher under
Restaurants, the only recourse is editing rules and re-running a bulk recategorize. This is
the sharpest form of forcing conformity: the engine's guess is final. **Build a
`PATCH /api/transactions/:id` (category) plus a picker on the row.**

**b. There is no learning loop.** Even with (a), the next transaction from that merchant
repeats the mistake, because rules are hand-authored strings. A correction should teach the
rule — e.g. persist a per-user merchant→envelope override consulted ahead of
`DEFAULT_RULES`. Note this interacts with item 5: a growing rule set worsens the
first-match-wins ordering hazard.

**c. Derive the envelope set from the user's own spending instead of shipping a taxonomy.**
On 2026-07-21 a 16-envelope set was built **by hand** from this household's real merchants
(adding Insurance, Home & Hardware, Personal Care, Fitness & Recreation, Kids & Activities,
Cannabis, Travel, Home Services, Fees & Interest) and lifted categorization coverage from
**24% → 92% of spend** (925 uncategorized txns / $72,723 → 212 / $8,116). **Do not ship that
list as `DEFAULT_RULES`** — it encodes one Ontario household's life as everyone's starting
point, which is the same imposition with a longer list. **The reusable part is the method**:
cluster the user's actual merchants and *propose* — "here are nine categories we noticed in
your spending; keep, rename, or merge." Defaults become an editable proposal.

**d. Targets set from historical averages make over-budget the normal state.** Targets were
derived from 17 months of real averages ($5,255/mo across 16 envelopes). June 2026 then
showed **9 of 16 envelopes OVER** ($6,933 actual). That is arithmetically correct and was
deliberately NOT "fixed" by inflating targets — but a realistic month rendering as a wall of
red is a design question. Consider a *trending vs typical* framing rather than pass/fail when
the target is itself an average.

---

### 7. Import: warn about categories that match no envelope — DONE 2026-07-22 (`ede6922` backend, `0d4c854` frontend, device-confirmed)
Shipped as designed: `POST /api/import/csv/preview` (matched/unmatched with row counts +
near-miss suggestions via `lib/import/category-match.ts`), review step in the import UI,
user-confirmed `categoryMappings` on commit (validated pre-write; mapped rows get
`category_source=manual`). Bonus fix on ALL import paths: source categories now resolve to
the envelope's own spelling instead of storing case-variants verbatim. Plus an in-app
success state replacing the bare native alert.
**Phase:** Import. Raised 2026-07-21 alongside the sign-inversion guard (shipped, `1cd29f9`).
**Context:** A CSV carrying its own category column can import cleanly while most rows land
in categories that match no envelope — observed at **6 of 10 categories unmatched**, so those
rows contributed to no budget at all. Like the sign inversion, it is **silent**: 200 response,
`import_csv complete`, success message.
**Build:** before committing an import, report "6 of 10 categories don't match an envelope —
31 rows won't count toward any budget", and offer the obvious near-misses as a mapping
(Dining→Restaurants, Gas→Transport, Health→Healthcare).

---

### 8. Session survives a deleted or restored user for up to 30 days
**Phase:** Auth hardening. Found 2026-07-20 while swapping databases.
**Context:** `lib/auth.ts` sets `cookieCache: { enabled: true, maxAge: 30 days }`, so Better
Auth resolves a session from a **signed cookie with no DB lookup**. Pointing the server at a
different database left the client "logged in" as a user that did not exist there — every
query returned empty and every write failed `FOREIGN KEY constraint failed`, instead of a
clean 401.
**Why it matters beyond dev:** the same holds for a genuinely deleted account or a
restore-from-backup — the session stays valid for up to a month against a nonexistent user,
failing as empty screens and 500s rather than a login prompt.
**Build:** treat "session resolves but user row missing" as unauthenticated.

---

### 9. Confirm SnapTrade's ticker format for TSX holdings
**Phase:** Portfolio / market data. Found 2026-07-21.
**Context:** Yahoo needs an exchange suffix for Canadian listings — `VFV` fails schema
validation, `VFV.TO` returns 53 bars. Unpriceable tickers no longer 500 the Holding Detail
screen (`1fe1f82`, now degrades to "No price history for X"), **but it is unverified whether
SnapTrade returns bare or suffixed symbols.** If bare, every Canadian ETF in a real portfolio
takes the degraded path.
**Do:** on first live brokerage connect, inspect the returned `ticker` values; if bare, map
to an exchange suffix before calling market data.

---

### 10. Rebuild the test seed around a realistic taxonomy
**Phase:** Test fixtures. Raised by the user 2026-07-21: test data should be *accurate user
data*, with the build working around it — not data shaped so testing passes.
**Context:** `db/seed-test.ts` still generates 7 synthetic envelopes with `[TEST]` merchants
that no real rule matches. A CSV of US merchants imported during device testing left 41 of 50
rows uncategorized purely because the fixture and the rules came from different worlds.
**Do:** seed real Canadian merchants and the richer envelope set so the fixture exercises the
real matcher. Keep the `[TEST]` marker and the `/test/i` DATABASE_URL guard.

---

## POST-LAUNCH — Must be reviewed after the app has real usage

### 4. Scotiabank CDBA migration — Scheduled review H2 2027
**Context:** Plaid's Scotiabank connection is credential/scraping-based with 2–4 auth breaks/year expected. Canada's Consumer-Driven Banking Act (CDBA) Phase 1 read access is targeted for H2 2027. When Phase 1 goes live, migrating Scotiabank (and potentially Tangerine) to a CDBA-accredited provider will:
- Eliminate scraping-based breakage
- Provide standardized transaction data schema
- Activate the screen-scraping ban (non-compliant connections become illegal)
**Scheduled review:** Q3 2027 — assess CDBA Phase 1 scope, confirm Scotiabank and Tangerine are covered, evaluate migration from Plaid to a CDBA-accredited aggregator (or Plaid's own CDBA-compliant connection when available).
**Note:** The `BankSyncProvider` abstraction in the spec is specifically designed to make this a contained swap. Do not bypass the abstraction layer during the build.

### 5. Scotiabank relink frequency as churn signal — Track from day one
**Context:** Expected 2–4 Scotiabank auth breaks per year at single-user scale. At multi-user scale this compounds. Track relink events in the database (log each `ITEM_LOGIN_REQUIRED` event with timestamp and institution) from launch. If relink frequency for Scotiabank exceeds 4x/year/user on average, treat it as a churn risk requiring escalation (CDBA migration or Flinks commercial evaluation).

### 6. Tangerine transaction lag — Monitor for user confusion signal
**Context:** Tangerine transactions lag 5–9 days even on healthy connections. The LLM system prompt now includes a staleness flag for Tangerine data. Post-launch: if users are asking the LLM about spending that "should be there but isn't," the lag is causing confusion. Monitor this in conversation logs. If it's a recurring complaint pattern, evaluate whether a "Tangerine data is typically 5–9 days delayed" persistent banner in the Budget tab (not just a tooltip) is warranted.

### 7. LLM advisory quality at 12-month data rollover — Already in spec §11
**Context:** Already documented in spec §11.1. Included here for completeness — do not skip this review just because it's in the spec. Set a calendar reminder for 12 months post-launch.

### 8. Prompt cache TTL — Revisit if Anthropic changes TTL again
**Context:** TTL dropped from 60 min to 5 min in early 2026. The Batch API nightly analysis design (added to spec) accounts for this. Post-launch: if Anthropic increases the TTL again (or introduces a longer-TTL tier), the cost architecture can be simplified by reducing reliance on batch in favor of synchronous calls with warm cache.

---

*Last updated: 2026-07-16. Source: post-completion analysis + pre-build issue review.*
