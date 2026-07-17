---
label: wayfinder:research
status: closed
assignee:
parent: map
blocks: [006, 010]
blocked-by: []
---

# What does TradingView actually expose for third-party integration?

## Question

TradingView is primarily a charting and analysis platform. What can a third-party web app actually integrate with — for both display and data?

Research must cover:

**Integration surfaces:**
- TradingView Lightweight Charts: open-source library, self-hosted, full capability inventory, what data formats it accepts, how to feed custom data into it
- TradingView widget embeds: iframe-based widgets, what symbol/interval/theme customization is possible, mobile behavior, CSP/CORS issues, known iframe restrictions
- TradingView Charting Library: commercial license requirement, capabilities beyond Lightweight Charts, cost/access model, who qualifies
- TradingView Data Feed API (UDF): can you pull market data *out* of TradingView, or is it only for feeding data *in* to their charts?
- Webhooks and alerts: how TradingView alert webhooks work, what JSON payload they send, latency, reliability, can they POST to a self-hosted endpoint?
- Pine Script alert integration: what data Pine Script alerts can include in webhook payloads, what others have built on top of this

**Known bugs and limitations:**
- iframe restrictions on iOS Safari and mobile browsers
- Widget initialization failures, load time issues, blank chart bugs
- Alert webhook reliability: dropped alerts, duplicate delivery, delay under load
- Content Security Policy conflicts when embedding in a Next.js/SvelteKit app
- Lightweight Charts known issues and open GitHub bugs

**Scaling concerns:**
- If multiple users embed TradingView widgets: licensing implications, concurrent widget load, rate limits
- Alert volume: if many alerts fire simultaneously, what happens to the webhook endpoint?

**Runtime issues:**
- Widget re-initialization on React/SvelteKit re-renders
- Memory leaks with chart instances
- Mobile performance of embedded charts

**Prior art:**
- GitHub projects integrating TradingView into personal finance or trading dashboards (enumerate by name, link, approach)
- Existing apps using TradingView alert webhooks to drive automated actions (enumerate)
- Community resources: TradingView Pine Script community, known workarounds for common integration problems

**Opportunities:**
- Any lesser-known TradingView features useful for this app (screener API, economic calendar, news feed)?
- TradingView partner or broker integration programs?
- Can Wealthsimple portfolio data be displayed *inside* TradingView charts via custom data feeds?
- Any projects that successfully combine LLM analysis with TradingView alerts?
