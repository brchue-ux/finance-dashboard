# Post-Completion Analysis — Wayfinder Planning Process

**Date:** 2026-07-16
**Analyst:** Claude Code (post-planning quality gate)
**Scope:** 12 tickets, 5 research finding documents, 1 spec

---

## Part 1 — Reasoning Quality Review (Per Ticket)

---

### Ticket 001 — Wealthsimple Data Access

**Question quality:** Good. Covered every realistic access vector — official API, unofficial GraphQL, scraping, CSV, and aggregators. The scope was broad enough to surface SnapTrade without knowing it in advance.

**Research thoroughness:** Strong. 40+ searches, identified all active libraries, mapped the entire graveyard of broken REST libraries, verified ToS text, documented the passkey migration risk timeline. The Hive Gateway migration finding — that Wealthsimple is actively migrating from Apollo + schema stitching, which creates a structural breaking-change risk for unofficial GraphQL clients — is a high-value, non-obvious finding that directly influenced the aggregator decision.

**Decision quality:** Correct. SnapTrade is the right call. The decision explicitly ruled out Wealthica for this project on the grounds of sales-gated access, which is correct. The reasoning is well-documented.

**Gaps:**
- The SnapTrade free tier description in the research findings says "Free sandbox tier for development / Production: ~$1.50 per connected user per month." Ticket 005 (grilling) says "free developer tier covers single-user at $0." The spec repeats this as "free tier ($0 for ≤5 connections)." **This is potentially wrong.** The research says sandbox is free; production is $1.50/user/month. Whether SnapTrade has a production free tier for a single user in a personal project — or whether production access requires paying — was never definitively confirmed. This distinction was glossed over. If SnapTrade requires payment for production even at 1 user, the cost section of the spec is wrong.

**Opportunities missed:**
- The research flagged Wealthica's Node.js SDK (`wealthica-sdk-js`) as directly usable. No evaluation of whether Wealthica's data coverage is meaningfully better for this specific use case (it was designed for Canadian investment portfolios). Given that SnapTrade's Canadian investment-specific data depth was flagged as a potential weakness, a brief head-to-head on data field coverage would have been worth doing. Not a blocker, but the spec names SnapTrade without establishing it has everything needed.

---

### Ticket 002 — TradingView Integration Surface

**Question quality:** Comprehensive. Covered all five integration surfaces (Lightweight Charts, widget embeds, Charting Library, Data Feed/UDF, webhooks/alerts) plus prior art.

**Research thoroughness:** Best research document in the batch. 70+ tool uses, 35+ searches. Notable findings that wouldn't be obvious without deep research: the Apache 2.0 license correction (not MIT as commonly cited), the 3-second webhook timeout (corrected from a commonly cited 5-second figure), the two distinct MCP server projects and the critical distinction between them, the Advanced Charts free license exclusion of personal projects, the Lightweight Charts v5 React Native gap (no native support, WebView required).

**Decision quality:** Correct. Lightweight Charts v5 + deepentropy, webhook alerts, widget embeds only for non-critical supplemental components. The reasoning is sound and well-evidenced.

**Gaps:**
- The research says the webhook timeout is **3 seconds** and explicitly notes this corrects a "previously noted" 5-second figure. The spec says "5 seconds." This is a direct, confirmed factual error in the spec. See Part 2.
- The research documents that TradingView webhook alerts require **at minimum the Essential plan** to use webhooks. The Free plan has no webhook access. The spec makes no mention of this requirement. A user following the spec who is on the TradingView Free plan will find their webhook endpoint never fires.
- The research clearly distinguishes the two MCP projects. The spec collapses them into a single reference to "tradesdontlie MCP server" without clarifying which one or what it actually does. See Part 2.
- Alert delivery reliability section (September 2025 data: ~25% drop rate during volatility spikes, November 2025 global outage) should have prompted a stronger design constraint. The spec says "best-effort delivery; stored in Turso" but doesn't quantify the failure rate or establish what happens to user experience when 1-in-4 alerts is dropped.

