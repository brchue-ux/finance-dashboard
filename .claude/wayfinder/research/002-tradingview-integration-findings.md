# Research Findings: TradingView Integration Surface

**Ticket:** 002-tradingview-integration-surface
**Initial date:** 2026-07-15
**Updated:** 2026-07-16
**Agent searches:** 70+ tool uses, 35+ web searches across all 10 required topic areas

---

## 1. TradingView Lightweight Charts (Open-Source, Self-Hosted)

### What It Is
- Apache 2.0-licensed (not MIT — corrected from prior finding), open-source charting library by TradingView
- GitHub: https://github.com/tradingview/lightweight-charts
- Current version: **v5.2** (latest as of mid-2026; major breaking changes from v4)
- Self-hosted — you feed your own data in
- No TradingView branding required
- Sub-45KB bundle size; canvas-based rendering at 60+ FPS with thousands of data points

### Chart Types (v5)
- Candlestick, bar, line, area, baseline, histogram charts
- **New in v5:** Multi-pane charts (multiple independent chart areas in one container)
- **New in v5:** Yield curve charts (financial analysis)
- **New in v5:** Options charts (price values on the horizontal scale)
- **No built-in technical indicators** — the library is display-only for raw OHLCV data
- Plugin system (v5) allows adding indicators, but they must be implemented or sourced separately

### v5.2 Specific Features
- **Hit testing:** Series hit testing with mouse event payloads including `hoveredItem` and `hoveredTarget`, exposing the hovered series and metadata
- **Price scale tick density:** `tickMarkDensity` option controls label density
- **Data conflation:** `conflationThresholdFactor` option for zoom-level smoothing — useful for sparklines
- **Plugin aggregation:** `CustomConflationReducer` interface for custom aggregation logic in plugins — particularly useful for large historical datasets and real-time feeds
- **Hovered series on top:** `hoveredSeriesOnTop` option (default: true) renders hovered series above others

### Data Feed Format
- Accepts `{time, open, high, low, close, volume}` objects
- Time must be Unix timestamp (seconds) — UTC
- Real-time updates via `.update()` method; historical data via `.setData()`
- `createChart()` returns `IChartApi` for all chart interactions

### React Native / Expo Compatibility
- **No native React Native support and none planned** — confirmed via GitHub Discussion #733
- **Workaround:** Embed in a `WebView` component — officially supported and guaranteed to work inside WebView on iOS and Android
- For Expo apps targeting web (Vercel), standard browser integration applies; for Android APK target, WebView is the integration path

### SSR / Next.js Pattern
- Lightweight Charts requires browser APIs (canvas, DOM) — incompatible with SSR
- Required pattern: create chart inside `useEffect`, import component with `next/dynamic(() => import('./ChartComponent'), { ssr: false })`
- In Next.js App Router: mark the chart component with `'use client'` directive
- Documented in GitHub Issue #543 and confirmed in community tutorials

### Known GitHub Bugs (v5)
- **Issue #2049:** Timezone handling regression in v5 — UTC offset display inconsistencies
- **Issue #552:** Memory leak error — reported and tracked; `chart.remove()` does not always release all references
- **Issue #1155:** Unreliable memory leak test — the v4.0 memlab integration was added precisely to catch these
- **Issue #946:** Paint slowdown after many real-time updates — throttle/batch updates before sending to the library
- **Issue #1441:** On iOS, page is not scrollable if `handleScroll` is false and a Y-axis scroll is attempted
- **Issue #80:** Chart captures touch events and prevents vertical page scroll on iOS touch devices
- **v5 breaking changes guide:** Issue #1791 documents all breaking changes; v4 code requires significant migration of the Series API

### Memory Management (Critical)
- Official docs state: "the most common source of memory leaks occurs when the chart widget is removed, but its resources are not fully released because your code holds a reference to it"
- Required cleanup sequence: (1) call `chart.remove()`, (2) unsubscribe from all data subscriptions, (3) null out all references to the chart or any ISeriesApi handles
- v4.0 integrated Meta's `memlab` library for memory leak detection in tests
- Excessive real-time updates cause resource-intensive re-rendering — throttle upstream

---

## 2. The deepentropy Ecosystem (Major Community Resource)

