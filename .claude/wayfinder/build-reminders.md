# Build-Time & Post-Build Reminders

Items in this file were identified during post-completion analysis but deferred from pre-build spec work. They MUST be reviewed at the start of each relevant build phase and again after launch. Do not bypass these without documenting why.

---

## AT BUILD TIME — Must be decided before shipping the feature

### 1. Better Auth `encryptOAuthTokens` — Make the call, don't defer again
**Phase:** Auth setup (first backend sprint)
**Context:** Better Auth v1.5 introduced `encryptOAuthTokens: true` which encrypts OAuth tokens before DB storage natively. The spec currently mandates manual AES-256-GCM for all third-party tokens. These overlap.
**Decision to make:** Does `encryptOAuthTokens: true` handle the Google OAuth import tokens? If yes, remove the custom encryption path for Google tokens — manual AES-256 is then only needed for Plaid `access_token` and SnapTrade `auth_token`, which Better Auth does not manage. If no, document why and keep the full manual layer.
**Do not ship auth without making this explicit.** Leaving both in place silently is a maintenance liability.

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
