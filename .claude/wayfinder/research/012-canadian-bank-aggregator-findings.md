# Research Findings: Canadian Bank Transaction Aggregator

**Ticket:** 012-canadian-bank-aggregator
**Date:** 2026-07-15
**Agents run:** 4 parallel subagents covering Plaid, Flinks, Wealthica/Salt Edge/MX, and Canadian open banking / scraping alternatives

---

## Accounts Required

- RBC Visa (credit card)
- RBC chequing
- Tangerine Mastercard
- Tangerine account 1
- Tangerine account 2
- Scotiabank chequing

Note: Tangerine is a wholly owned Scotiabank subsidiary. Aggregators treat them as separate institutions with separate connection flows.

---

## 1. Plaid — RECOMMENDED

### Coverage
All 6 accounts confirmed:

| Account | Status | Stability | Notes |
|---|---|---|---|
| RBC chequing | Confirmed | HIGH | Direct API deal (Q3 2024) — OAuth token, not scraping |
| RBC Visa | Confirmed (same Item) | HIGH | Returned alongside chequing under one RBC login |
| Tangerine MC | Confirmed | LOW | Open MFA bug — see critical issue below |
| Tangerine account 1 | Confirmed (same Item) | LOW | Same Tangerine issues |
| Tangerine account 2 | Confirmed (same Item) | LOW | Same Tangerine issues |
| Scotiabank chequing | Confirmed | MEDIUM | No formal API deal; credential/scraping-based |

### The Tangerine Problem (Critical — Open, No Fix Date)
Plaid has an officially acknowledged open bug for Tangerine: MFA is invalidated shortly after initial Item creation, causing background data refresh to stop working. Transactions go stale until the user re-links via Plaid's update mode flow. Additionally, Tangerine only pushes transaction data every **5–9 days** even when the connection is healthy — same-day or next-day transactions are not reliably available. Users report needing to relink as frequently as weekly. Plaid has stated this requires Tangerine's cooperation to fix and has no estimated resolution date.

**Architectural implication:** The app must implement Plaid's update-mode relink flow and surface a notification when `ITEM_LOGIN_REQUIRED` is received via webhook. This is a known, documented UX pattern in fintech apps — not a rare edge case.

### Pricing
- **Free Trial plan:** Up to 10 production Items at $0. Auto-approved. Your 6 accounts = ~3 Plaid Items (one per login: RBC, Tangerine, Scotiabank). Comfortably within the free tier indefinitely for single-user use.
- **Pay-as-you-go:** Usage-based; pricing not published publicly.
- **For this app:** Trial plan covers single-user forever at $0.

### Developer Access
- Fully self-serve — no sales call, no contract required
- Sandbox: instant, free, no payment info
- Trial (production real data): auto-approved, real institutions
- `country_codes: ['CA']` in `/link/token/create` restricts to Canadian institutions

### Node.js Integration
Plaid has a well-maintained official Node.js SDK. Standard flow:
1. Backend: `POST /link/token/create` → returns `link_token`
2. Frontend: Initialize Plaid Link widget → user authenticates at bank
3. Frontend: Receives `public_token` on success
4. Backend: Exchange for `access_token` + `item_id` via `POST /item/public_token/exchange`
5. Store `access_token` encrypted in Turso (AES-256, per ticket 009)
6. Fetch transactions via `/transactions/sync`; listen for `SYNC_UPDATES_AVAILABLE` webhooks

For OAuth-based institutions (RBC post-deal): must register a `redirect_uri` in Plaid dashboard and handle re-initialization after OAuth redirect.

### Data Returned (Canadian accounts)
- Transactions: up to 24 months, with amount, date, merchant name, MCC category, pending status, ISO currency (CAD)
- Balances: current, available, credit limit (for credit cards)
- Account metadata: type, subtype, mask, institution ID
- **Caveat:** Merchant names and categories are less enriched for Canadian merchants than US — expect dirtier data requiring your own categorization layer (already planned)

### ToS
Trial plan explicitly permits "hobbyist use." Single-user personal dashboard where developer = sole end user is clearly within terms. No restrictions found on personal use.

### Known Failure Modes
- **Tangerine:** MFA bug (see above). Expect regular relink requirements.
- **Scotiabank:** Occasional auth breaks when Scotiabank changes web UI/auth flows. Est. 2–4x/year. No formal API deal means it's fragile to Scotiabank-side changes.
- **RBC:** Low failure rate post-API deal. API token model avoids most breakage.
- **General Canada:** Canadian connections break more often than US connections overall — Canada's open banking framework is newer, bank API participation is less universal.

### Prior Art
- `plaid/pattern` (official) — Node.js + React reference PFM app
- `cameronking4/shadcn-openai-plaid-dashboard` — Next.js + Plaid + OpenAI personal finance dashboard; closest analog to this project's stack
- `williamlmao/plaid-to-gsheets` — explicitly targets Canadian banks

---

## 2. Flinks — RULED OUT (Enterprise-Only)

Flinks is Canada-first and has stronger direct API relationships with Canadian banks (including OAuth token exchange with Scotiabank). However, it is structurally enterprise-only:
- **No self-serve signup** — sandbox requires contacting a sales rep
- **1-year contract required for production** — monthly minimums regardless of actual usage
- **No published pricing** — quote-based only
- 80% owned by National Bank; customer base is Wealthsimple, EQ Bank, Affirm — not individual developers
- Tangerine had a documented 9.5-hour outage — Tangerine is a reliability risk on every aggregator

