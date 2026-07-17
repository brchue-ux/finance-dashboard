---
label: wayfinder:grilling
status: closed
assignee:
parent: map
blocks: [010]
blocked-by: []
---

# Is the budget tracker read-only or does the app allow in-app budget editing?

## Decision: App owns all budget data. Google Sheet retired after one-time historical import.

## Decisions

1. **Google Sheet is retired.** The app owns all budget data. The Sheet is used only for a one-time historical import at setup, then is no longer part of the workflow.

2. **Transaction auto-import from banks.** RBC Visa, RBC chequing, Tangerine Mastercard, 2 Tangerine accounts. No manual transaction entry. Pay frequency (currently biweekly, possibly changing to weekly) is a flexible config value — not hardcoded. *(See ticket 012 for Canadian bank aggregator research.)*

3. **Historical import required.** Sheet data back to early 2025 must be imported so trends are continuous from day one. Historical data will use the old coarser category structure where subcategory mapping is ambiguous.

4. **Budget period: monthly.** Income pay frequency is config; the budget horizon is always the calendar month.

5. **Budget targets are editable.** Fixed expense targets exist but spending will not always align. Reallocation between buckets is a first-class feature.

6. **Reallocation: manual + LLM-suggested, user approves.** LLM flags imbalances and suggests reallocation across buckets. Nothing is written without explicit user approval.

7. **Category structure: granular subcategories.** Defined at setup/onboarding. Richer than the current Sheet's coarse categories (e.g. "Fast Food" and "Sit-Down Restaurants" as distinct buckets, not one "Restaurants" catch-all).

8. **Auto-categorization: fully automatic, high accuracy required.** Merchant-to-category mapping defined at setup; LLM resolves unknown merchants. No mandatory per-transaction review queue. On-demand correction is available — changing a transaction's category is remembered for all future transactions from that merchant.

## Surfaces

- Budget overview (monthly totals vs. targets by category)
- Transaction list with category labels, filterable by month/category
- Reallocation UI (manual drag/edit + LLM suggestion panel)
- Category management (setup, edit subcategories, merchant mapping)
- On-demand transaction category correction

## Original Question

The budget data lives in a user-provided Google Sheet. The decision is: what is the relationship between the app and that Sheet?

Options considered: Read-only, Read-write, Hybrid. Resolution: App owns everything; Sheet is a one-time historical import only.
