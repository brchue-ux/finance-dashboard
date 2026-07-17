---
label: wayfinder:research
status: closed
assignee:
parent: map
blocks: [007]
blocked-by: []
---

# What tech stacks have others used for similar personal finance intelligence dashboards?

## Question

What is the right tech stack for a hosted, mobile-responsive personal finance dashboard that integrates multiple data sources (financial accounts, spreadsheets, market data) and a streaming LLM advisory engine (Claude API)?

Research must cover:

**Prior art:**
- Open-source personal finance dashboards on GitHub: enumerate the most relevant ones, their stacks, what they got right, what broke, contributor activity
- LLM-powered finance/advisory apps: what stacks are teams using (Product Hunt launches, HN Show HN posts, GitHub repos)?
- Any apps specifically combining financial data + LLM analysis — what architectural patterns emerged?

**Framework trade-offs for this use case:**
- Next.js (App Router): SSR, streaming, API routes, ecosystem maturity — known issues with LLM streaming in RSC, cold starts on Vercel
- Remix: progressive enhancement, data loading model, how it handles streaming LLM responses
- SvelteKit: bundle size advantages, SSR, real-time reactivity — ecosystem maturity vs Next.js
- Nuxt (Vue): if relevant, any finance dashboard prior art using it
- For each: how well does it handle: mixed static/dynamic data, real-time updates, LLM response streaming, mobile-first layouts

**Claude API integration patterns:**
- Streaming responses in a web app: which frameworks make this easiest, known pitfalls (buffering, timeout issues)
- Tool use (web search) with Claude: patterns for invoking tools mid-response and rendering results
- Context window management: patterns for summarizing financial data to fit within limits
- Vercel AI SDK: does it help or add complexity for this use case?

**Auth libraries:**
- NextAuth/Auth.js: maturity, credential storage, session management — bugs and footguns
- Clerk: hosted auth, ease of setup, pricing for small apps, data residency concerns
- Lucia: lightweight, self-hosted, flexibility — maturity and ecosystem
- Auth0: enterprise-grade, pricing for low-volume personal apps
- For each: how does credential storage for third-party services (Wealthsimple tokens, Google OAuth) work?

**Database options:**
- SQLite/Turso: simplicity, edge compatibility, known issues at scale
- PostgreSQL (Supabase, Neon, Railway): full relational, known issues, cold start latency
- PlanetScale/Vitess: MySQL-compatible, known issues
- For this app's needs: what data volume is expected, what query patterns, what fits best?

**Deployment targets:**
- Vercel: serverless function limits (timeout for LLM calls), cold starts, pricing, known issues with long-running requests
- Railway: persistent processes, better for long-running LLM calls, pricing
- Fly.io: persistent VMs, latency, complexity vs Railway
- Render: trade-offs vs Railway
- For each: how do they handle LLM streaming timeouts, websockets, scheduled jobs (for data sync)?

**Known bugs and gotchas:**
- Hydration mismatches with real-time financial data
- Serverless function timeouts with LLM streaming responses
- Mobile responsiveness pitfalls with charting libraries (TradingView widgets particularly)
- CORS issues when calling financial data APIs from the client vs server
- Environment variable management for multiple third-party credentials

**Scaling concerns:**
- What changes if this goes from 1 user to 100 users?
- Database connection pooling on serverless
- Rate limit aggregation across users for third-party APIs

**Opportunities:**
- Any stack combinations that make Claude API streaming particularly smooth?
- Edge runtime advantages for this use case?
- Any boilerplates or starter kits specifically for LLM-powered financial apps?
