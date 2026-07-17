---
label: wayfinder:prototype
status: closed
assignee:
parent: map
blocks: []
blocked-by: [010]
---

# What do the two main views and their detail tabs look like?

## Question

The app has two main views plus detail tabs. This ticket produces a concrete prototype — wireframe, annotated layout, or stub UI — to react to before the spec is written.

**What needs to be prototyped:**

1. **Budget view (LLM + Wealthsimple + Google Sheets):**
   - How are the three data sources laid out on screen?
   - Where does the LLM advisory output live — sidebar, bottom panel, inline cards, modal?
   - How are income vs outflow trends visualized (chart type, time range controls)?
   - How are past / current / future budget periods navigated?
   - Where do recommendations appear — alongside the data that triggered them, or in a dedicated panel?

2. **Investment view (LLM + TradingView + Wealthsimple):**
   - How are TradingView charts and Wealthsimple portfolio data laid out together?
   - Where do LLM investment recommendations appear?
   - How are TradingView alerts surfaced in the UI (notification badge, alert feed, modal)?
   - Can the user see their Wealthsimple positions overlaid on a TradingView chart?

3. **Navigation:**
   - How do you move between the two main views?
   - What are the detail tabs within each view — what do they show?
   - Is there a top-level nav, sidebar, or tab bar?

4. **Mobile layout:**
   - How do both views collapse on a phone-sized screen?
   - What gets hidden or moved to a secondary tab on mobile?
   - How does the LLM advisory panel adapt (full-screen drawer? scrollable section below charts?)?

5. **LLM interaction:**
   - Is there a chat input to ask follow-up questions, or is it purely advisory output?
   - Can the user request a fresh analysis or ask the LLM to explain a specific recommendation?

The prototype should be reacted to by the user, who will confirm, reject, or reshape the layout before the spec is written.