**Opportunities missed:**
- The `strategy.*` placeholders — which allow a single Pine Script strategy alert to communicate buy/sell direction and position size — are documented in research but not in the spec's webhook payload format. The spec's example payload hardcodes `"condition": "RSI Oversold"` rather than showing the dynamic strategy approach.
- The Intersection Observer lazy-load pattern for widget embeds (each loads 300-500KB from TradingView's CDN) was flagged in research but doesn't appear in the spec's UI section.

---

### Ticket 003 — Tech Stack Options (Research)

**Question quality:** Thorough scope — framework trade-offs, auth, database, deployment, scaling, bugs.

**Research thoroughness:** Strongest document in the set. 80+ tool uses. Surfaced major developments that required corrections: Maybe Finance archived (July 2025), Vercel AI SDK at v7 (not v4/v5), Better Auth 1.5 with `encryptOAuthTokens`, prompt cache TTL change from 60 min to 5 min, Node.js 22+ requirement for AI SDK v7, Railway actual cost reality ($15-50/month, not $5/month floor).

**Decision quality (Ticket 007, which this informed):** Solid. The separated architecture decision is correct. Better Auth, Turso + Drizzle, Railway are all defensible choices well-supported by the research.

**Gaps:**
- The Vercel AI SDK v7 ESM-only / Node.js 22+ requirement was surfaced in research and listed as a "Critical Warning" in the findings. The spec does not address Node.js version requirements anywhere — not in the deployment section, not in environment variables, not in the deployment checklist. If the Railway environment is running Node 18 or 20 (common defaults), the app will fail at runtime. See Part 2.
- Railway actual cost is documented as ~$15-25/month in research. The spec states "$5/mo" as the Railway plan cost. The spec should reflect actual expected cost, not the marketing floor. See Part 2.
- The research flags CVE-2025-29927 (Next.js middleware-only session protection bypassable via header spoofing). The spec's auth section describes AES-256 token encryption but says nothing about database session validation vs middleware-only protection. Better Auth defaults to database validation, so the app may be safe by default — but the spec doesn't acknowledge this vulnerability or confirm the mitigation.
- EAS Hosting (Expo's own hosting, recommended over Vercel for Expo web apps) was surfaced in research but the spec uses Vercel for the frontend. The research says "EAS Hosting is the recommended path for Expo apps." The spec doesn't acknowledge this alternative existed.

**Opportunities missed:**
- The MCP-first architecture pattern — build MCP servers per data source, let Claude query live data as tools rather than pre-assembling a context dump — was surfaced as a "2026 major opportunity" in the research. The spec's LLM advisory engine is context-injection-based (pre-assembled data per view). The MCP approach would be architecturally cleaner and more capable. The research explicitly recommended evaluating it; the spec doesn't acknowledge the trade-off.
- Better Auth 1.5's `encryptOAuthTokens: true` option was surfaced explicitly. The spec implements manual AES-256 encryption of tokens before writing to Turso. The research found that Better Auth can handle token encryption natively. This means the spec is rolling a custom encryption layer that a library feature could handle. See Part 2 for the token storage cross-reference.

---

### Ticket 004 — Budget Tracker Scope (Grilling)

**Question quality:** This is a grilling ticket (decision, not research), and the right questions were asked: who owns the data, what's the relationship with the Sheet, can the user edit budgets in-app.

**Decision quality:** Correct. App owns all data; Sheet is one-time historical import. The decision to make LLM-suggested reallocations require explicit user approval is sound and consistent with the overall design.

**Gaps:**
- The decision says "LLM resolves unknown merchants" for auto-categorization. The spec's categorization engine (Section 6) does not include an LLM fallback for unknown merchants — it categorizes the transaction as 'uncategorized' with no LLM step. These are inconsistent. The ticket decision says one thing; the spec implements something different. See Part 2.
- Ticket 004 references ticket 012 for bank aggregator research: "(See ticket 012 for Canadian bank aggregator research.)" Ticket 012 is listed with a higher number but presumably resolved before the spec was written. The blocking dependency chain appears correct in the tracker.

**Opportunities missed:**
- The grilling conversation established "Fast Food" and "Sit-Down Restaurants" as examples of the desired granular subcategory structure. The spec's system prompt uses "Restaurants" as a single envelope name in its example output card. No canonical default category list was ever defined in the spec. If the developer implements categories from memory, they'll likely use a coarser structure than what was decided here.

---

### Ticket 005 — Wealthsimple Sync Strategy (Grilling)

**Question quality:** Right questions. Covered access method selection, sync frequency, storage model, LLM trigger behavior, error handling, multi-user readiness.

**Decision quality:** Correct. The append-snapshot design (never overwrite) is the right call for LLM trend analysis. The 15-min staleness / 2-min debounce model is well-reasoned.

**Gaps:**
- Decision 1 states SnapTrade is free: "free developer tier covers single-user at $0." As noted in Ticket 001 analysis, this may conflate sandbox and production access. If production has a per-user charge, this decision's cost premise is wrong.
- The decision says "each sync appends a timestamped snapshot." The spec's sync strategy (Section 7) correctly implements this. No contradictions found here.

**Opportunities missed:** None significant.

---

### Ticket 006 — TradingView Integration Design (Grilling)

**Question quality:** Correct scope — chart library choice, data source, alert integration, portfolio overlay.

**Decision quality:** Correct. The decision to use Lightweight Charts v5 + deepentropy, Yahoo Finance for OHLCV, webhook for alerts, and full portfolio overlays is well-supported by the research from Ticket 002.

**Gaps:**
- Decision 3 documents the alert timeout as the webhook design constraint but uses the 5-second figure from the earlier research pass. The updated research corrected this to 3 seconds. By the time this grilling ticket was written, the finding may have been from the initial research run (which had 5 seconds). The spec carries the wrong figure. See Part 2.
- The flag for Ticket 010 at the bottom of this ticket says: "Evaluate `tradesdontlie` MCP server as a data source." The evaluation in Ticket 010 correctly selects it. But neither ticket nor spec establishes which of the two projects with nearly identical names is being selected. See Part 2.

**Opportunities missed:** None significant beyond what was already noted in Ticket 002 analysis.

---

### Ticket 007 — Tech Stack Selection (Grilling)

**Question quality:** This is a clean decision ticket that draws from Ticket 003 research. The right synthesis.

**Decision quality:** Correct. The separated architecture is correctly chosen over a monolith. The scale path section is well-constructed.

**Gaps:**
- No acknowledgment of the Node.js 22+ requirement for Vercel AI SDK v7. See Part 2.
- No mention of EAS Hosting as an alternative to Vercel for the Expo web build. Minor, but the research surfaced it as Expo's own recommended path.

**Opportunities missed:**
- The MCP architecture opportunity was not addressed at the decision stage. Ticket 003 research explicitly called it out. A grilling question about whether to build with MCP-first or context-injection-first would have been appropriate here. The spec went with context injection without explicitly rejecting MCP.

---

### Ticket 008 — Google Sheets Integration (Research)

**Question quality:** Appropriate scope for a one-time historical import use case. The question asked more broadly (real-time sync, polling, push notifications) than the decision required, which is fine — it produced findings relevant to a broader scope.

**Research thoroughness:** Strong. 60+ tool uses, 35+ searches. Surfaced the OAuth "Testing" status / 7-day refresh token revocation issue clearly, confirmed `UNFORMATTED_VALUE` is required for finance data, documented the exponential backoff pattern, found the `googleapis` auto-refresh bug (#2350).

**Decision quality:** The decision in Ticket 004 (retire the Sheet after one-time import) was the right call. The research findings support it.

**Gaps:**
- The `googleapis` auto-refresh bug (#2350) — where auto-refresh doesn't trigger without explicitly setting `expiry_date` in `setCredentials` — is documented in research but not reflected in the spec's GoogleSheetsAdapter description. The spec just says "OAuth 2.0 via `google-spreadsheet` npm" and "disconnects Google OAuth immediately after import completes." The import will fail mid-session if the access token expires during a large import and the `expiry_date` wasn't set. See Part 2.
- The research found that Google has announced quota overages will incur charges in late 2026. Given the import is one-time and small, this is not a practical risk, but it's worth noting.

**Opportunities missed:**
- Named ranges as a stable contract between app and Sheet structure — documented in research as high value, not relevant since the Sheet is a one-time import and is retired immediately. No missed opportunity here.
- The `google-spreadsheet` npm library's built-in exponential backoff retry was explicitly documented. The spec says only "OAuth 2.0 via `google-spreadsheet` npm" — it would be worth naming the library explicitly in the spec's implementation notes so the developer doesn't accidentally use the more verbose raw `@googleapis/sheets` package.

---

### Ticket 009 — Auth and Deployment (Grilling)

**Question quality:** Correct scope. Covered sign-up model, credential storage, CI/CD, custom domain, sync strategy.

**Decision quality:** Correct on substance. The seeded-account no-public-signup model is the right call for launch. AES-256 encryption before write to Turso is correct. The sync strategy decisions are well-reasoned.

**Gaps:**
- The Google OAuth "Testing" status gotcha (7-day refresh token revocation) from Ticket 008 research should have surfaced in the deployment checklist. The spec's deployment checklist (Section 10) has 10 steps. None of them mention Google Cloud OAuth consent screen publishing status. This is a real deploy-day trap: import will fail after 7 days during development if the OAuth app is in Testing status. See Part 2.
- Better Auth 1.5's `encryptOAuthTokens` option was surfaced in Ticket 003 research. The spec's auth section describes manual AES-256 encryption. These two approaches should be reconciled — either use the library feature or document why the manual approach is preferred.

**Opportunities missed:** None significant.

---

### Ticket 010 — LLM Advisory Engine Design (Grilling)

**Question quality:** Comprehensive. The right questions — trigger model, context per view, system prompt design, tool use, output structure, streaming vs batch, token budget.

**Decision quality:** Strong. The sync-delta trigger (only run LLM when new data exists since last analysis) is a well-reasoned approach that controls cost. The batch-render vs streaming distinction is correctly applied.

**Gaps:**
- Token budget section estimates "per session: ~5,000–8,000 tokens." The spec shows a slightly different range: "4,000–7,000 tokens per auto-analysis session." Inconsistency between the ticket decision and the spec on the same item. Minor, but if either figure is used to project cost, the wrong one may be used.
- The token budget analysis was done under the old prompt cache TTL assumption (60 minutes) or possibly without explicitly accounting for the change. The research (Ticket 003) documents the TTL drop from 60 to 5 minutes and flags it as a 30-60% effective cost increase for apps with sporadic usage. The spec's token budget section says "prompt caching: system prompt + static context cached via Vercel AI SDK; repeated tokens billed at ~10% of normal input price." This is technically accurate for cache hits — but it doesn't account for the new 5-minute TTL, which means for a personal finance app (typically opened once or twice a day), the cache will almost never be warm. The $1-3/month estimate may be low. See Part 2.
- The `tradesdontlie` MCP server is described as "self-hosted on Railway" in the spec. The research is clear that `tradesdontlie/tradingview-mcp` (4,200 stars) is a **development-time tool** that requires TradingView Desktop running locally and connects via Chrome DevTools Protocol on port 9222. It cannot be deployed to Railway as a production server. See Part 2 for the full treatment of this issue.

**Opportunities missed:**
- The human-in-the-loop feature in Vercel AI SDK v6+/v7 (`needsApproval: true` on tool calls) is directly applicable to a finance app where Claude suggests budget reallocations. The spec implements this logic manually (Claude generates action cards, user taps Approve/Dismiss). The AI SDK feature would handle the pause-and-resume cycle natively. Not a blocker, but a missed integration point.

---

### Ticket 011 — UI Structure and Tabs (Prototype)

**Question quality:** Correct. This is a prototype ticket, not a research ticket, and it correctly asks for something to react to.

**Decision quality:** The UI design in the spec is cohesive and well-specified. The prototype (ui-prototype.html) apparently drove the design.

**Gaps:**
- The Lightweight Charts v5 React Native integration gap (WebView required, no native support) surfaced in Ticket 002 research is not addressed anywhere in the UI section. The spec describes the mobile experience as "same full chart experience as web" but in Ticket 006 the decision acknowledges "Lightweight Charts on mobile — same full chart experience as web. Touch events configured explicitly." The implementation detail — that this requires a WebView wrapper on Android, not native JS integration — should be in the spec for the developer building it.
- The spec calls Lightweight Charts "MIT licensed" in the tech stack table (Section 2). The research corrected this: it is **Apache 2.0 licensed**. This is a minor but factual error.

**Opportunities missed:** The TradingView economic calendar widget lazy-loading pattern (Intersection Observer, to avoid loading 300-500KB per widget on page load) was surfaced in research and would have belonged in the Portfolio Screen spec. Not in spec.

---

### Ticket 012 — Canadian Bank Aggregator (Research)

**Question quality:** Precise and well-scoped. The 6 accounts were listed explicitly; the research criteria were clear.

**Research thoroughness:** Solid. 4 parallel subagents, covered all candidates. The Wealthica RBC-2FA-on-every-sync finding is a critical blocker for Wealthica and was correctly surfaced and documented. The Tangerine 5-9 day transaction lag finding is valuable operational information that belongs in the spec.

**Decision quality:** Correct. Plaid is the right choice for all the documented reasons.

**Gaps:**
- The research documents the Tangerine transaction lag of 5-9 days "even when the connection is healthy." The spec's sync strategy says "Daily at 2am via Railway cron. Syncs all data sources. Ensures trend history is never gapped." The user's budget view could show spending data that is 5-9 days stale for Tangerine transactions even after a successful sync. The spec's user-facing text ("Tangerine connection needs attention — tap to reconnect") handles the auth failure case but not the data lag case. A user may reconnect successfully and still see outdated Tangerine data.
- The research notes Scotiabank is "credential/scraping-based" with estimated 2-4 auth breaks per year. The spec documents the relink flow for Tangerine specifically but doesn't note that Scotiabank is also fragile. The `relink_required` status handling applies to both — but the spec's prose only calls out Tangerine by name.

**Opportunities missed:** None significant.

---

## Part 2 — Spec Corrections Required

These are ordered by severity (breaking issues first, then factual errors, then missing information).

---

### CRITICAL: Wrong MCP Server Referenced

**Spec location:** Section 2 (Tech Stack table), Section 5.5, Section 8 (Tool Use), Section 11 (Post-Launch Review)

**What the spec says:**
> `tradesdontlie` MCP server — Self-hosted alongside Railway backend. Exposes TradingView indicator data (RSI, MACD, moving averages, volume analysis, technical summary) as MCP tools that Claude can call during advisory sessions.

**What research found:**
There are two distinct projects:
- `tradesdontlie/tradingview-mcp` (4,200 stars): Connects Claude Code to **TradingView Desktop app** via Chrome DevTools Protocol on port 9222. It is a **development-time tool**. It requires TradingView Desktop to be running locally. It cannot be deployed to Railway or any server. It has no concept of a "server" — it is a local MCP bridge to the user's local TradingView Desktop instance.
- `atilaahmettaner/tradingview-mcp` (3,548 stars): A Python-based MCP server that fetches from TradingView's public data endpoints. Can be self-hosted or used via a $9-29/month hosted service. This is the one that could plausibly be "self-hosted alongside Railway backend."

The spec references the repo by the `tradesdontlie` author name, which points to the first project — the one that is categorically impossible to deploy as a production server. If implemented as written, this would fail completely.

**What the spec needs:**

Section 5.5 header: Change to `atilaahmettaner/tradingview-mcp` and clarify it is a Python-based MCP server.

Add a note: "The `tradesdontlie/tradingview-mcp` project (which shares a similar name) is a different tool — a local Claude Code bridge to TradingView Desktop via Chrome DevTools. It is useful during development but cannot be deployed as a production service."

Flag: ToS risk for `atilaahmettaner/tradingview-mcp` (uses unofficial TradingView endpoints) is documented in research. The spec correctly notes this at Section 5.5 but applies it to the wrong project.

Section 11 (Post-Launch Review item 5): "tradesdontlie MCP reliability" — same correction applies.

---

### CRITICAL: Vercel AI SDK v7 Requires Node.js 22+

**Spec location:** Section 2 (Tech Stack), Section 10 (Deployment / Environment Variables), nowhere in deployment checklist

**What the spec says:**
Nothing about Node.js version requirements. Backend is described as "Next.js API routes" on Railway. Vercel AI SDK is listed as `streamText` in the stack table.

**What research found:**
Vercel AI SDK v7 (current stable as of July 2026) is ESM-only and requires Node.js 22+. Node 18 and Node 20 are dropped. This is listed as a "Critical Warning" in the research findings.

**Impact:** If the Railway environment runs Node 18 or 20 (Railway's default varies; older projects often run Node 18), the backend will fail to start. This is a deploy-time breakage, not a runtime warning.

**Required spec additions:**
- Section 10, Environment Variables: Add `NODE_VERSION=22` (or `>=22`) as a Railway environment variable.
- Section 10, Deployment Checklist: Add step: "Confirm Railway is running Node.js 22+. Set `NODE_VERSION=22` in Railway environment variables if not already the default."
- Section 2, Tech Stack: Add to the Vercel AI SDK row: "Requires Node.js 22+ (ESM-only as of v7)"

---

### CRITICAL: TradingView Webhook Timeout Is 3 Seconds, Not 5

**Spec location:** Section 5.4

**What the spec says:**
> return 200 within 5 seconds (TradingView drops after 5s)

**What research found:**
Research findings (Section 6, page 2) explicitly state: "3-second timeout (not 5 as previously noted — official docs confirm 3 seconds including DNS resolution time)." The 5-second figure is described as a correction of a prior finding.

**Impact:** The spec's processing budget is 67% larger than reality. Code designed to work within 5 seconds may fail at 3 seconds if any I/O is performed before returning 200.

**Required spec change:**
Section 5.4: Change "return 200 within 5 seconds" to "return 200 within 3 seconds (TradingView drops after 3s, including DNS resolution time)."

---

### HIGH: Prompt Cache TTL Changed to 5 Minutes; Cost Estimates May Be Wrong

**Spec location:** Section 8, Token Budget

**What the spec says:**
> Prompt caching: system prompt + static context cached via Vercel AI SDK; repeated tokens billed at ~10% of normal input price
> Expected monthly cost: ~$1–3 for normal single-user usage

**What research found:**
"Anthropic changed prompt cache TTL from 60 minutes to 5 minutes in early 2026. This change increased effective API costs by 30-60% for many production apps. For a personal finance app with sporadic usage (user returns every few hours), the 5-minute TTL means the system prompt cache will almost always be cold."

**Impact:** A user who opens the app twice a day — typical for a finance dashboard — will have a cache hit rate of approximately 0% for their advisory sessions, since sessions are hours apart and the TTL is 5 minutes. The cost estimate of $1-3/month was calculated assuming effective caching. Without warm cache, costs would be closer to the uncached rate for all tokens.

Re-estimated monthly cost at 2 sessions/day, 5,500 tokens input, ~$3/MTok (Claude Sonnet input rate, uncached): ~$0.01/session × 60 sessions/month = ~$0.66/month. The $1-3 estimate may still be directionally correct but for the wrong reason (the estimate assumed cache savings; the actual cost without cache savings happens to be similar because of light usage volume). However, the mechanism is wrong in the spec.

**Required spec changes:**
Section 8, Token Budget:
- Add: "Note: Anthropic's prompt cache TTL is 5 minutes (as of early 2026, changed from 60 minutes). For sporadic personal app usage (sessions hours apart), the cache will almost always be cold. Cost estimates above reflect this — caching is not assumed to provide significant savings for infrequent usage patterns."
- Consider adding: "If running nightly batch analysis (e.g., weekly financial summaries), use Anthropic's Batch API (50% discount) rather than synchronous calls."

---

### HIGH: Google OAuth "Testing" Status Will Revoke Refresh Tokens Every 7 Days

**Spec location:** Section 10, Deployment Checklist

**What research found:**
"If your Google Cloud project's OAuth consent screen publishing status is 'Testing' (not 'Published'), Google revokes all refresh tokens after 7 days. This means: during development, all connected users will be logged out every 7 days. Fix: move OAuth app to 'Published' status, or add all test users to the allowed list."

**What the spec says:** The deployment checklist (10 steps) makes no mention of OAuth consent screen status. The historical import pipeline depends on Google OAuth refresh tokens persisting.

**Impact:** During development, the Google OAuth token will be revoked 7 days after connecting. The user's historical import will fail with `invalid_grant` if they don't complete the import within the first 7 days. Since historical import is a one-time event at setup, this may not be catastrophic in practice — but it will cause a confusing failure with no explanation.

**Required spec addition:**
Section 10, Deployment Checklist: Add step (before the Google Sheets import step): "If using Google OAuth for historical data import: ensure the Google Cloud project's OAuth consent screen is set to 'Published' (not 'Testing'). In Testing status, refresh tokens are revoked after 7 days. Alternatively, add your own email to the test user allowlist."

---

### HIGH: Better Auth `encryptOAuthTokens` Not Used

**Spec location:** Section 3 (Credential Storage)

**What the spec says:**
> All third-party tokens encrypted before writing to Turso using AES-256-GCM. Encryption key stored in Railway environment variable `ENCRYPTION_KEY`.

**What research found:**
Better Auth v1.5 introduced `encryptOAuthTokens: true` as a direct configuration option that encrypts OAuth tokens before database storage natively, without the developer implementing AES-256 logic. This is directly relevant to Plaid access token and SnapTrade auth token storage.

**Impact:** Not breaking — the manual AES-256 approach described in the spec works correctly. However, the spec is building a custom encryption layer that overlaps with a library feature now available in the exact auth library the app is using. This increases code surface area unnecessarily. The custom implementation needs to be tested, audited, and maintained; the library feature is tested by the library maintainers.

**Required spec decision (not a hard correction, but a clarification):**
Section 3, Credential Storage: Add a note evaluating whether `encryptOAuthTokens: true` in Better Auth covers the needed token types (Plaid access tokens, SnapTrade tokens) or whether manual AES-256 is still required for tokens Better Auth doesn't manage. If Better Auth's option handles Google OAuth tokens for the import flow, manual encryption may only be needed for Plaid and SnapTrade tokens (which are not OAuth tokens managed by Better Auth's session layer).

---

### MEDIUM: Lightweight Charts License Is Apache 2.0, Not MIT

**Spec location:** Section 2, Tech Stack table

**What the spec says:**
> Charts | Lightweight Charts v5 + deepentropy | 446+ indicators; MIT licensed; self-hosted

**What research found:**
"Apache 2.0-licensed (not MIT — corrected from prior finding)"

**Impact:** Apache 2.0 and MIT are both permissive licenses; this doesn't affect what can be built. However, the spec contains a factual error, and Apache 2.0 has a patent termination clause that MIT does not. For a personal project this is irrelevant, but the spec should be accurate.

**Required spec change:**
Section 2, Tech Stack: Change "MIT licensed" to "Apache 2.0 licensed"

---

### MEDIUM: Railway Cost Listed as "$5/mo" — Actual Cost Is ~$15-25/mo

**Spec location:** Section 2 (Tech Stack table), Section 10 (Deployment table)

**What the spec says:**
> Backend | Railway | Starter ($5/mo)

**What research found:**
"The $5/month entry is a floor, not a ceiling. Budget ~$15-25/month for a Next.js API + SQLite/small Postgres workload."

**Impact:** Budget expectations are wrong. The developer expecting $5/month will see a larger bill. Not a functional issue but relevant for the scale path cost analysis.

**Required spec change:**
Section 2: Add parenthetical: "$5/mo minimum; typical cost $15-25/mo for full-stack workload"
Section 10: Update the plan column from "Starter ($5/mo)" to "Starter ($5/mo minimum; ~$15-25/mo actual)"

---

### MEDIUM: TradingView Webhooks Require a Paid Plan

**Spec location:** Section 5.4

**What the spec says:**
The section describes webhook setup with no mention of TradingView plan requirements.

**What research found:**
TradingView Free plan: no webhook access. Webhooks require at minimum the Essential plan. The research table shows this explicitly.

**Impact:** A developer or user on TradingView's free plan will set up the webhook endpoint, set up the TradingView alert with a webhook URL, and the alert will silently never fire. No error is shown in TradingView when webhook delivery fails on free plans.

**Required spec addition:**
Section 5.4: Add: "TradingView plan requirement: webhooks are not available on the TradingView Free plan. At minimum, the Essential plan is required for webhook delivery. The Premium plan is recommended for production use — it includes 800 active alerts with no expiry, vs Essential's 20 alerts with ~60-day expiry."

---

### MEDIUM: LLM Unknown Merchant Resolution Inconsistency

**Spec location:** Section 6 (Categorization Engine) vs. Ticket 004 decision

**What the spec says (Section 6):**
> No match → set `category = 'uncategorized'`, flag for user review

**What Ticket 004 decided:**
> Auto-categorization: fully automatic, high accuracy required. Merchant-to-category mapping defined at setup; **LLM resolves unknown merchants.**

**Impact:** The spec's categorization engine sends uncategorized transactions to user review. The ticket decision says LLM resolves them. These are different designs. The spec's implementation skips the LLM step for unknowns.

**Required spec decision:**
One of these must be the implementation:
A) LLM is called for uncategorized transactions as a second-pass fallback (adds latency and cost per transaction)
B) Uncategorized transactions go to user review queue (simpler, lower cost, what the spec currently describes)

Recommend option B (current spec) because option A would trigger an LLM call on every new uncategorized transaction during sync, which conflicts with the design principle that LLM never runs on sync (Section 7). Document this explicitly in Section 6 to close the inconsistency with Ticket 004.

---

### LOW: Tangerine Transaction Lag Not Documented

**Spec location:** Section 5.1

**What the spec says:**
The Tangerine known issue section covers the MFA bug and relink frequency but not transaction freshness lag.

**What research found:**
"Tangerine only pushes transaction data every 5–9 days even when the connection is healthy — same-day or next-day transactions are not reliably available."

**Impact:** User may connect Tangerine successfully, sync successfully, and still see spending data that is up to 9 days stale. This could cause confusion ("I spent $200 at the grocery store three days ago but it's not showing up"). The spec's budget advice quality depends on transaction recency.

**Required spec addition:**
Section 5.1 (Tangerine known issue): Add: "Transaction freshness lag: Even with a healthy Tangerine connection, transaction data may be 5-9 days delayed. This is a Tangerine-side limitation, not an aggregator bug. Surface this to the user in the Tangerine connection status display: 'Tangerine transactions may take up to 9 days to appear.'"

---

### LOW: Scotiabank Fragility Not Called Out

**Spec location:** Section 5.1

**What the spec says:**
Only calls out Tangerine by name as having known issues.

**What research found:**
"Scotiabank: credential/scraping-based; estimated 2-4 auth breaks per year. No formal API deal means it's fragile to Scotiabank-side changes."

**Required spec addition:**
Section 5.1: Add a Scotiabank known issue paragraph: "Scotiabank connection stability: Plaid's Scotiabank connection is credential/scraping-based (no formal bank API deal as of 2026). Estimated 2-4 auth breaks per year when Scotiabank changes their web UI or auth flows. The `ITEM_LOGIN_REQUIRED` webhook handles this the same as Tangerine relinks. Reliability: MEDIUM."

---

### LOW: `googleapis` Auto-Refresh Bug Not Noted in Import Implementation

**Spec location:** Section 5.6 (Historical Data Import Pipeline)

**What research found:**
"Known issue (googleapis/google-api-nodejs-client #2350): Auto-refresh does not always trigger without explicitly setting `expiry_date` in `setCredentials`. Pattern: include `access_token`, `refresh_token`, AND `expiry_date` when calling `setCredentials`."

**Required spec addition:**
Section 5.6, GoogleSheetsAdapter: Add: "When initializing the Google OAuth client, always pass `expiry_date` alongside `access_token` and `refresh_token` in `setCredentials`. The auto-refresh mechanism does not reliably trigger without `expiry_date` set (googleapis/google-api-nodejs-client #2350)."

---

## Part 3 — Missed Opportunities

---

### MCP-First Architecture Was Not Seriously Evaluated

The research surfaced a significant architectural pattern: build MCP servers for each data source (Wealthsimple/SnapTrade, bank transactions, market data), connect Claude via Vercel AI SDK v7's stable MCP support, and let Claude query live financial data as tool calls during streaming responses rather than pre-assembling a context dump.

The spec uses context injection — assembling a block of data before the LLM call and sending it as a prompt. This is functional, but MCP-first has advantages: Claude asks for exactly what it needs, data can be fetched live rather than from the cached Turso snapshot, and the advisory context is not capped by what the developer pre-assembled.

The research didn't recommend it for this app (it noted it as more complex infrastructure), and the current approach is valid. But the question of "context injection vs. MCP-first" was never explicitly debated at the decision level — it was just left as an opportunity. A grilling ticket asking "should we build MCP servers for each data source or use pre-assembled context?" would have produced a documented decision either way.

For this build: context injection is fine. But if the app's LLM quality feels shallow after launch, MCP-first is the first architectural change to consider.

---

### Vercel AI SDK Human-in-the-Loop Tool Approval Not Used

Vercel AI SDK v6+/v7 has a `needsApproval: true` flag on tool definitions that causes the agent to pause and present the pending tool call to the user before executing it. This is designed for exactly the pattern the spec implements manually: Claude proposes a budget reallocation, user approves or dismisses.

The spec implements this via structured JSON output (action cards with Approve/Dismiss buttons) + custom database state tracking. That works. But the AI SDK feature would handle the approve/pause/resume cycle as a first-class feature, with less custom code. The spec's approach requires parsing structured JSON output from Claude, rendering action cards, tracking dismissals in the database, and preventing re-suggestion within the same calendar month. The SDK approach handles the pause-and-resume at the SDK layer; the app would just implement the UI.

The research documented this feature clearly. It wasn't evaluated as an alternative implementation path.

---

### EAS Hosting as Frontend Platform

Expo now has EAS Hosting as the recommended deployment path for Expo web apps. It provides tighter integration with the native build pipeline (same toolchain for web and native builds), preview URLs per branch (useful for testing before deploy), and native Expo OTA update support.

The spec uses Vercel for the frontend without acknowledging EAS Hosting exists. For a project that is already using EAS Build for the Android APK, using EAS Hosting for the web build would consolidate the Expo workflow into a single platform. This is worth considering at build time.

---

### Batch API for Nightly Analysis

The research found that Anthropic's Batch API provides 50% discount on all API calls. For the daily 2am background sync, the app could also run a nightly analysis batch job at the same time — assembling advisory context for both Budget and Portfolio views and submitting them as batch requests, getting results back within a few hours. Morning users would see fresh AI analysis without any latency.

The spec's LLM trigger model is synchronous (runs when user opens the view with new data). A hybrid approach — batch analysis nightly, synchronous for alert-triggered analysis — would reduce the per-session cost by 50% for the daily scheduled analysis and improve perceived performance (cards are already generated when the user opens the app).

Not required, but the research explicitly surfaced this optimization and it wasn't considered in the spec.

---

### TradingView Plan Requirement in Alert Setup UX

The spec describes a "Set up TradingView alerts" deployment checklist step without noting that webhooks require a paid TradingView plan. A user who sets up the app from scratch on a TradingView Free plan will be confused when alerts never arrive. The onboarding flow or settings screen should detect whether webhook delivery is configured and surface a note about TradingView plan requirements. This is a small UX detail with outsized confusion potential.

---

## Part 4 — Verdict

**The spec is not ready to build as-is. It requires corrections before execution begins.**

The CRITICAL issues represent defects that will cause the app to fail in obvious ways:

1. The `tradesdontlie` MCP server reference points to a dev-time local tool, not a production server. Building it as written will either not compile or produce a non-functional service. This affects a named component in the tech stack table.

2. Vercel AI SDK v7 requires Node.js 22+. If Railway is on Node 18 or 20, the backend will not start. This is a first-deploy blocker.

3. The webhook timeout is 3 seconds, not 5. Any implementation that does synchronous I/O before returning 200 (even a Turso write) runs a real risk of timeout. The design principle of "write and return immediately" is correct, but the stated deadline is wrong and could mislead the implementation.

The HIGH issues are not launch-blockers but will cause real problems within weeks of deployment:

4. The prompt cache TTL change means cost estimates and the caching assumption in the spec are both wrong. Not catastrophic at personal use scale, but the spec claims something that isn't true about how the cost works.

5. The Google OAuth "Testing" status trap will silently break historical import after 7 days in development. Anyone following the spec who hits this will spend time debugging what looks like a random auth failure.

6. Better Auth's `encryptOAuthTokens` option being ignored means the spec implements a custom encryption layer where a library feature exists. Not wrong, but unnecessary complexity.

### Required Line-Level Edits Before Building

| Location | Change |
|---|---|
| Spec §2, Tech Stack table — Lightweight Charts row | "MIT licensed" → "Apache 2.0 licensed" |
| Spec §2, Tech Stack table — Vercel AI SDK row | Add: "ESM-only; requires Node.js 22+" |
| Spec §2, Tech Stack table — TradingView data row | Change "tradesdontlie MCP server" → "atilaahmettaner/tradingview-mcp (Python MCP server)" |
| Spec §2, Tech Stack table — Railway row | "$5/mo" → "$5/mo minimum; ~$15-25/mo typical" |
| Spec §5.4, TradingView Alerts — timeout | "within 5 seconds (TradingView drops after 5s)" → "within 3 seconds (TradingView drops after 3s, including DNS resolution)" |
| Spec §5.4, TradingView Alerts — new paragraph | Add TradingView plan requirement: webhooks require Essential plan minimum; Premium recommended for production |
| Spec §5.5, `tradesdontlie` MCP Server — entire section | Rewrite to reference `atilaahmettaner/tradingview-mcp`. Add note distinguishing from `tradesdontlie/tradingview-mcp` (local CDP tool, dev-time only, cannot be deployed as a server) |
| Spec §5.6, GoogleSheetsAdapter | Add: always set `expiry_date` in `setCredentials` (googleapis #2350) |
| Spec §6, Categorization Engine — "No match" case | Add explicit note: LLM is NOT called for uncategorized transactions (contradicts Ticket 004 decision; document this as intentional to avoid LLM-on-sync) |
| Spec §8, Token Budget | Add: "Prompt cache TTL is 5 minutes (changed from 60 min in early 2026). For sporadic personal app usage (sessions hours apart), the cache will be cold. Cost estimates reflect uncached rates." |
| Spec §10, Deployment Checklist | Add step: "Confirm Railway Node.js version is 22+. Set NODE_VERSION=22 in Railway env vars." |
| Spec §10, Deployment Checklist | Add step: "Set Google Cloud OAuth consent screen to Published status (prevents 7-day refresh token revocation in Testing mode)." |
| Spec §10, Deployment table — Railway row | "Starter ($5/mo)" → "Starter ($5/mo min; ~$15-25/mo actual)" |
| Spec §11, Post-Launch Review item 5 | Correct project name from "tradesdontlie MCP" to "atilaahmettaner/tradingview-mcp" |

Additionally, the following should be added to the spec before it is considered final:

- Scotiabank connection stability note (§5.1): credential/scraping-based, 2-4 breaks/year expected
- Tangerine transaction lag note (§5.1): 5-9 day freshness lag even on healthy connections
- Better Auth `encryptOAuthTokens` evaluation (§3): document whether this replaces or supplements manual AES-256 for the app's token types

---

*Analysis complete. The planning process was generally thorough and the core architectural decisions are sound. The spec's defects are correctible before building begins. None require re-doing any research or re-opening any decisions — they are editorial and factual corrections to a document that got the big things right.*
