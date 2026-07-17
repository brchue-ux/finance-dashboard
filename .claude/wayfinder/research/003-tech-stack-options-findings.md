# Research Findings: Tech Stack Options for Finance Intelligence Dashboard

**Ticket:** 003-tech-stack-options
**Original date:** 2026-07-15
**Updated:** 2026-07-16
**Agent searches:** 80+ tool uses across all 9 required topic areas; ~20 open-source finance projects reviewed
**Update scope:** New findings on Vercel AI SDK v5/v6/v7, Next.js 16, Better Auth 1.5, Turso Rust rewrite, Railway pricing, Anthropic finance agents, MCP ecosystem, Clerk pricing change (Feb 2026), prompt cache TTL change, Maybe Finance archive status, Ghostfolio star count, and EAS Hosting vs Vercel for Expo web.

---

## 1. Prior Art — Personal Finance Dashboards and LLM Finance Apps

### Open-Source Personal Finance Dashboards (GitHub)

| Project | Stack | Stars (July 2026) | Status | Notes |
|---------|-------|-------------------|--------|-------|
| Actual Budget | React + SQLite (local-first) | ~17k | Very active | Best self-hosted budgeting app; local SQLite per budget file; offline-first; excellent reference for encrypted local storage patterns |
| Firefly III | PHP + Laravel + Vue | ~18k | Active | Complex, full-featured; PHP stack not relevant but data model is deep reference for multi-account finance |
| Maybe Finance | React/Next.js → Ruby on Rails + Postgres | 44k | **ARCHIVED July 27, 2025** | Originally open-sourced Jan 2024 as Next.js app; team rewrote in Rails; then pivoted to B2B; **no longer maintained**; do not use as architecture reference |
| Ghostfolio | Angular + NestJS + Prisma + Redis + Postgres | 8.1k | Very active (last update April 2026) | Best production reference for investment portfolio tracking; Angular not relevant but NestJS + Postgres architecture is solid |
| Finta (Python) | Python + FastAPI | ~3k | Moderate | Financial data transformation library; not a UI app |
| finance-assistant (googlarz) | Claude Code / MCP | Small | Active | Personal finance copilot using Claude Code natively; tax-statute-accurate; Monte Carlo FIRE; 6 locales, 13 bank formats; local-only (data never leaves machine) |
| FinRobot | Python + LLM agent | ~4k | Active | AI Agent platform for financial analysis; deterministic Python for calculations, LLM for reasoning/synthesis/reporting |

**CORRECTION from prior findings:** Maybe Finance was archived July 27, 2025 and is no longer a useful reference. The original Next.js app it open-sourced in 2024 was quickly superseded by a Rails rewrite, which was then abandoned. **Do not use Maybe Finance as an architectural reference.**

**Best references for this app:**
- Ghostfolio (NestJS + Postgres backend architecture, investment data model)
- Actual Budget (local-first SQLite encryption patterns, sync architecture)
- FinRobot (deterministic finance calculation + LLM reasoning separation pattern)

### LLM-Powered Finance Apps (GitHub / Product Hunt / HN)

| App/Repo | Stack | Approach | Notes |
|----------|-------|----------|-------|
| finance-assistant (googlarz) | Claude Code + MCP | Local, no server | Runs through Claude Code; real financial statute; Monte Carlo |
| WeFinance (calderbuild) | Next.js + GPT-4o Vision | Bill image → insights | Vision LLM for receipt processing |
| Personal Finance Agent (Kirushikesh) | Python + LLM | Multi-LLM support | Ollama, Gemini, OpenAI; not production-grade UI |
| FinRobot (AI4Finance) | Python + LangChain | Financial analysis agents | Research-grade, not personal finance |
| Personal finance tracker with Claude | Next.js + Postgres + Drizzle | Budget tracking + Claude advisor | Plaid integration + Open Banking |

