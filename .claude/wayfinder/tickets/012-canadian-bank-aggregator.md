---
label: wayfinder:research
status: closed
assignee:
parent: map
blocks: [010]
blocked-by: [004]
---

# Canadian bank transaction aggregator for RBC + Tangerine

## Question

What is the best aggregator to automatically pull transaction data from the user's Canadian bank accounts into the app?

## Accounts to support

- RBC Visa (primary spending card)
- RBC chequing (income deposits, bill auto-pay)
- Tangerine Mastercard
- Tangerine account 1
- Tangerine account 2
- Scotiabank chequing

## Research required

- **Plaid** — supports Canadian banks? Confirmed RBC support? Tangerine support? ToS for single-user personal dashboard?
- **Flinks** — Canadian-specific aggregator, RBC + Tangerine support, pricing, developer tier availability
- **Wealthica** — mentioned in ticket 001 for investments; does it also cover bank transaction data?
- **Salt Edge / Enablebanking** — Canadian coverage?
- **MX** — primarily US; Canadian support?
- **Canada's Consumer-Driven Banking Act** — official open banking timeline (mid-2027 noted in 001); any earlier access program?

## Research standard

Cover: known bugs and failure modes, rate limits, OAuth flow complexity, multi-institution support, free/developer tier availability, ToS for personal dashboard use, prior art from publicly available projects. Run subagents in parallel.

## Decision criteria

- Must support all 6 accounts (RBC + Tangerine + Scotiabank)
- Must have a self-serve developer tier or reasonable free tier for single-user use
- OAuth per-user flow (not screen scraping with stored credentials)
- ToS-compliant for a hosted personal finance dashboard
- Compatible with Next.js / Node.js backend