Beyond the core library, a single developer (deepentropy) has built the de facto standard production toolkit for Lightweight Charts apps:

### lightweight-charts-indicators
- **GitHub:** https://github.com/deepentropy/lightweight-charts-indicators
- **Stars:** 122 (niche but foundational)
- **Content:** 446 technical analysis indicators — 82 standard, 317 community, 44 candlestick patterns
- **Compatibility:** v5 compatible with full drawing primitive support (lines, boxes, labels, tables)
- PineScript v6 compatibility
- Officially featured in TradingView's own Lightweight Charts discussions (#2027)

### lightweight-charts-drawing
- **GitHub:** https://github.com/deepentropy/lightweight-charts-drawing
- **Content:** 68 drawing tools — trend lines, Fibonacci, Gann, channels, pitchforks, shapes, annotations, forecasting tools
- Built for v5

### oakview
- **GitHub:** https://github.com/deepentropy/oakview
- **What:** Lightweight, embeddable Web Component wrapper for Lightweight Charts
- Uses `<oak-view>` custom element directly in HTML
- Flexible data provider system with OHLCV bar format (Unix timestamps in seconds)
- Useful for embedding charts without a framework dependency

### React Wrappers (Community)
Two npm packages exist; neither is popular, and one is abandoned:
- **`lightweight-charts-react-components`** — actively maintained, version 2.1.0, 574 weekly downloads. GitHub: https://github.com/ukorvl/lightweight-charts-react-components
- **`lightweight-charts-react-wrapper`** — last published 2 years ago, effectively deprecated. GitHub: https://github.com/trash-and-fire/lightweight-charts-react-wrapper

**Recommendation:** Write your own thin React wrapper using `useEffect` per the official tutorial at https://tradingview.github.io/lightweight-charts/tutorials/react/advanced — the official advanced React example is the canonical pattern.

---

## 3. TradingView Widget Embeds (Iframe-Based)

### Available Widget Types (20+)
- Advanced Real-Time Chart (most feature-rich)
- Mini Chart
- Ticker Tape (scrolling price strip)
- Market Overview
- Market Data
- Economic Calendar
- Stock Screener
- Symbol Overview
- Technical Analysis (buy/sell summary)
- Fundamental Data
- Company Profile
- Top Stories (news)
- Single Quote
- Forex Cross Rates
- Crypto Market Cap

### Widget Formats
Two formats are available per TradingView's widget-docs:
- **Iframe:** pure `<iframe>` with `<script>` injection; older format
- **Web Component:** wrapper around an iframe with slightly better DOM integration; both formats display identical content

### Customization Options
- `symbol`, `colorTheme` (light/dark), `isTransparent`, `locale` — available on most widgets
- `autosize` (uses container size for height) — must define container height explicitly
- `largeChartUrl` on Ticker Tape — redirect target on symbol click (allows deep-linking to your own chart page)
- CSS tokens for color customization
- Toolbar, drawing tools, studies — configurable via constructor options on the Advanced Chart widget
- **Hard limit:** You cannot inject custom data overlays into widget embeds. Widgets only show TradingView's own data.

### Known Issues — Mobile (iOS Safari)
- **ITP (Intelligent Tracking Prevention):** Safari blocks third-party iframe storage, causing widget state loss on reload
- iOS iFrames are not scrollable even when `scrolling=yes` is specified — WebKit bug #149264, longstanding
- Chart captures touch events, blocking vertical page scroll — GitHub Issue #80, #1441
- `horz_touch_drag_scroll` and `vert_touch_drag_scroll` options exist in Advanced Charts to manage this, but are only available in the Charting Library, not the free widgets
- Layout shifts during iframe initialization on iOS

### Known Issues — CSP / Next.js
- TradingView has been progressively applying CSP to its own origins
- Embedding requires `frame-src https://s.tradingview.com` in your app's Content Security Policy
- Next.js Pages Router: set via `next.config.js` headers
- Next.js App Router: use `middleware.ts` to set response headers
- Nonces required for script-src when using strict CSP — but note: nonce-based CSP forces all pages to be dynamically rendered (no static export)
- WP-Rocket WordPress caching plugin strips widget initialization scripts — documented conflict
- **Blank chart race condition:** widget script loads before DOM ready — requires `DOMContentLoaded` guard or `useEffect` in React

