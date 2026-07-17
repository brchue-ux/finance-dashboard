# Research Findings: Wealthsimple Data Access Options

**Ticket:** 001-wealthsimple-data-access
**Initial date:** 2026-07-15
**Updated:** 2026-07-16
**Agent searches:** 40+ web searches across both sessions covering all 12 required topic areas

---

## 1. Official API

**Does not exist.** Wealthsimple has no public developer portal, no API key issuance, no OAuth flow for third-party applications. No official programmatic access path is available as of July 2026.

Wealthsimple's own help centre confirms: open banking is described as something that "will allow you to share financial data" — framed in the future tense, confirming it is not live yet. No developer partner program, no beta API access program, and no announced timeline for a first-party developer API has been found.

---

## 2. Unofficial GraphQL API (CURRENT — RECOMMENDED FOR DIRECT ACCESS)

Wealthsimple's web app communicates with an internal GraphQL endpoint at `my.wealthsimple.com/graphql`. This is the current target for unofficial integrations. Wealthsimple internally uses GraphQL Hive (via The Guild) as their schema management and gateway layer, and is actively migrating from Apollo Server with schema stitching to Hive Gateway. This migration is a material breaking-change risk for unofficial clients — see Section 8.

### Active Libraries

**`gboudreau/ws-api-python`**
- PyPI package: `ws-api`
- Last release: June 2026 (actively maintained as of research date)
- Language: Python
- Exposes: all account types, balances, holdings, transactions, performance history
- Auth: email/password + TOTP (2FA via authenticator app)
- Token management: automatically saves tokens to OS keyring with env var fallback; `refresh_access_token()` method handles expiry; tokens include `access_token`, `refresh_token`, `created_at`, `expires_in` fields
- GitHub: https://github.com/gboudreau/ws-api-python
- PyPI: https://pypi.org/project/ws-api/

**`gboudreau/ws-api-php`**
- Language: PHP
- Same author, same GraphQL endpoint, similar capability set
- GitHub: https://github.com/gboudreau/ws-api-php
- Packagist: https://packagist.org/packages/gboudreau/ws-api-php

**`henryhuangh/wealthsimple-python`**
- Second active option
- Adds WebSocket support for more real-time data
- Language: Python
- GitHub: https://github.com/henryhuangh/wealthsimple-python

### Abandoned / Legacy GraphQL Wrappers

**`anthfran/wealthsimple-node`**
- A Node.js Wealthsimple API wrapper built for HackThe6 hackathon
- Status: **abandoned** — developer explicitly states "development on this has been halted, as the developer does not have valid API credentials after HackThe6 has been completed"
- This is the only known Node.js GraphQL wrapper; it is not usable
- GitHub: https://github.com/anthfran/wealthsimple-node

### Data Available via GraphQL
- Account balances (all account types: TFSA, RRSP, non-reg, crypto)
- Holdings (securities, quantities, market values)
- Transactions (trades, dividends, deposits, withdrawals)
- Performance history (time-weighted returns, benchmarks)
- Account metadata

### For a Node.js/TypeScript App (Critical Gap)
There is **no maintained Node.js GraphQL client** for the Wealthsimple API. The only option (`anthfran/wealthsimple-node`) is explicitly abandoned. A Node.js app would need to:
1. Call the GraphQL endpoint directly with raw `fetch`/`axios`, reverse-engineering queries from the Python library source
2. Run a Python sidecar service (`ws-api-python`) and call it via HTTP from the Node.js backend
3. Use an aggregator (SnapTrade or Wealthica) instead — this sidesteps the problem entirely

Option 2 (Python sidecar) is the lowest-effort path for direct access. Option 3 is the most robust.

---

## 3. Legacy REST Libraries (BROKEN — DO NOT USE)

All of these target the deprecated `trade-service.wealthsimple.com` REST API, which no longer exists:

| Project | Language | Status |
|---------|----------|--------|
| `wstrade-api` (ahmedsakr) | JavaScript/npm | Broken — dead endpoint |
| `Wsimple` (yusuf8ahmed) | Python/PyPI | Broken — dead endpoint |
| `MarkGalloway/wealthsimple-trade` | API Docs | Broken — documents dead REST API |
| `bufutda/wealthsimple-api` | API Docs | Broken — documents dead REST API |
| `seansullivan44/Wealthsimple-Trade-Python` | Python | Broken — dead endpoint |
| `Jspsun/UnofficialWealthsimpleApi` | JavaScript | Broken — dead endpoint |