**Architectural pattern that emerged in 2025-2026:** The dominant pattern for LLM-powered personal finance web apps is:
- **Next.js** (App Router) for the web layer
- **Vercel AI SDK** (now v6 or v7) for Claude streaming
- **Drizzle ORM + Postgres or SQLite** for data persistence
- **Plaid** for bank connectivity
- **Tool-first architecture**: Claude calls tools to fetch live data rather than relying on pre-assembled context

A secondary pattern emerging in 2026 is **MCP-first**: building MCP servers for each data source (bank API, portfolio, spreadsheet), then connecting Claude directly to those servers. This is more powerful but more infrastructure.

### Anthropic's Official Finance Agents (May 2026)

On May 5, 2026, Anthropic launched 10 pre-built finance agent templates for enterprise:
- 5 for research/client coverage: pitch building, meeting prep, earnings review, financial model building, market research
- 5 for finance/ops: valuation review, GL reconciliation, month-end close, statement auditing, KYC screening

**Claude Opus 4.7 leads Vals AI Finance Agent benchmark at 64.4%** (vs GPT-5.5 at 59.96%, Gemini 3.1 Pro at 59.72%).

This matters for this app because: Claude is now Anthropic's explicit focus for financial services. The model quality and tool-calling reliability for finance tasks is best-in-class.

---

## 2. Framework Trade-Offs

### Next.js — RECOMMENDED (version 16 as of July 2026)

**Current version:** Next.js 16.2 (released 2026). Key changes from 15:
- Turbopack now stable and default (up to 5-10x faster Fast Refresh, 2-5x faster builds)
- Dev startup ~400% faster than previous versions
- React Compiler stable (auto-memoization, zero manual `useMemo`/`useCallback`)
- React 19.2 integration: View Transitions, `useEffectEvent`, Activity
- New `"use cache"` directive for explicit, flexible caching (replaces `revalidate` confusion)
- Incremental prefetching: only fetches parts not already cached
- Layout deduplication: shared layouts downloaded once across prefetches

**LLM Streaming in Next.js 16:**
- Native support via `Response` with `ReadableStream`, or Vercel AI SDK `streamText()`
- Known issue (still present in 2026): React Server Components cannot stream LLM output — must use Client Components with `useChat`/`useCompletion` hooks
- Stream mutation mid-flight (PII sanitization, filtering) causes chunk boundary corruption when bursts of text trigger multiple events in milliseconds — avoid intercepting raw streams; forward the raw LLM stream directly to the browser and parse/filter on the client
- Error handling gap: when Claude API fails (rate limit, network error, bad key), the stream drops silently — implement explicit AbortController + retry logic + SSE error events

**Multiple Async Data Sources:**
- `Promise.all()` in Server Components with Suspense boundaries for progressive loading
- `"use cache"` directive now more powerful than `revalidate` for granular cache control
- React Query / TanStack Query for client-side data with stale-while-revalidate

**Hydration Mismatches with Financial Data (2026 confirmed):**
- Still a persistent pain point, especially with real-time data and Suspense
- Root causes in finance apps: `Date` objects rendering differently across timezones (server vs client), `Intl.NumberFormat` locale differences, streaming Suspense where fallback structure differs from resolved structure
- Most bugs only surface in `next build && next start` (production mode), not `next dev`
- Fix pattern: move non-deterministic values to `useEffect` or `dynamic()` with `ssr: false`; use consistent `Intl.NumberFormat` with explicit locale everywhere

**Mobile-First:**
- shadcn/ui + Tailwind CSS remains the dominant combination; both fully support Next.js 16
- React Compiler in Next.js 16 reduces re-render overhead on mobile significantly

---

### Remix — VIABLE ALTERNATIVE (unchanged assessment)

LLM streaming + Claude ecosystem remains more mature on Next.js. Remix is excellent if you prefer its data loading model, but expect more manual work.

---

### SvelteKit — VIABLE BUT SMALLER ECOSYSTEM (unchanged assessment)

