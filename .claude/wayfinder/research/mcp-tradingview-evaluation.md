# MCP TradingView Evaluation: `atilaahmettaner/tradingview-mcp`

**Research date:** 2026-07-16
**Evaluated against:** Wayfinder finance dashboard — Node.js/Next.js backend on Railway, Vercel AI SDK v7, Claude advisory engine requiring live indicator MCP tools.

---

## Executive Summary

`atilaahmettaner/tradingview-mcp` is an actively maintained Python MCP server with 3.6k GitHub stars, 30+ tools, and genuine RSI/MACD/MA20/MA50/volume/summary coverage. However, it has **three blocking production issues** for this specific deployment:

1. It is a **stdio-only server by default** — the documented self-hosted setup does not expose HTTP/SSE endpoints. Railway requires HTTP transport; the Vercel AI SDK v7 explicitly warns that stdio "cannot be deployed to production environments."
2. Its technical analysis core (`tradingview-ta`) hits `scanner.tradingview.com` — an **unofficial, unauthenticated endpoint** on an **archived upstream library** (last updated October 2022, archived June 2024). Known 403 blocking on cloud IPs, no ToS permission, no SLA.
3. The underlying library dependency is **abandonware** — the project silently carries a frozen dependency that cannot receive security patches.

These issues are not fatal but require either a workaround (HTTP transport wrapper + proxy layer) or a clean replacement. A recommended alternative path using Twelve Data's official MCP server eliminates all three risks.

---

## 1. Project Status and Maintenance

### Repository Metrics (as of 2026-07-16)

| Metric | Value |
|--------|-------|
| GitHub URL | https://github.com/atilaahmettaner/tradingview-mcp |
| Stars | 3,600 |
| Forks | 753 |
| Total commits | 117 |
| Open issues | 7 |
| Open PRs | 5 |
| License | MIT |
| Python versions | 3.10–3.13 (3.14 unsupported; Windows users advised to pin to 3.13) |

### Commit Activity

The project has **no formal releases** (GitHub Releases page is empty). Versioning is tracked through README changelogs. Confirmed activity from the issue tracker:

