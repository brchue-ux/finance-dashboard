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