Vercel AI SDK now has `@ai-sdk/svelte` package. Bundle size advantage is real (important on mobile). But Next.js 16 with Turbopack has closed much of the performance gap. Ecosystem maturity gap remains — fewer finance dashboard examples.

---

### Nuxt (Vue) — STILL NOT RECOMMENDED

No significant change. Eliminated.

---

## 3. Claude API Integration Patterns

### Vercel AI SDK — Current Version is v7 (July 2026)

**Version timeline (critical for this app):**
- v4: Previous stable; custom streaming protocol (`StreamingTextResponse`)
- v5 (July 31, 2025): Major rewrite — UIMessage/ModelMessage split, standard SSE replaces custom protocol, new tool API (`inputSchema`/`outputSchema`), Agent class
- v6 (December 22, 2025): Stable agents (`ToolLoopAgent`), stable MCP support (HTTP + OAuth), human-in-the-loop (`needsApproval` flag), DevTools debugger
- **v7 (June 25, 2026): Current stable** — major release; WorkflowAgent with durable execution, typed tool context (`contextSchema`), granular timeout controls per step/per chunk/per tool, HMAC-signed tool approvals, ESM-only, requires Node.js 22+

**v7 breaking changes:**
- ESM-only: `require()` no longer supported
- Node.js 22+ required (Node.js 18 and 20 dropped)
- All AI SDK packages now ESM-only

**Current setup (v7):**
```typescript
import { streamText } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';

const result = streamText({
  model: anthropic('claude-opus-4-7'), // or claude-sonnet-4-6
  messages,
  tools: {
    getPortfolio: { inputSchema: z.object({...}), execute: async ({...}) => {...} }
  }
});
return result.toDataStreamResponse();
```

**Human-in-the-Loop (v6+ feature, stable in v7):**
```typescript
tools: {
  transferFunds: {
    needsApproval: true, // pause and request user confirmation
    inputSchema: z.object({ amount: z.number(), to: z.string() }),
    execute: async ({ amount, to }) => { ... }
  }
}
```
This is highly relevant for a finance app — any destructive action (transferring money, confirming a trade) can require user approval before execution.

**MCP Support (stable in v6, production-grade in v7):**
- `@ai-sdk/mcp` connects agents to MCP servers over HTTP with OAuth
- By July 2026, 11,000+ MCP servers exist publicly; financial data MCP servers include:
  - Alpaca MCP (Nov 2025): real-time market data, portfolio, order actions
  - Stripe MCP: payment operations
  - Spendesk MCP (June 2026): spend data, cash position, pending invoices
  - Microsoft Dynamics 365 Finance MCP: enterprise ERP data
- **Opportunity for this app:** Build a custom MCP server wrapping Wealthsimple/RBC/Tangerine APIs; connect Claude to it directly. This means Claude can call live financial data as tools during a streaming response.

### Streaming Timeout — UPDATED (Critical)