**Do not use any of these.** They will fail at runtime. All target a REST API that Wealthsimple decommissioned when they migrated to GraphQL.

---

## 4. Browser Automation / Scraping

**Not recommended.** Direct GraphQL calls (Section 2) are simpler, more reliable, and produce cleaner data. Additionally:

- Wealthsimple launched **passkey support in beta in February 2026** (confirmed by iPhone in Canada news coverage)
- As of July 2026, passkeys are **optional but promoted** — email/password + TOTP still works
- Official Wealthsimple documentation says "you can always use your email and password" — no mandatory enforcement yet
- However, Wealthsimple offers an **account guarantee** (reimbursement for unauthorized transactions) contingent on having passkeys enabled — creating financial pressure for users to migrate
- Full passkey enforcement timeline is unknown, but the incentive structure strongly suggests eventual mandatory adoption
- **Risk window:** headless login via email/password + TOTP is expected to close within the next 12-24 months. Any Playwright/Puppeteer automation built today carries this deadline

---

## 5. CSV / Manual Export

Wealthsimple has native CSV export built into the web UI. As of 2026:

### What Is Exportable
- **Activity/Transactions:** buys, sells, deposits, withdrawals, dividends, options exercises, options expiry, options assignments
- **Holdings:** current holdings snapshot including account details, security information, position quantities, market values, and book values
- **Not included in activities CSV:** chequing account activities, crypto staking, crypto swaps

### Limitations
- Manual process — requires human action each time
- Not automatable via official means
- Suitable only for one-time import or periodic manual sync

### Enhancement Tools
- **`dizzlkheinz/wealthsimple-csv-exporter`** — YNAB-compatible bookmarklet that runs in browser; GitHub: https://github.com/dizzlkheinz/wealthsimple-csv-exporter
- **Greasemonkey/Tampermonkey userscript:** `greasyfork.org/scripts/500403` — adds enhanced export download button
- **`ArmenGhazaryan/Wealthsimple-CSV-Exporter`** — Chrome extension for bulk export; Chrome Web Store: `kbgoacabffdbahjiheololcfgkhdambm`
- **`shotasenga` GitHub gist** — exports transactions for YNAB import; https://gist.github.com/shotasenga/c461a672d9c9f927ce213a0c3e9e1895
- **Pocket Portfolio** (pocketportfolio.app) — has a Wealthsimple CSV import feature as part of portfolio tracking

---

## 6. Financial Aggregators as Middleware (RECOMMENDED PRODUCTION PATH)

### Wealthica — BEST FOR CANADIAN INVESTMENT DATA
- Canadian-specific aggregator; publicly positioned as "Canada's most comprehensive financial API"
- Has documented cooperation with Wealthsimple — not just scraping
- Exposes: account balances, holdings, stock book and market values, transaction history, electronic documents
- Has a formal developer API at `wealthica.com/docs/api/`
- SDKs: JavaScript SDK for web/React Native frontend; Node.js SDK for backend — **directly usable in this app's stack**
- GitHub: https://github.com/wealthica/wealthica-sdk-js
- Authentication model: user-facing OAuth-style connect flow (Wealthica handles auth with Wealthsimple on behalf of user)
- **Pricing:** Free, Connect, and Pro tiers — exact pricing requires contacting `sales@wealthica.com` or checking `wealthica.com/pricing/`; trial API keys available on request
- Data refresh: daily automated sync + manual refresh via API call
- Dedicated Montreal-based engineering team for partners — higher-touch than SnapTrade
- Community: well-regarded in r/PersonalFinanceCanada
- **Key advantage over SnapTrade:** deeper Canadian institution coverage, investment-portfolio-specific data (holdings, performance), rather than just brokerage execution data

### SnapTrade — BEST SELF-SERVE DEVELOPER OPTION
- REST + WebSocket API; formal developer documentation
- **Pricing (confirmed July 2026):**
  - Free sandbox tier for development
  - Production: ~$1.50 per connected user per month (pay-as-you-go, no minimum)
  - Free tier allows limited connected users for initial launch
  - Custom enterprise pricing for volume
