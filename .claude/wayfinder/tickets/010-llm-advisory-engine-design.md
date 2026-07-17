---
label: wayfinder:grilling
status: closed
assignee:
parent: map
blocks: [011]
blocked-by: [001, 002, 004, 008]
---

# How does the LLM advisory engine work?

## Decision: Sync-delta trigger, full history context, structured cards, streaming conversation, `tradesdontlie` MCP enabled

## Decisions

1. **Trigger model:**
   - LLM runs on page load only when `last_synced_at` > `last_analyzed_at` — new data since last analysis triggers auto-run; cached analysis served instantly otherwise with "Analyzed X ago" timestamp
   - Pull-to-refresh forces a fresh sync → makes `last_synced_at` newer → triggers fresh analysis on next view load
   - Alert-triggered: user-initiated only — tap an alert in the alert feed to trigger LLM analysis in context of that alert + current portfolio; never auto-run on alert receipt
   - LLM never runs on sync (locked in ticket 009)
   - Both `last_synced_at` and `last_analyzed_at` stored per-user per-view in Turso

2. **Context per view:**
   - Pass all available history for now (single user, data starts from zero — volume manageable)
   - Migration path when history grows: monthly rollup summaries compress older months into category totals, preserving trend signal without token bloat
   - Windowed advice (e.g., "last 3 months") handled at query time — app filters what it sends to Claude based on requested window
   - **Budget view context:** full transaction history by month, spending by category, envelope targets, pay schedule, current month in full detail
   - **Investment view context:** all Wealthsimple holdings (quantities, cost basis, market value, unrealized gain/loss), performance history snapshots, recent transactions (trades, dividends, deposits), account types (TFSA/RRSP/non-reg), TradingView alert payload if analysis was alert-triggered
   - Context is assembled per-user at request time from that user's Turso rows — never shared, never blended across users

3. **System prompt design:**
   - **Role:** Personal financial advisor with full knowledge of user's accounts, history, and goals. Direct and opinionated — no excessive hedging. Treats user as an informed adult.
   - **Canadian tax context:** Always active — TFSA/RRSP contribution room, capital gains treatment in non-registered accounts, implications of selling inside vs outside registered accounts factored into every recommendation.
   - **Investment posture:** User is transitioning from Wealthsimple auto-managed (risk level 5/10, ETF-based) to self-directed investing. Objective: sell ETF holdings and move to individual security selection. Current defensive posture — minimize equity exposure, favor fixed income and defensive assets due to perceived market overvaluation. Intent: shift aggressively back into equities following a significant market correction. Claude advises on when/how to execute this transition, when to shift defensive/aggressive, and proactively flags when market indicators suggest conditions are changing.
   - **Budget philosophy:** Envelope-style. User-set targets are source of truth. North star is increasing total net worth — budget advice is framed around freeing up capital to invest.
   - **Context containerization (hard rule):** System prompt and all context assembled per-user at request time from that user's Turso rows. Claude has no persistent memory between sessions — each session is stateless beyond what the app explicitly injects. No cross-user context leakage at any layer.
   - **User-configurable preferences** injected at session time: risk posture, savings goals, investment time horizon — stored in Turso per user, editable in app settings.

4. **Tool use:**
   - Web search: enabled, ungated — Claude uses it when it determines external context is needed (interest rates, market news, ticker-specific news, macro context); user can also explicitly request searches
   - **`tradesdontlie` MCP server:** enabled — self-hosted alongside Railway backend, $0 cost. Claude can query live TradingView indicator data (RSI, MACD, moving averages, volume analysis) on any ticker as a tool call during advisory sessions. ToS risk accepted at personal-use scale (same class as TradingView unofficial data tools).
   - Tool results rendered inline as part of the advisory response

5. **Output structure:**
   - Structured cards — one card per insight or action
   - **Insights** (observational): scannable, data-driven observations ("restaurant spending up 40% vs last 3 months")
   - **Actions** (recommendations): distinct action cards with explicit "why"; require user approve/dismiss interaction — especially budget reallocation suggestions (consistent with ticket 004)
   - Reasoning: collapsed by default, expandable on demand
   - Cross-view advisory explicitly encouraged: Claude should connect budget and investment views ("cutting $X/month from discretionary adds $Y to annual TFSA contribution")

6. **Streaming vs batch:**
   - **Auto-generated cards** (page-load triggered, data-driven): render fully formed — no streaming animation. Cards exist or they don't.
   - **User-initiated LLM interaction** (follow-up questions, alert analysis, explicit conversational sessions): full word-by-word streaming, conversational experience
   - Vercel AI SDK handles both modes: batch parse + render for cards; `streamText` for conversation

7. **Budget advisory specifics:**
   - Time horizons: current month in full detail (primary focus), prior months as trend context, future month as planning surface (Claude projects from trends against user-set targets)
   - Future budget: user-set envelope targets as source of truth; Claude flags divergence between actuals and targets; suggests reallocation when overspending detected (user approves all changes)
   - North star: increase total net worth — minimize waste, free capital for investment, connect spending decisions to investment outcomes

8. **Investment advisory specifics:**
   - Claude sees full Wealthsimple data: holdings, cost basis, unrealized gains/losses, performance history, recent transactions, account types
   - Account type factored into every recommendation: TFSA sells have no capital gains implications; non-registered account sells do
   - TradingView: alert payloads when analysis is alert-triggered; `tradesdontlie` MCP for live indicator queries on any holding on demand
   - Advice scope: when to sell ETF positions, how to build a defensive self-directed portfolio, when to shift aggressive, individual security context via MCP tool calls
   - Direct recommendations — no reflexive "consult a financial advisor" hedging

9. **Token budget:**
   - Estimated per session: ~5,000–8,000 tokens (system prompt + context + response)
   - Estimated cost: ~$0.02–0.04 per advisory session at current Claude Sonnet pricing
   - Prompt caching enabled (Vercel AI SDK): repeated system prompt + static context billed at ~10% of normal input price
   - Expected monthly cost at normal usage: ~$1–3/month total
   - No hard token limits or daily spend caps needed at this scale
   - Revisit if multi-user deployment changes usage patterns