**Vercel Pro plan (updated 2026):**
- Default: 15 seconds
- Maximum configurable: **300 seconds (5 minutes)** on Pro; requires explicit configuration
- **Fluid Compute** (Vercel's newer serverless): up to **800 seconds** on Pro and Enterprise
- Vercel Workflows: agents suspend/resume across invocations — no hard limit per step
- Streaming responses: timeout applies to time-to-first-byte; subsequent streaming keeps connection alive
- **Verdict:** Vercel Pro is now viable for long LLM calls with proper streaming setup, but Railway still simpler (no timeout at all)

**Hobby tier remains unusable:** Strictly capped at 10 seconds.

### Context Window Management

- Claude Sonnet 4.6: 200K context window
- Claude Opus 4.7: 200K context window (best finance task performance)
- Typical financial data (30 days transactions + portfolio summary): 5,000-15,000 tokens
- At 30 users with shared context, still well within single-context limits

**Prompt Caching — CRITICAL COST NOTE (2026 change):**
- Cache writes cost 25% more than standard input tokens
- Cache reads cost 10% of standard input tokens (90% savings)
- **Anthropic changed prompt cache TTL from 60 minutes to 5 minutes in early 2026**
- This change increased effective API costs by 30-60% for many production apps
- For a personal finance app with sporadic usage (user returns every few hours), the 5-minute TTL means the system prompt cache will almost always be cold
- **Mitigation:** Use Batch API (50% off) for non-real-time analysis tasks (nightly summaries, weekly reports); combine with prompt caching on the system prompt for synchronous queries
- Cached batch requests achieve ~95% savings on input tokens

### Tool Use Pattern for Finance Apps

The "tool-first architecture" pattern from FinRobot applies here:
- Use deterministic Python/TypeScript code for actual financial calculations (tax, compound interest, FIRE numbers, DCF)
- Use Claude for reasoning, synthesis, explanation, and generating insight narratives
- Never ask Claude to perform arithmetic; validate all numerical outputs from tools

---

## 4. Auth Libraries

### Better Auth — RECOMMENDED (version 1.5, July 2026)

**Major development (September 2025):** The Better Auth team took over Auth.js maintenance. Auth.js is now in security-patch-only mode. The Auth.js team's own guidance for new projects points to Better Auth. **This confirms Better Auth as the clear choice for new projects in 2026.**

**Better Auth 1.5 (released 2026) new features:**
- Auth CLI for scaffolding
- **MCP Auth plugin** — exposes your auth as an MCP server (OAuth 2.1 for MCP clients)
- OAuth 2.1 Provider plugin (replaces old OIDC Provider)
- Electron integration
- i18n support
- RFC 7662 (token introspection) and RFC 7009 (token revocation) compliant endpoints
- Configurable per-endpoint rate limiting
- 600+ commits, 70 new features, 200 bug fixes in this release

**Token storage for financial app:**
- `encryptOAuthTokens: true` — encrypts OAuth tokens (Plaid access tokens, Google Sheets tokens) before database storage
- Supports storing tokens in encrypted cookies for database-less flows
- Database-backed account storage preferred for production (durable storage of large tokens)

**Security note from 2025:** CVE-2025-29927 — Next.js middleware-only session protection is bypassable by spoofing `x-middleware-subrequest` header. Better Auth + database session validation (not just middleware) is the correct pattern.

**Verdict:** Better Auth is the clear winner for a new project in July 2026. The Auth.js takeover is a strong signal of long-term viability.

---

### NextAuth / Auth.js v5 — STILL SAFE BUT NOT RECOMMENDED FOR NEW PROJECTS

- Still widely deployed; security patches continue
- New project guidance from the Auth.js team itself: use Better Auth
- Existing v4 → v5 migrations still have rough edges
- No reason to choose this over Better Auth for a greenfield app

---

### Clerk — PRICING CHANGED (February 5, 2026)

**Old pricing:** 10,000 MAU free
**New pricing (Feb 5, 2026):** 50,000 MRU (Monthly Retained Users) free

MRU vs MAU: A user only counts as retained if they return 24+ hours after signup. For a personal finance app checked regularly, most users will count as MRU. **The new 50K free tier makes Clerk effectively free for any personal or small-team app.**

- Pro: $25/month (billed monthly) or $20/month (annual); includes 50K MRUs
- Overage: $0.02/MRU above limit
- **Data residency:** Auth data stored on Clerk servers — acceptable for most uses
- **Third-party token storage:** Clerk does not store Plaid/Google tokens; you still need your own encrypted database storage for these

**Verdict:** The new pricing makes Clerk very attractive for a personal app (essentially free). The hosted auth + polished UI vs managing Better Auth yourself is a real trade-off. If you need MCP Auth or OAuth 2.1 provider features, Better Auth wins. If you just need users to log in, Clerk's DX is best.

---

### Lucia — Not updated; assessment unchanged

---

## 5. Database Options

### Turso / libSQL — IMPORTANT STATUS UPDATE

There are now two distinct "Turso" products:

**1. Turso Cloud / libSQL (mature, production-ready)**
- libSQL: open-source SQLite fork; 800k weekly JS SDK downloads; production at scale
- Turso Cloud: managed libSQL service; free tier: 500 databases, 9GB storage
- Concurrent writes via `BEGIN CONCURRENT` (MVCC): moved from tech preview to **beta in v0.5.0 (March 4, 2026)**; limited production use; achieves 4x write throughput vs SQLite, removes SQLITE_BUSY errors
- For a personal finance app with < 1,000 writes/day: concurrent writes are not needed; single-writer libSQL works fine

**2. Turso Database (new Rust rewrite, in beta)**
- Complete rewrite of SQLite from scratch in Rust (started early 2025)
- MVCC, async I/O, vector search built in
- Currently beta as of July 2026; may contain bugs; **not recommended for production without backups**
- This is the long-term future but not yet production-grade

**Recommendation:** Use **Turso Cloud (libSQL)** — the mature product. Avoid the new Rust beta for production.

**SQL limitations to know:**
- No materialized views
- Limited `ALTER TABLE` (SQLite constraint)
- Smaller SQL feature set than Postgres (no window functions before SQLite 3.25, now widely supported)

---

### Neon (Serverless Postgres) — UPDATED LATENCY DATA

**Cold start latency in 2025-2026:**
- Early days: 4-5 seconds
- Late 2025: 1.8 second median, 2.6s p95, 3.1s worst case
- 2026 (Fluid Compute): ~3ms average for TCP connections
- Neon team has committed to sub-1-second cold starts by end of 2026

**Connection pooling:** Built-in PgBouncer pooler via separate pooled connection string; supports up to 10,000 pooled connections per project. Mandatory for serverless deployments.

**Free tier:** 0.5GB storage, 5 compute hours/month (scale-to-zero)

**Verdict for this app:** Neon cold starts have improved dramatically. Still not zero-latency like Turso (local SQLite file). If you need full Postgres features (JSON querying, complex joins, full-text search across transactions), Neon is worth the cold start trade-off.

---

### ORM: Drizzle vs Prisma — UPDATED

**Prisma 7 (November 2025):**
- Replaced Rust binary with TypeScript/WASM implementation
- ~90% smaller bundle size vs Prisma 6
- Up to 9x faster serverless cold starts vs Prisma 6
- Now works on edge runtimes (previously required Node.js)
- Claims 3x faster queries (eliminating Rust serialization layer)

**Drizzle (2026 status):**
- Still ~7.4kb (min+gzip), no external dependencies
- Edge-native from day one; adapters for Neon, Turso, Cloudflare D1, PlanetScale
- Better complex SQL control (window functions, CTEs, subqueries map directly to SQL)
- "Close to SQL" philosophy

**Verdict:** Drizzle remains recommended for this app:
- Still lighter bundle than Prisma 7 (even post-Prisma improvements)
- Better Turso support (more mature)
- SQL transparency is valuable when debugging financial query logic
- Drizzle Kit migrations are simpler for a solo developer

If you later add Prisma Studio (visual database UI) or need the Prisma abstraction for team development, migrating from Drizzle to Prisma 7 is feasible.

---

## 6. Deployment Targets

### Vercel — UPDATED LIMITS

| Tier | Function Timeout | Notes |
|------|-----------------|-------|
| Hobby | 10 seconds | Unusable for LLM calls |
| Pro (standard serverless) | 15s default; up to 300s configurable | Viable for streaming LLM |
| Pro (Fluid Compute) | Up to 800 seconds | Best Vercel option for long LLM calls |
| Enterprise (Workflows) | No limit per step; suspend/resume | Agent workflows that can pause |

**Streaming clarification:** For streaming responses, the timeout applies to time-to-first-byte. Once streaming begins, the connection stays alive. Claude typically returns first tokens within 500ms-2s — well under any timeout. **Total streaming duration is not limited by function timeout when using streaming responses.**

**EAS Hosting vs Vercel for Expo web:**
- Expo now has **EAS Hosting** (their own deployment service) as the recommended path for Expo web apps
- EAS Hosting supports static and server output modes natively, preview URLs per branch, integrates with EAS Update for OTA native updates
- For this app's architecture (Next.js backend on Railway, Expo frontend): Vercel or EAS Hosting are both valid for the Expo web build; EAS Hosting is tighter integration with the native build pipeline

---

### Railway — PRICING CLARIFICATION

**Hobby plan: $5/month**
- Includes $5 in compute credits
- If your total usage ≤ $5: you pay exactly $5/month
- If usage exceeds $5: you pay the delta above $5
- Real-world cost for a typical full-stack app: **$20-50/month** (Railway's marketing focuses on the $5 entry; actual usage costs more)
- Cron jobs: Railway supports them as separate services; requires external scheduling (e.g., Railway Cron service)
- Persistent volumes: up to 5GB on Hobby, 1TB on Pro
- No function timeout — persistent Node.js process handles LLM streaming indefinitely

**Verdict:** Railway is still recommended for the backend. The $5/month entry is a floor, not a ceiling. Budget ~$15-25/month for a Next.js API + SQLite/small Postgres workload. Still much cheaper than Vercel Pro ($20/month) + Neon for equivalent capability.

---

### Fly.io — Unchanged assessment

More ops complexity than Railway. No free tier as of 2026. Better global latency if you need multi-region. Not recommended for this app.

---

### Render — Unchanged assessment

$7/month for always-on. Railway preferred. Render is viable fallback.

---

## 7. Cross-Cutting Bugs and Gotchas (Updated)

| Issue | Impact | Fix | Status |
|-------|--------|-----|--------|
| TradingView Lightweight Charts SSR crash | Breaking | `dynamic(() => import('...'), { ssr: false })` in Next.js | Unchanged |
| LLM streaming drop on API error | Breaking (silent) | Implement AbortController + retry + SSE error events | New finding |
| Stream chunk boundary corruption when intercepting | Breaking | Forward raw LLM stream to browser; filter/parse on client | New finding |
| LLM streaming timeout on Vercel Hobby | Breaking | Upgrade to Pro, or use Railway | Unchanged |
| React hydration mismatch with financial numbers | Visual glitch | Use consistent `Intl.NumberFormat` server+client with explicit locale; or render numbers client-only | Unchanged |
| Hydration mismatch only visible in production | Debugging trap | Always test with `next build && next start`, not `next dev` | New finding |
| Prompt cache TTL now 5 minutes (was 60 min) | Cost increase | Cache system prompt; use Batch API for non-real-time tasks | New finding (2026) |
| TradingView widget memory leak in React | Performance degradation | Cleanup in `useEffect` return function | Unchanged |
| `@googleapis/sheets` ECONNRESET on large reads | Runtime error | Retry with exponential backoff | Unchanged |
| CORS when calling financial APIs from browser | Security/runtime | Call all third-party APIs from server, not client | Unchanged |
| Environment variable leakage to client bundle | Security | Never prefix sensitive vars with `NEXT_PUBLIC_` | Unchanged |
| Drizzle migration state divergence | Data integrity | Use `drizzle-kit push` in dev, `migrate` in production | Unchanged |
| CVE-2025-29927: Next.js middleware session bypass | Security | Use database session validation, not middleware-only | New finding (March 2025) |
| Plaid access tokens: long-lived, must be encrypted | Security | Store with AES-256 encryption in database; hash for lookup | New finding |
| Node.js 22 required for Vercel AI SDK v7 | Breaking if on older Node | Pin Node.js ≥22 in `.nvmrc` and Railway config | New finding |
| Vercel AI SDK ESM-only in v7 | Breaking for CommonJS | Ensure all imports use ESM; check `package.json` `"type": "module"` | New finding |

---

## 8. Scaling from 1 to 100 Users

| Concern | Impact at 100 users | Solution |
|---------|---------------------|---------|
| DB connection pooling (Postgres) | Serverless creates too many connections | Neon built-in PgBouncer pooler (separate connection string); up to 10,000 pooled connections |
| Anthropic API rate limits | 429 errors under concurrent LLM calls | Queue LLM requests per user; display "analyzing..." state; implement exponential backoff |
| Prompt cache hit rate drops | Cache costs increase as user patterns diverge | Structure system prompt to share across users (generic financial context + tools); user-specific data only in messages |
| Google Sheets API quota | 300 req/min project-wide | Cache-aside pattern; per-user quotas via service account per user |
| Turso single-writer (libSQL) | Bottleneck if concurrent writes > ~100/sec | Well above personal finance write volume; not a concern unless multi-tenant |
| Plaid API item limits | Plaid charges per connected item | Cache transaction data aggressively (24-hour TTL on historical transactions) |
| LLM cost at scale | 100 users × daily queries × token cost | Route Opus 4.7 only for complex analysis; use Sonnet 4.6 for routine queries; Batch API for nightly summaries |

---

## 9. Opportunities

### Current Best Stack Combination for Claude Integration

As of July 2026, the optimal combination for Claude-powered finance web apps is:

**Next.js 16 + Vercel AI SDK v7 + Anthropic SDK + Drizzle + Turso + Better Auth + Railway**

- Next.js 16: stable, fast, React Compiler removes boilerplate optimization
- AI SDK v7: WorkflowAgent for durable agent loops, MCP support, human-in-the-loop for financial actions
- Anthropic SDK direct: for features not yet in AI SDK (extended thinking, specific tool configs)
- Drizzle: SQL transparency for finance queries, Turso adapter mature
- Turso (libSQL): zero cold start, free tier, SQLite simplicity
- Better Auth: took over Auth.js; `encryptOAuthTokens` for Plaid token storage; MCP Auth plugin
- Railway: persistent process, no LLM timeout, native cron for data sync

### MCP Architecture Opportunity (2026)

The MCP ecosystem has exploded: 11,000+ servers by early 2026. For this app, a "finance MCP stack" could be:

1. **Custom Wealthsimple MCP server** — wrap the Wealthsimple API with MCP protocol; expose portfolio, holdings, transactions as MCP resources
2. **Custom bank transaction MCP server** — wrap RBC/Tangerine/Scotiabank imports; expose as MCP resources
3. **Google Sheets MCP server** — already exists; wraps Sheets API
4. **TradingView MCP** — market data and chart data via MCP
5. **Claude with AI SDK v7 MCP support** — connect all four servers; Claude queries them as tools during streaming responses

This eliminates the need to pre-assemble financial context before prompting Claude. Claude asks for what it needs, gets live data, responds. This is architecturally cleaner and more capable than injecting a static context dump.

**Better Auth 1.5 MCP Auth plugin** can expose your app's auth as an MCP server, enabling secure OAuth flows for MCP clients.

### Boilerplates / Starter Kits (Updated)

| Project | Stars | Stack | Notes |
|---------|-------|-------|-------|
| `ai-chatbot` (Vercel official) | ~10k | Next.js + AI SDK v7 + auth | Official reference; updated to v7; good for AI SDK patterns |
| `create-t3-app` | 26k | Next.js + tRPC + Drizzle + Auth.js | Excellent type-safe foundation; uses Better Auth in latest; tRPC v11 in 2025 |
| `create-t3-turbo-ai` (zckly) | Moderate | T3 + Turborepo + OpenAI + LangChain | Adapts to Anthropic with provider swap |
| Maybe Finance (archived) | 44k | **ARCHIVED** | Do not use; archived July 2025 |
| Ghostfolio | 8.1k | Angular + NestJS + Postgres | Study data model only; Angular/NestJS not relevant to this app |

### Recharts / shadcn Charts vs Tremor (2026)

- **shadcn/ui Charts**: Built on Recharts v3 (2.4M weekly downloads); composable, mobile-responsive with `ResponsiveContainer`; `accessibilityLayer` prop for screen readers; integrates natively with shadcn/ui + Tailwind
- **Tremor**: Pre-styled opinionated layer on Recharts; richer chart variety (area, bar, donut, scatter); easier to get something that looks good fast; v3.18.7 (Jan 2025)
- **Recharts v3** (2024 release): SVG-based, declarative React API; default for most teams
- **Recommendation:** shadcn/ui Charts (Recharts v3) for full design control + smallest bundle. Tremor if you want fast, opinionated dashboard styling with minimal config.

### Edge Runtime for Finance App

- Lightweight API routes (auth session checks, cached balance reads) run on edge for ~0ms latency
- LLM calls, Plaid API calls, Google Sheets calls: all require Node.js runtime (not edge-compatible)
- Better Auth works at edge; sessions readable without Node.js
- **Pattern:** Split routes: edge for auth/cache reads; Node.js for all third-party API calls and LLM

### Next.js 16 `"use cache"` Directive

The new `"use cache"` directive in Next.js 16 is highly relevant for financial data:

```typescript
async function getBankBalance(userId: string) {
  "use cache";
  // Cache bank balance for 1 hour
  const balance = await plaidClient.getBalance(accessToken);
  return balance;
}
```

This replaces the confusing `revalidate` pattern and allows per-function cache control. For finance apps where data freshness varies by type (real-time prices vs daily balances vs monthly statements), `"use cache"` with different TTLs per function is very powerful.

---

## Summary Recommendation (Updated July 2026)

| Decision | Recommendation | Rationale | Changed? |
|----------|---------------|-----------|----------|
| Framework | **Next.js 16 (App Router)** | Turbopack stable, React Compiler, best AI SDK ecosystem | Unchanged |
| LLM integration | **Vercel AI SDK v7** | WorkflowAgent, MCP, human-in-the-loop, ESM-only (ensure Node 22) | Updated to v7 |
| Auth | **Better Auth 1.5** | Auth.js team deferred to Better Auth; `encryptOAuthTokens`; MCP Auth plugin | Confirmed stronger |
| Database | **Turso Cloud (libSQL)** with **Drizzle ORM** | Free, fast, zero cold start; concurrent writes in beta; migrate to Neon if complex queries needed | Updated (clarified Turso vs new Rust beta) |
| Deployment (backend) | **Railway** (~$15-25/month actual) | Persistent process, no LLM timeout, cron jobs, real costs ~$20/month not $5 | Updated pricing reality |
| Deployment (frontend) | **EAS Hosting** for Expo web | Expo's own hosting is recommended path for Expo apps; preview URLs per branch | New finding |
| UI components | **shadcn/ui + Tailwind CSS** | Unchanged; React Compiler in Next.js 16 improves component performance | Unchanged |
| Charts | **shadcn/ui Charts (Recharts v3)** | Mobile-responsive, composable, integrates with shadcn design system | Clarified |
| MCP strategy | **Build custom finance MCP servers** | AI SDK v7 stable MCP support + 11,000+ ecosystem; enables live tool access vs static context injection | New opportunity |
| Cost optimization | **Batch API + Prompt Caching** | 5-min TTL change requires Batch API for non-real-time tasks; combine for ~95% input token savings | New (2026 TTL change) |

### Critical Warnings Surfaced by This Research

1. **Maybe Finance is archived** (July 2025) — not a reference architecture
2. **Vercel AI SDK v7 requires Node.js 22 and is ESM-only** — ensure Railway runtime is Node 22+
3. **Prompt cache TTL changed to 5 minutes** (early 2026) — redesign caching strategy for sporadic personal app usage
4. **CVE-2025-29927**: Next.js middleware-only session protection is bypassable — use database session validation
5. **Railway actual costs are $15-50/month** for real apps, not the $5 floor in their marketing
6. **Clerk pricing changed Feb 2026** to 50K MRU free (was 10K) — Clerk is now free for this use case
7. **Plaid access tokens are indefinitely valid** — must be AES-256 encrypted in database, not just hashed