- Issue #77 and #76 both filed **July 10, 2026** — both open, no maintainer response yet
- Issues reference "28 of 36 tools still block the event loop" and "error contract is half-migrated" — active architectural work in progress
- May 2026 updates: async conversion of 7 high-traffic tools, 9 backtesting strategies added (up from 6), walk-forward backtesting, hourly timeframe support
- December 2025 feature request (issue #7): still open with no response

### Issue Response Pattern

The maintainer is not visibly responding to open issues. Issues #59 and #60 (both from June 2026, bugs in `walk_forward_backtest_strategy`) have no maintainer comments. Issue #7 (December 2025) has been open 7 months with no response. This is concerning for a production dependency.

### Signs of Abandonment

- No GitHub Releases tagged
- Issues sit unanswered for months
- The core dependency (`python-tradingview-ta`) is **archived** (see Section 3)
- No Dockerfile, no Railway config, no cloud deployment documentation

### Active Signs

- 3.6k stars, 753 forks indicate strong community adoption
- Async refactoring and backtesting expansion happened in May–July 2026
- PyPI package `tradingview-mcp-server` exists and is installable
- Hosted version at pro.cryptosieve.com ($9–$29/mo) suggests the maintainer is commercially invested

---

## 2. Indicator Coverage

### Required Tools vs. Available

| Required | Available | Notes |
|----------|-----------|-------|
| RSI | Yes | Via `tradingview_ta` tool, also used in backtesting strategies |
| MACD | Yes | Via `tradingview_ta` tool, MACD crossover backtesting strategy |
| MA20 | Yes | EMA 20/50 crossover strategy; MA20 returned in technical summary |
| MA50 | Yes | EMA 20/50 crossover strategy; MA50 returned in technical summary |
| Volume analysis | Yes | `volume_breakout_scanner`, `smart_volume_scanner` |
| Technical summary | Yes | `tradingview_ta` returns overall recommendation (BUY/SELL/NEUTRAL) with oscillator and MA sub-counts |

### Full Tool Inventory (30+ tools)

**Technical Analysis:**
- `tradingview_ta` — core tool; returns RSI, MACD, MA20, MA50, Bollinger Bands, Stochastic, ADX, ATR, and overall recommendation summary
- `multi_timeframe_analysis` — weekly to 15-minute alignment
- `combined_analysis` — merges technicals + sentiment + news

**Market Data:**
- `yahoo_price` — real-time via Yahoo Finance (async httpx)
- `stock_extended_hours` — pre/post market data
- `top_gainers`, `top_losers` — market movers

**Screeners:**
- `rating_filter` — filter by technical rating
- `volume_breakout_scanner` — volume anomaly detection
- `smart_volume_scanner` — advanced volume profile
- Global stock screener with 20+ filters

**Backtesting (9 strategies as of May 2026):**
- `backtest_strategy` — RSI mean reversion, Bollinger, MACD crossover, EMA 20/50, Supertrend, Donchian Channel, plus 3 additional
- `compare_strategies` — ranks all 9
- `walk_forward_backtest_strategy` — train/test split (currently buggy per issues #59/#60)

**Sentiment & News:**
- `market_sentiment` — Reddit scraping
- `financial_news` — RSS feeds (Reuters, CoinDesk, CoinTelegraph)

### Verdict on Coverage

All six required indicators are present. The `tradingview_ta` tool returns them in a single call as part of a full technical summary, which is exactly what the advisory engine needs.

---

## 3. Data Source

### Architecture

The server uses **two distinct data sources** depending on the tool:

**Source A — TradingView Scanner (unofficial, unauthenticated):**
- Library: `tradingview-ta` (PyPI package `tradingview-ta`)
- Upstream: `AnalyzerREST/python-tradingview-ta` on GitHub
- Endpoint hit: `POST https://scanner.tradingview.com/{screener}/scan`
  - `{screener}` = `crypto`, `america`, `forex`, etc.
  - Request body: JSON with `symbols`, `interval`, and `columns` list of indicator names
  - Header: `User-Agent: tradingview_ta/{version}`
- No API key, no authentication, no session cookie
- Returns JSON with indicator values in positional array

**Source B — Yahoo Finance (unofficial, unauthenticated):**
- Library: `httpx.AsyncClient` hitting Yahoo Finance endpoints
- Used by: `yahoo_price`, `stock_extended_hours`, `top_gainers`, `top_losers`
- No API key required

**Source C — Reddit/RSS:**
- Used by sentiment and news tools
- Not relevant to indicator data

### Critical Dependency Status: `python-tradingview-ta`

The `tradingview-ta` library is the **entire foundation of the technical analysis tools**.

| Metric | Value |
|--------|-------|
| GitHub | https://github.com/AnalyzerREST/python-tradingview-ta |
| Stars | 1,200 |
| Forks | 269 |
| Last commit | June 13, 2024 |
| **Status** | **ARCHIVED — read-only, no new development** |
| Last PyPI release | v3.3.0, October 5, 2022 |

This library has been **abandoned for two years** and **archived for over a year**. If TradingView changes the `scanner.tradingview.com` response format, field names, or endpoint path, the library will silently break with no maintainer to fix it. There is no official documentation for this endpoint — it is reverse-engineered from TradingView's browser traffic.

### TradingView Endpoint Risk

TradingView has **no documented public API** for scanner/technical analysis data. The `scanner.tradingview.com/scan` endpoint is an undocumented internal API.

**Known blocking behavior:**
- PythonAnywhere free tier: confirmed 403 Forbidden on `scanner.tradingview.com/crypto/scan` (documented in community forums, multiple threads from 2021–2024)
- PythonAnywhere staff refused to whitelist the domain because TradingView has no official API documentation
- The error: `HTTPSConnectionPool(host='scanner.tradingview.com', port=443): Max retries exceeded ... (Caused by ProxyError('Cannot connect to proxy.', OSError('Tunnel connection failed: 403 Forbidden')))`
- Railway uses shared cloud IP ranges (AWS/GCP/Azure-adjacent). TradingView is known to block data center IP ranges

**ToS risk:**
TradingView is a **data licensee**, not a data owner. Real-time prices and technical data come from exchanges that license their feeds to TradingView under redistribution-restricted terms. Programmatic access to TradingView's internal scanner API almost certainly violates these downstream license terms, even if TradingView does not actively enforce it.

**Endpoint update risk:**
The `atilaahmettaner/tradingview-mcp` project cannot update the scanner endpoint parsing because it is locked to the frozen `python-tradingview-ta` library. If TradingView changes the endpoint, the fix requires either forking the archived library or replacing it entirely.

### Historical Update Response

Since `python-tradingview-ta` is archived, there is no update response — there cannot be one. The last time the library adapted to a TradingView change was prior to October 2022.

---

## 4. Deployment on Railway

### Transport Protocol: Critical Issue

The default and only documented deployment mode is **stdio**:

```bash
# All documented startup commands use stdio
uvx --from tradingview-mcp-server tradingview-mcp
uv run tradingview-mcp
python src/tradingview_mcp/server.py
```

The project's INSTALLATION.md and README contain **no mention of `--transport http` or `--transport sse` flags**, no Dockerfile, and no Railway deployment section.

**FastMCP framework capability:** FastMCP (the framework used by this server) does support HTTP transport mode:
```bash
fastmcp run server.py --transport http --port 8000
```
This means HTTP transport is technically achievable by running the server with a FastMCP CLI flag rather than the default entry point. However, this is **not documented by the project** and requires the deployer to understand FastMCP internals.

**The Vercel AI SDK v7 position on stdio:**
> "The stdio transport should only be used for local servers as it cannot be deployed to production environments."

This means: if you deploy `atilaahmettaner/tradingview-mcp` on Railway in stdio mode, the Next.js backend cannot connect to it at all. You must use HTTP or SSE transport.

### Railway Python Deployment Path (If Pursued)

Railway does support Python services alongside Node.js services in the same project. A working deployment would look like:

1. Add a `Dockerfile` to the tradingview-mcp repo (not provided by project):
```dockerfile
FROM python:3.13-slim
RUN pip install tradingview-mcp-server
EXPOSE 8000
CMD ["fastmcp", "run", "tradingview_mcp/server.py", "--transport", "http", "--host", "0.0.0.0", "--port", "8000"]
```
2. Deploy as a separate Railway service in the same project
3. Railway generates a public URL (e.g., `https://tradingview-mcp.railway.app`)
4. Connect from Next.js backend using Vercel AI SDK:
```javascript
const mcpClient = await createMCPClient({
  transport: {
    type: 'http',
    url: 'https://tradingview-mcp.railway.app/mcp',
  },
});
```

**Known issues specific to Railway:**
- No official Railway config from the project (Dockerfile must be written from scratch)
- The TradingView scanner endpoint 403 risk on cloud IPs applies to Railway's shared IP pool
- Python service adds ~$5–10/mo to Railway costs (always-on)
- No environment variables required (no auth needed for TradingView's public endpoints) — this is also a risk indicator

### Port and Protocol

- Port: configurable (8000 default in FastMCP)
- Protocol: stdio by default; HTTP (Streamable HTTP) achievable via FastMCP CLI flag; SSE also available via FastMCP but deprecated in MCP spec

---

## 5. Rate Limits and ToS Risk at Scale

### TradingView Rate Limits

TradingView has **no documented rate limits** for `scanner.tradingview.com` because the endpoint is not a documented public API. Third-party rate limit references (90 requests per 10 seconds) come from reverse-engineering observations, not official documentation.

### Request Volume at 50 Users

Scenario: 50 users, each triggering 3–5 Claude advisory sessions/day, each session calling `tradingview_ta` 2–3 times:
- 50 users × 4 sessions × 2.5 indicator calls = **500 calls/day** to `scanner.tradingview.com`
- Peak hour (market open): potentially 50–100 calls in a 30-minute window

This is a modest volume, but the risk is not volume-based — it is **IP-based**. Railway's cloud IP ranges are already associated with data center scraping traffic. TradingView may pre-block these ranges regardless of volume.

### Community Reports

- **PythonAnywhere (multiple threads):** Confirmed 403 blocking on `scanner.tradingview.com` for cloud-hosted Python scripts. PythonAnywhere explicitly refused to whitelist the endpoint.
- **Proxy requirement:** The `python-tradingview-ta` library includes a `proxies` parameter explicitly because raw cloud IPs get blocked: "a bad proxy could result in TradingView rejecting your request."
- **No documented IP ban enforcement:** TradingView's ban documentation covers user account bans, not API IP blocks. However, the practical evidence of 403s on PythonAnywhere is consistent with IP-range filtering.

### Hosted Version Pricing

The maintainer operates a hosted version at `pro.cryptosieve.com`:
- **Pro:** $9/month — 2,500 calls/month, 60 calls/minute
- **Pro+:** $29/month — 10,000 calls/month, 150 calls/minute
- **3-day free trial** available

At 500 calls/day the hosted Pro plan (2,500/month) would exhaust in 5 days. Pro+ (10,000/month) would cover ~20 days. Neither is sufficient for the stated 50-user scenario. The hosted service also means trusting a third-party intermediary with production advisory traffic.

---

## 6. Alternatives

### 6A. Other MCP Servers for Market/Indicator Data

| Server | GitHub | Stars | Transport | RSI/MACD/MA | Notes |
|--------|--------|-------|-----------|-------------|-------|
| **Twelve Data (official)** | https://github.com/twelvedata/mcp | 71 | HTTP (cloud endpoint) + local | Yes — 60+ indicators | Official, vendor-maintained, free tier includes all indicators |
| **Polygon.io (official)** | https://github.com/polygon-io/mcp_polygon | 353 | stdio (local) | RSI, MACD, SMA, EMA | Official, US stocks focus, requires paid plan for indicators |
| **Alpha Vantage** | Community-maintained | ~100 | stdio | RSI, MACD, Bollinger, 50+ | Free 25 req/day; indicators available on all tiers |
| **narumiruna/yfinance-mcp** | https://github.com/narumiruna/yfinance-mcp | 156 | stdio | Via yfinance (limited) | No built-in indicator computation; OHLCV only |
| **kukapay/crypto-indicators-mcp** | github.com/kukapay/crypto-indicators-mcp | 126 | stdio | Yes (crypto-focused) | Crypto only, not stocks |
| **bidouilles/mcp-tradingview-server** | https://github.com/bidouilles/mcp-tradingview-server | 20 | stdio + SSE + HTTP | Via tradingview_scraper | 20 stars, low maturity, same TradingView endpoint risk |

### 6B. Building a Custom Lightweight Indicator Server

**Recommended data API: Twelve Data**

Twelve Data provides 130+ server-side computed technical indicators via REST API, including RSI, MACD, EMA, SMA, Bollinger Bands, ATR, and more. Indicators are returned pre-computed — you pass the symbol, interval, and indicator parameters, and get back the values directly.

Architecture for a custom MCP server:
```
Next.js backend (Railway)
  └─> createMCPClient → HTTP
        └─> Custom Python or Node.js MCP server (Railway service)
              └─> Twelve Data REST API (authenticated, official)
                    Returns: RSI, MACD, EMA20, EMA50, volume data
```

Custom server would be ~200 lines of Python using FastMCP + httpx, expose exactly the 6 tools needed, and have no abandoned dependencies.

### 6C. Polygon.io WebSocket Capability Inventory

Polygon.io (now rebranded as Massive at massive.com) offers:
- **Indicators:** SMA, EMA, MACD, RSI (4 indicators only — not volume analysis or technical summary)
- **Transport:** WebSocket for real-time trades/quotes; REST for indicators
- **Pricing:** Indicators available on paid plans; Starter plan approximately $29/month
- **Strengths:** Tick-level data, ultra-low latency, reliable US equity coverage
- **Weaknesses:** Only 4 technical indicators (no ATR, no Bollinger, no Stochastic), no technical summary (buy/sell/neutral signal), limited to US stocks + some crypto/forex, no pre-computed multi-indicator snapshots

Polygon is overkill for this use case (advisory engine, not HFT) and underserves the indicator breadth requirement.

### 6D. Twelve Data Full Capability Inventory

| Feature | Detail |
|---------|--------|
| Technical indicators | 130+ (RSI, MACD, SMA, EMA, Bollinger, ATR, ADX, Stochastic, VWAP, and more) |
| Free tier | 800 API credits/day, 8 credits/minute; all indicators included |
| Grow plan | $29/month; 5,000 credits/day, 55+ credits/minute |
| Official MCP server | Yes — https://github.com/twelvedata/mcp (71 stars, last commit June 18, 2026) |
| Cloud endpoint | `https://mcp.twelvedata.com/mcp` (OAuth-based, no self-hosting needed) |
| Language | Python, officially maintained by Twelve Data team |
| Reliability | Official vendor; no ToS risk; documented API; SLA available on paid plans |
| Streaming | WebSocket available on Grow plan and above |

At 50 users × 4 sessions × 2.5 calls = 500 calls/day, the **free tier (800 credits/day) is sufficient for development and early production**. The Grow plan ($29/month) handles unlimited daily volume.

### 6E. Local Indicator Computation Libraries

If you want to eliminate the external data API dependency entirely for the indicator computation step (while still using a data API for OHLCV prices):

| Library | Language | Stars | Indicators | Notes |
|---------|----------|-------|------------|-------|
| **TA-Lib** | Python (C core) | ~10k | 200+ (RSI, MACD, SMA, EMA, all major) | C library required; binary install on Railway via Docker; most comprehensive |
| **pandas-ta** | Python | ~5k | 130+ | Pure Python; easy install; no C dependency; actively maintained |
| **pandas-ta-classic** | Python | Fork | 250+ | Fork with TA-Lib acceleration support |
| **Tulip Indicators** | Python/C | ~1k | 104 | LGPL; lightweight; C-based |
| **technicalindicators** | npm/TypeScript | ~3.5k | 45+ (RSI, MACD, SMA, EMA, Bollinger) | Native TypeScript; integrates directly into Next.js backend |

**Recommended approach for this project:** Use `technicalindicators` (npm) directly in the Next.js backend. Fetch OHLCV data from Polygon.io or Twelve Data REST API, compute RSI/MACD/MA20/MA50 locally, return as MCP tool results. Eliminates the Python service entirely and keeps the stack homogeneous.

---

## 7. Verdict

### Is `atilaahmettaner/tradingview-mcp` suitable for this production use case?

**No. Not in its current form, for this specific deployment target.**

### Disqualifying Issues

**Issue 1 — stdio transport (architecture mismatch)**
The project's documented deployment is stdio-only. Railway requires a network-accessible service. The Vercel AI SDK v7 explicitly prohibits stdio in production. While FastMCP technically supports HTTP mode via `--transport http`, this is undocumented in the project, requires writing your own Dockerfile, and creates maintenance burden for an upstream project that doesn't acknowledge cloud deployment as a use case.

**Issue 2 — Archived core dependency**
The `python-tradingview-ta` library (the entire foundation of `tradingview_ta` and all technical indicator tools) has been archived since June 2024 with no new releases since October 2022. This is a frozen dependency with no security patch path and no ability to respond to TradingView endpoint changes.

**Issue 3 — Unofficial endpoint with cloud IP blocking risk**
`scanner.tradingview.com` is an undocumented internal TradingView endpoint. Cloud IPs (PythonAnywhere confirmed, Railway likely) get 403-blocked. This is not a configuration problem — TradingView does not permit programmatic data access from data center IPs through any documented mechanism. A proxy layer would be needed, adding cost and complexity, and still violates TradingView's terms downstream.

### What the Project Does Well

- Indicator coverage is exactly right (RSI, MACD, MA20, MA50, volume, summary all present)
- 3.6k stars and active forks indicate the community finds it useful for local/desktop use
- 30+ tools including backtesting is well beyond what the advisory engine needs
- MIT license, no cost for self-hosting
- The hosted version at pro.cryptosieve.com is a real option if the IP blocking issue matters less at low volume

### Recommended Replacement

**Path A (Lowest friction):** Use the official Twelve Data MCP server at `https://mcp.twelvedata.com/mcp`. It is cloud-hosted, OAuth-secured, requires no Railway Python service, exposes 60+ indicators including all required ones, and the free tier handles up to 800 calls/day. Connect via Vercel AI SDK v7 HTTP transport directly.

```javascript
// In Next.js advisory engine
const mcpClient = await createMCPClient({
  transport: {
    type: 'http',
    url: 'https://mcp.twelvedata.com/mcp',
    headers: { Authorization: 'Bearer TWELVE_DATA_API_KEY' },
  },
});
```

Cost: $0 for development, $29/month (Grow) for production scale.

**Path B (Maximum control, no external MCP dependency):** Build a minimal custom MCP server (Python + FastMCP, ~150 lines) on Railway that calls Twelve Data REST API for RSI/MACD/MA20/MA50/volume, returns exactly the 6 tools defined in the spec, and exposes HTTP transport on `/mcp`. No archived dependencies, documented API, ToS-compliant.

**Path C (Keep Python-free, stay in Node.js):** Use the `technicalindicators` npm package in the Next.js backend directly. Fetch OHLCV candles from Twelve Data or Polygon.io REST, compute all 6 indicators locally, expose them as standard AI SDK tools (not MCP). Eliminates the Python service entirely. Best fit for a project already invested in the Node.js/Next.js stack on Railway.

### Caveats if You Proceed with `atilaahmettaner/tradingview-mcp` Anyway

If the advisory engine is internal-only, low traffic, and you're willing to accept ToS risk:
1. Run it locally via stdio and connect via Claude Desktop — this is the intended use case
2. For Railway: write a Dockerfile using FastMCP HTTP transport; plan for 403s from TradingView's scanner; keep a proxy budget (~$10/month for a residential proxy service); monitor issue #77 and #76 for when the async event loop blocking is resolved
3. Pin `tradingview-ta` dependency to the exact archived version and watch for any TradingView endpoint changes manually
4. The Pro hosted plan at pro.cryptosieve.com ($29/month) eliminates the IP blocking issue but adds a third-party dependency and caps at 10,000 calls/month

---

## Source Index

- GitHub repo: https://github.com/atilaahmettaner/tradingview-mcp
- Issues page: https://github.com/atilaahmettaner/tradingview-mcp/issues
- python-tradingview-ta (archived): https://github.com/AnalyzerREST/python-tradingview-ta
- python-tradingview-ta PyPI: https://pypi.org/project/tradingview-ta/
- Twelve Data MCP server: https://github.com/twelvedata/mcp
- Twelve Data pricing: https://twelvedata.com/pricing
- Polygon.io MCP server: https://github.com/polygon-io/mcp_polygon
- Polygon.io indicators: https://massive.com/knowledge-base/article/does-polygon-offer-any-technical-indicators
- Vercel AI SDK MCP docs: https://ai-sdk.dev/docs/ai-sdk-core/mcp-tools
- FastMCP deployment guide: https://gofastmcp.com/deployment/running-server
- Railway MCP server guide: https://docs.railway.com/guides/mcp-server
- Railway FastMCP deploy: https://railway.com/deploy/fastmcp
- PythonAnywhere TradingView blocking thread: https://www.pythonanywhere.com/forums/topic/30466/
- PythonAnywhere 403 error thread: https://www.pythonanywhere.com/forums/topic/30334/
- Pineify blog (data source analysis): https://pineify.app/resources/blog/tradingview-mcp-server-ai-trading-analysis
- AwesomeClaude finance MCP rankings: https://awesomeclaude.ai/mcp/finance-fintech
- Lambda Finance MCP comparison: https://www.lambdafin.com/articles/mcp-server-stock-market-data
- MCP deployment platform comparison: https://mcpplaygroundonline.com/blog/deploy-mcp-server-vercel-railway-render-heroku-flyio
- bidouilles/mcp-tradingview-server: https://github.com/bidouilles/mcp-tradingview-server
- Cloudflare Python MCP deployment: https://blog.cloudflare.com/streamable-http-mcp-servers-python/