- Wealthsimple integration confirmed active in 2026
- Supports: holdings, transactions, balances, orders; can also execute trades
- OAuth-based per-user authentication (users connect their own Wealthsimple accounts)
- Self-serve signup — no sales contact required
- G2 reviews (2026): positive, particularly around API documentation quality and support
- **Key advantage over Wealthica:** immediate self-serve signup, well-documented REST API, cleaner developer experience, executes trades (not just reads)
- **Key disadvantage vs Wealthica:** less depth on Canadian investment-specific data (Wealthica was purpose-built for this vs. SnapTrade's brokerage-generic model)

### Plaid
- **Does NOT support Wealthsimple** as a data source
- US-focused; Canadian coverage is limited and does not include Wealthsimple Trade/Invest
- Wealthsimple itself uses Plaid/Flinks internally to pull in user's external *bank* accounts during onboarding (KYC) — but this is the reverse direction and not exposed to developers

### Flinks (Canadian)
- Wealthsimple uses Flinks as a partner for their own KYC onboarding (pulling bank data into Wealthsimple)
- This is the opposite direction from what this app needs (pulling investment data out of Wealthsimple)
- Flinks is bank-focused (deposits, transactions from banks), not investment-focused
- Not self-serve; requires enterprise contact; not recommended for this use case

### Vezgo
- Crypto-focused aggregator; has a Wealthsimple Crypto integration
- Relevant only if crypto account data is needed
- Less useful for investment portfolio (equities/ETFs/RRSPs) data

---

## 7. Terms of Service Risks

### Key ToS Provisions (from wealthsimple.com/en-ca/legal/terms)
- **Trading via API is explicitly banned** and actively enforced: written warnings followed by account termination for repeat violations
- IIROC (now CIRO) dealer member rule 3200 prohibits Canadian brokerages from allowing clients to use automated trade order systems for Canadian securities on Canadian exchanges — this is a regulatory requirement, not just a policy preference
- Wealthsimple "has controls in place that allow the brokerage to detect if you are submitting orders outside of the official Wealthsimple mobile and web applications"
- Rate limit for trades: **7 trades/hour** — enforced server-side with HTTP 429 responses
- Read-only access via unofficial means is technically prohibited under "unauthorized use" clauses, but **no enforcement cases found** for read-only data access

### Flinks End User Agreement
- Wealthsimple has a dedicated `wealthsimple.com/en-ca/legal/flinks` page — indicates a formal agreement with Flinks specifically for data access use cases (the KYC/onboarding direction)

### Multi-User Risk
- Storing multiple users' Wealthsimple credentials in your app is a **major ToS violation** and likely violates financial regulations
- Aggregator middleware (Wealthica, SnapTrade) sidesteps this — users authenticate directly with the aggregator, which holds the Wealthsimple session; your app only holds aggregator tokens

### Bug Bounty Guidance (HackerOne)
- Wealthsimple runs a bug bounty via HackerOne
- Researchers are asked to "refrain from making volumetric requests" and "limit requests to 60 requests/second"
- "Use of automated scanning tools is discouraged and may result in request rate-limiting or automated device/IP blocking"
- This reveals that rate limiting is enforced at the device/IP level, not just account level

---

## 8. Known Failure Modes and Bugs

### Rate Limiting
- Trading endpoints: **7 trades/hour** — hard enforced with HTTP 429
- Auth endpoint: **7-8 failed attempts** triggers HTTP 429; bypassable via IP rotation (a 2022 security disclosure on Medium noted this, status of fix unknown)
- Read endpoints: rate limits exist but specific thresholds not publicly documented; aggressive polling (every 30 seconds or faster) has triggered throttling
- Bug bounty guidance suggests a soft limit of 60 requests/second applies to all endpoints

### Migration Risk — HIGH (most critical risk for direct GraphQL access)
- The REST → GraphQL migration already **broke every client** built on the old API
- Wealthsimple is actively migrating from Apollo Server + schema stitching to **Hive Gateway** (confirmed by The Guild case study at the-guild.dev)
- This is an internal infrastructure migration, but schema stitching → federation can change how certain fields are resolved, renaming or restructuring query paths
- Any direct GraphQL integration should be treated as "may break without notice, possibly with zero warning"
- Libraries like `ws-api-python` have historically needed updates within weeks of Wealthsimple deploys

### Auth Complexity
- TOTP (2FA via authenticator app or SMS) is required for most accounts
- **Workaround used by `ws-api-python`:** stores TOTP secret directly, computes OTP codes programmatically — this requires the user to have set up TOTP (not SMS-only 2FA) and to provide the TOTP seed during setup
- Passkey beta launched February 2026 — currently optional, but will eventually replace email/password + TOTP
- **When passkeys become mandatory, all direct-access libraries will break** without a passkey-compatible headless auth solution (which does not currently exist for WebAuthn in headless environments at scale)

### Token Lifetime
- Session tokens from direct GraphQL auth expire; exact duration not publicly documented, reported anecdotally as ~24 hours
- `ws-api-python` handles refresh automatically when a token is expired at call time
- Refresh token flow must be stored persistently between runs; the library uses OS keyring for this

### Graceful Degradation Recommendation
- Cache last successful data pull with timestamp
- On auth failure or rate limit, display "last updated X ago" with a retry prompt
- On 2FA challenge interruption (e.g., new device flag), surface a re-auth flow rather than failing silently

---

## 9. Scaling Concerns (Single → Multi-User)

| Approach | Single-user | Multi-user |
|----------|-------------|------------|
| Direct GraphQL (`ws-api-python`) | Viable today | **High risk** — ToS violation, per-user credential + TOTP storage, passkey migration risk, no isolation between sessions |
| SnapTrade | Viable | **Designed for this** — per-user OAuth, ToS-compliant, $1.50/user/month, scales linearly |
| Wealthica | Viable | **Designed for this** — per-user auth, Canadian-specific, partner-tier pricing |
| CSV import | Works for one user | Very poor UX; completely impractical at scale |
| Browser automation | Fragile for one user | Completely impractical at scale; passkey migration kills it |

**Per-user session isolation:** if direct GraphQL is used for a multi-user app, each user's tokens would need to be stored encrypted per-user in the database. This is non-trivial and carries regulatory risk (storing credentials to financial accounts). SnapTrade/Wealthica handle this entirely on their side.

**Rate limit multiplication:** with 10 users polling every 5 minutes, you generate 2 requests/minute per user = 20 requests/minute total. At 50 users this approaches territory where IP-level throttling becomes a concern. Aggregators handle this internally.

---

## 10. Prior Art — Existing Open-Source Projects

| Project | Approach | Language | Notes |
|---------|----------|----------|-------|
| `lunchsimple` | Wealthsimple → Lunch Money sync | Python | Uses GraphQL library (`ws-api-python` or similar) |
| `lunch_money_wealthsimple_bridge` | Wealthsimple → Lunch Money | Python | Active community use on r/PersonalFinanceCanada |
| `Nef10/WealthsimpleDownloader` | Download to Beancount format | Swift | Desktop macOS tool for double-entry accounting |
| `dizzlkheinz/wealthsimple-csv-exporter` | Browser bookmarklet for CSV export | JavaScript | YNAB-compatible; active as of 2026 |
| Sharesight | Email-based trade import from Wealthsimple | SaaS | Not API-based; manual email integration |
| Wealthica | Full aggregation platform | SaaS/API | Best Canadian option; has Node.js SDK |
| SnapTrade | Brokerage aggregation API | SaaS/API | Best self-serve developer option |
| Pocket Portfolio | Portfolio tracker with WS CSV import | SaaS | Less relevant — just uses CSV |

---

## 11. Runtime Issues

- **Session expiry:** tokens expire, requiring re-authentication. `ws-api-python` handles this transparently on each call if token is stored persistently. In a server environment, the keyring abstraction must be adapted to use database storage instead of OS keyring
- **2FA interruptions:** if Wealthsimple flags a new device or suspicious IP, it may demand re-verification mid-session. There is no programmatic way to handle an unexpected SMS 2FA challenge. The app should detect 401/403 responses and surface a re-auth prompt
- **Passkey challenges:** as passkey adoption grows, some users may already have disabled TOTP in favor of passkeys, making their accounts incompatible with `ws-api-python` entirely
- **IP-level blocking:** cloud server IPs (AWS, Railway, Vercel) may be flagged by Wealthsimple's fraud detection faster than residential IPs. SnapTrade/Wealthica handle this by routing through their own established infrastructure
- **Graceful degradation pattern:** store last-known data in the local SQLite/Turso DB with a `fetched_at` timestamp; display stale data with a "last synced X ago" label; trigger background re-auth when auth errors are detected

---

## 12. Future Opportunity — Canadian Open Banking

### Consumer-Driven Banking Act
- **Royal Assent:** March 26, 2026 (Bill C-15)
- **Draft Regulations published:** June 27, 2026 (Canada Gazette, Part 1, Volume 160, Number 26)
- **Consultation period:** 60 days ending August 26, 2026
- **Phase 1 (read access):** targeted for 2026, but Bank of Canada has not confirmed an operational date; widely considered at risk of slipping to 2027
- **Phase 2 (write access/payments):** targeted for mid-2027
- **Wealthsimple participation:** as a fintech that holds registered accounts (TFSA, RRSP), Wealthsimple will eventually be required to expose read-access APIs. However, the framework initially targets banks, not brokerages — Wealthsimple's exact scope and timeline under the Act is unclear
- **Regulator:** Bank of Canada (established by Budget 2025 as the CDBA regulator)

### Practical Impact for This App
- If Phase 1 goes live in 2026-2027 and includes Wealthsimple, it would provide a **standardized, legally mandated, ToS-compliant read API** — the cleanest possible path
- This is not actionable today, but architecture should not foreclose it: using SnapTrade or Wealthica now, which will likely integrate CDBA APIs when they land, is a hedge

---

## 13. Flinks Relationship Clarification (Important)

**Flinks is a partner OF Wealthsimple, not a way to access Wealthsimple data.**

Wealthsimple uses Flinks during their own user onboarding to pull bank account data into Wealthsimple (for KYC/AML). Wealthsimple has a formal End User Agreement with Flinks published at `wealthsimple.com/en-ca/legal/flinks`. This is the reverse of what this app needs — it does not provide a path for reading Wealthsimple investment data from outside.

Do not pursue Flinks as a Wealthsimple data aggregator — it does not work in that direction.

---

## Summary Recommendation

| Priority | Approach | Rationale |
|----------|----------|-----------|
| **1st choice** | **SnapTrade API** | Self-serve developer tier, OAuth per-user, ToS-compliant, multi-user ready, well-documented REST API, $1.50/user/month, immediate access. Node.js SDK available. |
| **2nd choice** | **Wealthica API** | Canadian-specific, deeper investment portfolio data (holdings, performance, book values), Node.js SDK available (`wealthica-sdk-js`), but requires sales contact for API keys and has a partner/enterprise feel vs. self-serve |
| **3rd choice** | **Direct GraphQL (`ws-api-python` sidecar)** | Works today for single-user, zero cost. ToS risk, passkey migration risk, Hive Gateway migration risk, Node.js gap (must run Python sidecar). Appropriate for personal single-user dashboard only — not for multi-user production |
| **Avoid** | Direct browser automation | Fragile, passkey migration will kill it, provides nothing that the GraphQL approach doesn't do better |
| **Avoid** | Legacy REST libraries | All broken — dead endpoint |
| **Monitor** | Canadian Open Banking (CDBA) | Phase 1 read access may land in 2027; SnapTrade/Wealthica will integrate it when available |

**For this app (single-user personal finance dashboard):**
- **Immediate path:** Start with **SnapTrade** for the cleanest integration. Self-serve, documented, Node.js compatible, handles all auth complexity, multi-user ready if the app ever expands
- **If SnapTrade data coverage is insufficient** (e.g., missing performance history or specific Canadian account types): add Wealthica as a second source or switch primary
- **As a fallback / supplement:** `ws-api-python` sidecar via a Python microservice on Railway, for data fields the aggregators don't expose
- **Do not build on direct GraphQL as the primary path** for a production app — the ToS risk and migration fragility are too high for anything you want to maintain long-term
