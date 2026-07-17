---
label: wayfinder:grilling
status: closed
assignee:
parent: map
blocks: [010]
blocked-by: [002]
---

# How should TradingView be integrated given its actual capabilities?

## Decision: Lightweight Charts v5 + deepentropy, Yahoo Finance data, webhook alerts, full portfolio overlays

## Decisions

1. **Chart integration method:** Lightweight Charts v5 (MIT, self-hosted) as the primary chart experience. deepentropy indicator library (446+ indicators) for technical analysis. TradingView widget embeds used selectively only for supplemental components: ticker tape (scrolling price strip) and economic calendar. Widget embeds ruled out for primary charts — cannot accept external data, iOS Safari ITP breaks iframe storage, bad mobile UX. Charting Library ruled out — requires commercial license not applicable to a personal project.

2. **Market data source:** Yahoo Finance (via community npm library) for historical and daily-refresh OHLCV data. Covers TSX-listed and US securities. Effectively free. Fragility risk accepted — community libraries stay current. Polygon.io is the upgrade path when real-time intraday is needed; no architectural change required — swap the data source behind the same chart feed interface. Real-time intraday deferred.

3. **Alert integration:** TradingView webhook → Railway backend endpoint → stored in Turso (ticker, price, condition, timestamp) → surfaced in app alert feed → user-triggered LLM analysis on demand. LLM does NOT auto-run on every alert — user taps an alert to trigger analysis. Best-effort delivery accepted (no retries, 5s timeout, 15/3-min rate limit, no delivery guarantee). Shared secret embedded in alert message body for security (no auth headers available). Missed alerts are accepted — no fallback mechanism.

4. **Wealthsimple portfolio overlay:** Full overlays rendered on Lightweight Charts using holdings data already in Turso (ticket 005). Per symbol: cost basis horizontal line, entry date marker, position size label. Data flow: chart load → backend queries Turso for holdings matching ticker → returns market data + position data → chart renders both. "All QOL addons" principle: when a data point exists and can be visualized, visualize it. Carry this principle forward to ticket 011 (UI structure).

5. **Mobile rendering:** Lightweight Charts on mobile — same full chart experience as web. Touch events configured explicitly (pinch-to-zoom, scroll behavior). SSR handled via `dynamic(() => import(...), { ssr: false })` in Next.js. No simplified mobile-only chart view — library handles mobile well. Supplemental widget embeds (ticker tape, economic calendar) have known iOS Safari issues but are non-critical.

6. **Licensing boundary:** Lightweight Charts is MIT-licensed — no restrictions. Charting Library commercial license not pursued. If Lightweight Charts is ever deprecated, any open-source charting library (Chart.js, Recharts, ECharts) can replace the rendering layer without changing the data feed interface.

## Flag for Ticket 010
`tradesdontlie` MCP server — exposes TradingView indicator data as Model Context Protocol tools, enabling Claude to query TradingView data directly as a tool call during advisory sessions. Evaluate as a data source for the LLM advisory engine alongside Wealthsimple portfolio data and bank transaction data.