### React Integration Pattern
```js
useEffect(() => {
  const container = document.getElementById('chart-container');
  const script = document.createElement('script');
  script.src = 'https://s3.tradingview.com/tv.js';
  script.async = true;
  script.onload = () => {
    new window.TradingView.widget({ container_id: 'chart-container', symbol: 'NASDAQ:AAPL', ... });
  };
  container.appendChild(script);
  return () => {
    // cleanup: remove script and clear container DOM
    container.innerHTML = '';
  };
}, [symbol]); // re-run on symbol change
```
- Must destroy and reinitialize on prop changes
- Memory leak if cleanup does not remove the script tag and DOM nodes

---

## 4. TradingView Advanced Charts / Charting Library (Commercial)

### What It Adds Over Lightweight Charts
- Built-in 100+ technical indicators and drawing tools (no external library needed)
- Full Broker API (place orders within the chart — for broker partners only)
- Custom studies via Pine Script-like API
- Saved layouts and templates
- Multi-pane charts, symbol comparison (also now in Lightweight Charts v5)
- Mobile-specific API: `horz_touch_drag_scroll`, `vert_touch_drag_scroll` for fine-grained touch control
- Built-in news widget (but requires your own news provider implementation via `rss_news_feed` or `news_provider` property)

### License Terms (Updated — Important Correction)
The free license agreement (v.0325.FAC) states:

> "Advanced Charts licenses are only available to companies for use in **public web projects and/or applications** (as a free offering only), and **not for private, personal or internal uses** such as blogs, research papers, or other unpublished media."

This is more restrictive than previously noted. The free license:
- Is for **publicly accessible, free-to-use products** — not personal finance dashboards
- Requires TradingView to have "free, unlimited access" to your implementation for compliance monitoring
- Requires attribution/branding link back to TradingView
- Explicitly excludes personal projects

Commercial license:
- Application via TradingView developer portal — not guaranteed
- Pricing not public; third-party developer reports suggest ~$30K setup + per-user fees (unconfirmed, contact TradingView sales directly)
- Access only after signing agreement; API spec shared only post-agreement

### Recommendation for This App
The free Advanced Charts license does not apply to a personal finance dashboard. A commercial license would be required and is cost-prohibitive for a personal project. **Lightweight Charts v5 + deepentropy ecosystem is the correct path.**

---

## 5. TradingView Data Feed / UDF API

### Key Finding: UDF is Input-Only
The **Universal Data Feed (UDF)** protocol is the API contract that the Advanced Charts library uses to call against your data server. It describes how TradingView's charts request OHLCV data from a backend you implement. You feed data IN to TradingView charts using UDF; you cannot pull market data OUT of TradingView via UDF.

### Can You Pull Market Data OUT of TradingView?
**No official API exists for this.** TradingView does not expose a public market data API.

### Unofficial / Reverse-Engineered Data Access
- **`tradingview-ta`** (Python, PyPI) — scrapes TradingView's internal TA summary endpoint (buy/sell/neutral signals, indicator values)
  - Against TradingView ToS
  - Fragile; breaks periodically with TradingView updates
  - Community use is widespread
  - Potential value: feeding TV's TA summary (RSI overbought/oversold flags etc.) into LLM context without computing indicators yourself
- **`tradingview-scraper`** (Python) — OHLCV data extraction via undocumented endpoints
  - Same ToS and fragility concerns