Flinks would be the right choice if building a commercial product for Canadian users at scale, but it is impractical for a single-user personal dashboard.

---

## 3. Wealthica — NOT VIABLE (RBC 2FA Blocker)

Wealthica covers all 6 accounts (RBC via in-house Core connector, Scotiabank via Plaid intermediary, Tangerine directly). However:
- **RBC requires 2FA on every sync** — Wealthica confirmed this. Fully automated daily background syncs for RBC are impossible without user interaction. Every sync triggers an OTP challenge.
- **API access is sales-negotiated** — no self-serve developer tier (Fintech Station co-working space in Montreal is the only free path, irrelevant here)
- Investment-first architecture; bank transaction support is newer and less mature
- No public API pricing

The RBC 2FA-on-every-sync problem is a hard blocker for an automated daily sync design.

---

## 4. Salt Edge — RULED OUT

- Canadian coverage for RBC, Tangerine, Scotiabank is **unconfirmed** — Salt Edge is EU/UK PSD2-focused
- **Free tier eliminated October 31, 2025** (previously used by Firefly III community)
- Production access is sales-gated with custom pricing
- No Canadian regulatory path exists yet to give Salt Edge privileged access

---

## 5. MX Technologies — RULED OUT

- **Enterprise-only** — production pricing $15,000–$90,000/year (Vendr data)
- Canadian coverage for RBC/Tangerine/Scotiabank is **unconfirmed** in public docs
- Dev sandbox capped at 100 users with "limited institutions" — Canadian bank coverage in sandbox not confirmed
- MX's Canadian strategy is selling to banks and fintechs, not individual developers

---

## 6. Unofficial Scraping Libraries — NOT VIABLE

All unofficial Python/JavaScript scrapers for these three banks are effectively dead:

- **RBC:** Several Selenium-based scrapers exist but are stale. The Plaid bilateral API deal makes them obsolete. RBC's increasing bot detection and OSFI B-13 MFA requirements further break them.
- **Tangerine:** Mandatory SMS 2FA (rolled out ~2023) broke all credential-based scrapers. Tangerine's own FAQ confirms this. The `kevinjqiu/tangerine` PyPI library is essentially non-functional for accounts with 2FA (which is now the default).
- **Scotiabank:** No maintained unofficial library found. Scotiabank's developer portal APIs (TranXact) are commercial B2B only.

Do not build on scraping for any of these three institutions.

---

## 7. Canadian Open Banking — Future Migration Path

**Current status (July 2026):**
- Consumer-Driven Banking Act (CDBA) received Royal Assent March 26, 2026 — it is law
- Draft regulations published in Canada Gazette June 27, 2026 — 60-day public comment period (closes August 26, 2026)
- **No operational Phase 1 read access yet — not live at any bank**
- Bank of Canada is the lead regulator; accreditation design is still in progress

**Revised timeline:**
| Milestone | Realistic Estimate |
|---|---|
| Draft regulations final | Late 2026 |
| Accreditation open | Q1–Q2 2027 |
| Phase 1 read access live | H2 2027 |
| Screen-scraping ban activated | After Phase 1 is operational (2028?) |
| Passkeys at Canadian Big Six | 2027–2028 |

**What CDBA Phase 1 will provide:**
- Standardized API: account balances, 24 months of transactions, account metadata, identity
- Coverage: all federally regulated FIs (mandatory Big Six participation)
- Eventually: TFSA, RRSP, non-registered investments
- Regulatory stability — banks cannot unilaterally break the API

**Migration path for this app:**
When CDBA Phase 1 goes live (~H2 2027), the aggregator layer (Plaid) can be swapped to accredited CDBA providers. The Turso database schema, sync jobs, and LLM advisory engine are unaffected — the data shape is the same. Build the sync layer behind an abstraction (a `BankSyncProvider` interface) so the swap is a single implementation change.

---

## 8. Summary Recommendation

**Use Plaid.**

| Criterion | Verdict |
|---|---|
| All 6 accounts supported | Yes — confirmed |
| Self-serve developer access | Yes — instant, no sales call |
| Free tier for single-user | Yes — Trial plan, $0 indefinitely |
| ToS for personal dashboard | Yes — explicitly "hobbyist use" |
| Node.js SDK (maintained) | Yes — official, well-documented |
| Multi-user ready | Yes — per-user OAuth Items, more rows in Turso |
| Tangerine reliability | LOW — open MFA bug, 5-9 day lag, frequent relinks required |
| RBC reliability | HIGH — direct API deal since Q3 2024 |
| Scotiabank reliability | MEDIUM — no formal API deal, occasional breaks |

**The Tangerine problem is real but manageable.** It affects ALL aggregators — Flinks also had a 9.5-hour Tangerine outage. Tangerine's SMS 2FA implementation is the root cause, not the aggregator. The mitigation is building a robust `ITEM_LOGIN_REQUIRED` webhook handler that prompts relink via notification banner. This is standard fintech UX.

**Future path:** Build the aggregator integration behind a provider abstraction. When CDBA Phase 1 is operational (H2 2027), evaluate switching to a CDBA-accredited provider for better stability and no per-Item cost.
