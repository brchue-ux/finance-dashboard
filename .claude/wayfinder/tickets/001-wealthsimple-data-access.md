---
label: wayfinder:research
status: closed
assignee:
parent: map
blocks: [005, 010]
blocked-by: []
---

# What options exist for programmatic Wealthsimple data access?

## Question

Wealthsimple does not appear to have a widely advertised public API. What options exist for a personal finance app to programmatically access a user's Wealthsimple account data (balances, holdings, transactions, performance history)?

Research must cover:

**Access methods:**
- Official Wealthsimple API: does one exist, is it publicly accessible, what endpoints and data does it expose, what are the auth requirements?
- Unofficial/reverse-engineered APIs: what have others built? (GitHub projects, npm packages, Python libraries, Ruby gems — enumerate them with stars, activity, last commit date)
- Browser automation / scraping: Playwright/Puppeteer approaches, existing tools, how others have done it
- CSV/export workflows: what Wealthsimple lets you manually export, in what formats, what data is included

**Risks and failure modes:**
- Terms of Service: does Wealthsimple prohibit automated access? What are the account-level risks?
- Rate limiting: are there known rate limits on any of the above approaches?
- Auth complexity: how login works (OAuth? session cookies? 2FA challenges?), token lifetime, refresh patterns
- Breakage history: how often do unofficial APIs break when Wealthsimple updates their frontend?
- Account lockout risks: any reports of accounts being flagged for automated access?

**Scaling concerns:**
- If this app were expanded to multiple users, what changes? Per-user credential storage, concurrent session risks, rate limit multiplication

**Runtime issues:**
- Session expiry mid-use, 2FA interruptions, Captcha challenges, what graceful degradation looks like

**Prior art:**
- Open-source personal finance apps that have solved Wealthsimple access (enumerate by name, link, approach used)
- Any community discussions (Reddit r/PersonalFinanceCanada, GitHub issues) about programmatic Wealthsimple access

**Opportunities:**
- Any Wealthsimple beta programs, developer partner APIs, or publicly announced API plans?
- Lesser-known data endpoints others have discovered?
- Any aggregators (Plaid, MX, Flinks, Wealthica) that already have Wealthsimple connected and could serve as a middleware?