### Implication for This App
Market data for the LLM advisory engine must come from a separate data source (Alpha Vantage, Polygon.io, Yahoo Finance API, Wealthsimple's own data). TradingView is a chart display surface only, not a data source for external computation.

---

## 6. Webhooks and Alerts

### How TradingView Alerts Work
1. User creates an alert in TradingView (price level, indicator condition, or Pine Script condition)
2. Alert is configured with a "Webhook URL" in the alert creation dialog
3. When the alert fires, TradingView POSTs the message body to the URL

### Technical Constraints (Updated with New Data)
- **HTTPS required** — HTTP endpoints silently fail with no error shown to the user
- **3-second timeout** (not 5 as previously noted — official docs confirm 3 seconds including DNS resolution time)
- **Retry behavior (corrected):** If TradingView receives HTTP 500-599, it retries up to 3 times at 5-second intervals. For timeout, connection refused, or 4xx errors — **silently dropped, no retry, no queue**
- **Endpoint design pattern:** Return HTTP 200 immediately; process the alert asynchronously in a background job/queue
- **Rate limit:** approximately 15 alerts per 3-minute window per account (per-user on TradingView's side, not your endpoint)
- **No built-in authentication** — community pattern is to include a shared secret in the alert message body (embedded as a JSON field)

### Exact Webhook Payload
TradingView sends whatever you write in the "Message" field as the POST body. If the message is valid JSON, TradingView sends it with `application/json` content-type; otherwise plain text. Example:
```json
{
  "secret": "your-shared-secret",
  "ticker": "{{ticker}}",
  "exchange": "{{exchange}}",
  "interval": "{{interval}}",
  "price": {{close}},
  "time": "{{time}}",
  "action": "BUY"
}
```

### Alert Delivery Reliability (New Data)
- TradingView alerts glitches hit approximately 25% of users during volatility spikes (Downdetector data, September 2025)
- Global outage: November 17, 2025 — alerts down worldwide
- Push alerts lag on mobile with reported 20-second delays (community reports on X/Twitter)
- Duplicate delivery occurs with "Every Tick" / "Every Time" setting — use "Once Per Bar Close" to mitigate
- Invalid JSON payloads reject ~15% of attempts per community tracking (2025 data)
- **Verdict:** Alerts are best-effort delivery. Not suitable for time-critical automated actions without a secondary confirmation mechanism.

### Alert Plan Limits by Subscription Tier (2026)
| Plan | Active Alerts | Webhooks | Alert Expiry |
|------|--------------|----------|--------------|
| Free | 3 price alerts | No | N/A |
| Essential | 20 | Yes | ~60 days |
| Plus | 20+ | Yes | ~60 days |
| Premium | 800 (400 price + 400 technical) | Yes | Never |
| Ultimate | 2000 (1000 price + 1000 technical) | Yes | Never |

**Key implication:** Webhooks require at minimum the Essential plan. For a production advisory pipeline with many alerts, Premium is the practical minimum to avoid alert expiry and limits.

---

## 7. Pine Script Alert Placeholders

Full table of available `{{placeholder}}` variables in alert messages:

| Placeholder | Description | Available In |
|-------------|-------------|--------------|
| `{{ticker}}` | Symbol name | All alerts |
| `{{exchange}}` | Exchange name | All alerts |
| `{{interval}}` | Chart timeframe | All alerts |
| `{{close}}` | Current close price | All alerts |
| `{{open}}` | Current open price | All alerts |
| `{{high}}` | Current high price | All alerts |
| `{{low}}` | Current low price | All alerts |
| `{{volume}}` | Current volume | All alerts |
| `{{time}}` | Alert trigger time (UTC) | All alerts |
| `{{timenow}}` | Current time at delivery | All alerts |
| `{{plot_0}}` through `{{plot_19}}` | Named plot values from Pine Script | Pine Script alerts only |
| `{{strategy.order.action}}` | Buy/Sell | Strategy alerts only |
| `{{strategy.order.contracts}}` | Position size | Strategy alerts only |
| `{{strategy.order.price}}` | Order price | Strategy alerts only |
| `{{strategy.position_size}}` | Current position | Strategy alerts only |

**Key design point:** `{{strategy.*}}` placeholders fire once per strategy order event, making a single alert serve buys, sells, and reversals without hardcoding direction. Custom computed values must be output via `plot()` in Pine Script to appear as `{{plot_N}}`.

---

## 8. Known Bugs and Runtime Issues (Full Table)

| Issue | Severity | Workaround |
|-------|----------|------------|
| iOS Safari ITP blocks iframe storage | High | Use Lightweight Charts instead of widgets on mobile |
| iOS iframe scroll blocked (WebKit bug #149264) | High | WebView approach or Lightweight Charts; no CSS fix reliably works |
| Chart captures touch events, blocks page scroll (LWC Issue #80, #1441) | High | `handleScroll: false` + explicit touch handling; test on real device |
| React memory leak on chart destroy | High | Call `chart.remove()`, unsubscribe all, null all references in `useEffect` cleanup |
| SSR incompatibility (Lightweight Charts) | High | `next/dynamic` with `ssr: false`; or `'use client'` + `useEffect` in App Router |
| Blank chart race condition (widgets) | Medium | Lazy-load widget scripts after DOM ready; use `onload` callback |
| v5 breaking changes from v4 | Medium | Read Issue #1791 migration guide before any v4 → v5 upgrade |
| CSP conflicts in Next.js | Medium | Add `frame-src https://s.tradingview.com` and `script-src` whitelist; nonce-based CSP forces dynamic rendering |
| Alert delivery unreliability | High | Do not rely on alerts for time-critical actions; design for dropped alerts |
| No retry on failed webhooks (timeout/4xx) | High | Return 200 immediately, process async; accept up to ~25% loss under load |
| Duplicate alerts on "Every Tick" | Medium | Use "Once Per Bar Close" setting |
| Alert expiry on Essential/Plus plans | Medium | Use Premium+ for production pipelines; or re-create alerts on schedule |
| JSON payload rejection (~15% rate) | Medium | Validate JSON structure with placeholders before deploying; test in sandbox |
| High real-time update frequency causes paint slowdown | Medium | Throttle/batch upstream data before sending to `chart.update()` |

---

## 9. Scaling Concerns

### Widget Licensing at Scale
- Widget embeds are free for all end users — no per-user licensing for widget views
- No documented rate limits on widget loads (widgets pull from TradingView's CDN)
- ToS prohibits commercial use of widgets in ways that compete with TradingView — personal finance advisory dashboard is low-risk
- Each widget embed loads approximately 300-500KB of JavaScript from TradingView's CDN
- Multiple widgets on one page can significantly slow initial load — use Intersection Observer for lazy loading (load widget only when it enters viewport)

### Alert Webhook Burst Handling
- TradingView's per-account rate limit (approximately 15 alerts/3 min) naturally caps burst volume
- Your webhook endpoint must respond within 3 seconds regardless of concurrent load
- Recommended architecture: endpoint immediately enqueues alert to a job queue (e.g., BullMQ, Upstash Queue), returns 200, worker processes asynchronously
- If many user accounts each set TradingView alerts pointing at your server, ensure your endpoint can handle concurrent 3-second-window bursts without queue backup

### Concurrent Chart Instances
- Multiple Lightweight Charts instances per page are supported but each instance holds its own canvas and data — memory compounds with instance count
- Clean up instances aggressively when navigating away from chart views

---

## 10. Prior Art — GitHub Projects

### MCP Servers for Claude + TradingView (New — High Value)

| Project | Stars | Approach | Link |
|---------|-------|----------|------|
| `tradesdontlie/tradingview-mcp` | 4,200 | Connects Claude Code to TradingView Desktop app via Chrome DevTools Protocol (CDP, port 9222). 81 tools: chart state, symbol/timeframe control, indicator values (RSI, MACD, BBands), Pine Script development, drawings, alerts, replay, screenshots. Runs fully locally — no TradingView API, no data exfiltration. | https://github.com/tradesdontlie/tradingview-mcp |
| `atilaahmettaner/tradingview-mcp` | 3,548 | Python-based MCP server for real-time market data, TA, screeners, and backtesting. Works with Claude, ChatGPT, Cursor. 30+ tools. Fetches data from public TradingView endpoints. Available hosted at pro.cryptosieve.com ($9-$29/mo) or self-hosted. No TradingView account required. | https://github.com/atilaahmettaner/tradingview-mcp |
| `LewisWJackson/tradingview-mcp-jackson` | Fork | Fork of tradesdontlie's MCP; adds morning brief workflow, rules config, fixes TradingView Desktop v2.14+ launch bug. | https://github.com/LewisWJackson/tradingview-mcp-jackson |
| `jackson-video-resources/claude-tradingview-mcp-trading` | Low | Connects Claude Code to TradingView and executes trades via BitGet automatically. | https://github.com/jackson-video-resources/claude-tradingview-mcp-trading |
| `tradermonty/claude-trading-skills` | Active | Claude Code skills for equity investors — market analysis, technical charting, economic calendars, CANSLIM/VCP screeners, strategy development. Pre-built skill packages for Claude's web app. Includes /pre-market-routine, /after-close-review, /trade-journal workflows. Not automated trading; human gates remain. | https://github.com/tradermonty/claude-trading-skills |

### Alert Webhook Automation Projects

| Project | Description |
|---------|-------------|
| `lth-elm/TradingView-Webhook-Trading-Bot` | Flask app receiving TradingView alerts and placing orders or sending chart screenshots to Discord for human confirmation. GitHub: https://github.com/lth-elm/TradingView-Webhook-Trading-Bot |
| PineConnector | Commercial middleware routing TradingView webhooks to MT4/MT5. 66,000+ retail traders, 167M+ signals processed, Azure infrastructure, ~1s end-to-end latency. 8.68/10 recommendation score. Demonstrates what a reliable webhook relay looks like at scale. https://www.pineconnector.com/ |
| TradersPost | Managed platform for TradingView → broker order routing via webhooks. Publishes TradingView integration docs. https://traderspost.io |
| `fabston` trading bot | Python bot driven by TradingView Pine Script webhooks |
| `robswc` Python framework | Framework for building webhook-driven trading systems |

### Lightweight Charts Finance Dashboards

| Project | Description |
|---------|-------------|
| Bloomberg-inspired portfolio dashboard | React + Express + Yahoo Finance; real-time quotes, heatmap, screener, backtesting |
| Next.js 14+ stock market dashboard | TypeScript portfolio project demonstrating senior full-stack patterns with Lightweight Charts |
| Crypto PnL dashboard | Dev.to tutorial: building a crypto P&L tracker with Lightweight Charts (React) |
| `deepentropy/oakview` | Web Component wrapper — embed charts without framework dependency |

---

## 11. Opportunities

### Economic Calendar Widget
- TradingView provides a free embeddable economic calendar widget
- Customizable by currency, importance level
- No auth required; plain embed code
- Could feed macro event context directly to the LLM advisory engine (upcoming Fed decisions, earnings, macro data releases)
- Widget docs: https://www.tradingview.com/widget-docs/widgets/calendars/economic-calendar/

### News Widget (Top Stories)
- Free embeddable widget at https://www.tradingview.com/widget-docs/widgets/news/top-stories/
- Displays headlines filtered by symbol
- The Advanced Charts library's built-in news panel requires you to provide your own news provider (via `rss_news_feed` or custom `GetNewsFunction`) — not applicable for Lightweight Charts

### Stock Screener Widget
- Free embeddable screener widget: https://www.tradingview.com/widget-docs/widgets/screeners/screener/
- Sorts symbols by fundamental and technical indicators
- Iframe-only; cannot extract data programmatically from the widget

### Broker Integration Program
- TradingView has a broker partner program for executing trades directly from TradingView charts
- Requires implementing TradingView's Broker API and Datafeed API specs
- Application is free; commercial terms are custom-quoted and confidential
- 100+ brokers currently integrated
- **Not relevant for this app** (read-only advisory, not execution)

### Portfolio Data Inside TradingView Charts
- **Not possible via widgets or official means** — TradingView embeds cannot accept external data
- **Possible with Lightweight Charts:** Overlay Wealthsimple position data (entry price horizontal lines, position size annotations, P&L labels) directly on charts using custom series markers and price lines
- This is a significant UX opportunity: see your actual holdings annotated on the same chart you're analyzing

### LLM + TradingView Alert Pipeline (Recommended Architecture)
The most practical integration path for this app:

```
TradingView alert fires
    → POST to app backend webhook endpoint
    → Return 200 immediately
    → Enqueue to background job
    → Worker pulls current portfolio state (Wealthsimple)
    → Worker pulls current budget state (bank transactions)
    → Assemble context: alert payload + portfolio positions + budget snapshot
    → Claude API call with structured context
    → Store advisory response
    → Push notification to user via app
```

This pipeline is best-effort (alerts may drop) but provides real-time advisory triggers for zero-latency market events without polling.

### MCP Server Integration for Development Workflow
The `tradesdontlie/tradingview-mcp` (4,200 stars) enables Claude Code to directly read live TradingView charts via CDP during development. This means Claude can:
- Read current indicator values from any chart you're viewing
- Write and inject Pine Script directly
- Control symbol/timeframe on the active chart

This is a **development-time tool**, not a production server component. For production, the alert webhook pipeline (above) is the correct integration.

The `atilaahmettaner/tradingview-mcp` (3,548 stars) is different — it fetches from TradingView's public data endpoints and can be used as a server-side data source. Caveat: uses unofficial endpoints (ToS risk) and is available as a hosted service at $9-29/mo.

---

## 12. Summary Recommendation (Updated)

| Component | Recommendation | Notes |
|-----------|---------------|-------|
| Charts display (web) | Lightweight Charts v5 + deepentropy indicator/drawing libraries | Apache 2.0, self-hosted, no TradingView branding required |
| Charts display (Expo Android) | WebView wrapper around LWC HTML page | No native support; WebView is the only path |
| Widget embeds | Use selectively: Economic Calendar, Ticker Tape, Top Stories | Avoid for main charts on mobile; iframe scroll issues on iOS Safari |
| Market data source | Polygon.io, Alpha Vantage, or Yahoo Finance | TradingView cannot be used as external data source |
| Alert integration | TradingView webhook → immediate 200 → BullMQ/Upstash → Claude analysis | Essential plan minimum; Premium for production volume |
| LLM pipeline trigger | Alert webhook as async trigger; do not block on processing | Design for up to 25% alert drop rate under load |
| Portfolio overlay | Lightweight Charts price lines + series markers from Wealthsimple data | Major UX differentiator vs standard chart apps |
| Advanced Charts Library | Not applicable (license excludes personal projects; cost-prohibitive) | Would require commercial license at ~$30K+ |
| Dev-time AI tooling | `tradesdontlie/tradingview-mcp` for Claude Code ↔ TradingView Desktop | Development workflow only; not production infrastructure |

---

## Sources Consulted

- https://github.com/tradingview/lightweight-charts
- https://tradingview.github.io/lightweight-charts/docs/release-notes
- https://www.tradingview.com/blog/en/tradingview-lightweight-charts-version-5-50837/
- https://www.tradingview.com/widget-docs/widget-formats/
- https://www.tradingview.com/widget-docs/tutorials/
- https://s3.amazonaws.com/tradingview/charting_library_license_agreement.pdf
- https://www.tradingview.com/advanced-charts/
- https://www.tradingview.com/support/solutions/43000529348-how-to-configure-webhook-alerts/
- https://www.tradingview.com/support/solutions/43000776894-what-do-errors-mean-when-sending-webhooks/
- https://blog.pickmytrade.trade/troubleshooting-tradingview-alerts-issues-solutions-2025/
- https://blog.pickmytrade.io/tradingview-webhook-automation-trading-alerts/
- https://github.com/tradesdontlie/tradingview-mcp
- https://github.com/atilaahmettaner/tradingview-mcp
- https://github.com/tradermonty/claude-trading-skills
- https://github.com/deepentropy/lightweight-charts-indicators
- https://github.com/deepentropy/lightweight-charts-drawing
- https://github.com/deepentropy/oakview
- https://github.com/ukorvl/lightweight-charts-react-components
- https://github.com/tradingview/lightweight-charts/issues/552
- https://github.com/tradingview/lightweight-charts/issues/1441
- https://github.com/tradingview/lightweight-charts/issues/80
- https://github.com/tradingview/lightweight-charts/issues/1791
- https://github.com/tradingview/lightweight-charts/discussions/733
- https://www.tradingview.com/brokerage-integration/
- https://www.tradingview.com/widget-docs/widgets/calendars/economic-calendar/
- https://www.tradingview.com/widget-docs/widgets/news/top-stories/
- https://www.tradingview.com/widget-docs/widgets/screeners/screener/
- https://www.tv-hub.org/guide/tradingview-alerts-setup
- https://www.pineconnector.com/
- https://pineify.app/resources/blog/tradingview-webhook-delay-understanding-latency-issues-and-how-to-minimize-them
- https://github.com/lth-elm/TradingView-Webhook-Trading-Bot
- https://bugs.webkit.org/show_bug.cgi?id=149264
