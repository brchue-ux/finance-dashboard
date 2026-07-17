---
label: wayfinder:grilling
status: closed
assignee:
parent: map
blocks: [010]
blocked-by: [001]
---

# How should the app sync and fetch Wealthsimple data?

## Decision: SnapTrade API, daily append-snapshot sync, full cache, last-known-good error handling

## Decisions

1. **Access method:** SnapTrade API.
   - Free developer tier covers single-user at $0 (up to 5 connections)
   - Pay-as-you-go at scale: $1.50/connected user/month + $0.05/manual sync; custom plan (flat rate, no per-sync cost) at meaningful user volume
   - OAuth per-user, ToS-compliant, multi-user ready by design
   - Self-serve developer access — no sales call required
   - Wealthica ruled out: opaque pricing requires contacting sales, unsuitable for self-serve personal project
   - Direct GraphQL ruled out: passkey migration risk (auth could silently break in 12–18 months), ToS exposure, Python sidecar complexity in Node.js stack

2. **Sync frequency:**
   - Daily background sync at 2am — matches bank data sync cadence, ensures history is never gapped regardless of app usage
   - Pull-to-refresh: always triggers a live SnapTrade sync on demand — user is never locked to the 2am snapshot
   - 15-min staleness check on open: if last sync < 15 min ago, serve cached data instantly; if older, sync in background while showing last-known data
   - 2-min hard debounce: ignore sync requests if last sync < 2 min ago (prevents runaway SnapTrade sync costs)
   - Each sync — whether scheduled or on-demand — appends a timestamped snapshot to the DB

3. **Data storage:** Full cache in Turso. All SnapTrade data (holdings, balances, transactions, performance history) written to DB on every sync and kept permanently. UI always reads from Turso, never calls SnapTrade directly at render time. Every sync appends a timestamped portfolio snapshot — not an overwrite — building a full time-series for LLM trend analysis.
   - LLM advisory uses both: latest snapshot (current state) + windowed historical snapshots (trend context)
   - Live market quotes during trading hours are NOT SnapTrade's responsibility — TradingView/market data provider handles that (ticket 006/010)
   - More frequent pull-to-refresh = more data points = finer-grained trend resolution

4. **LLM and data freshness:** LLM never triggers a sync automatically. On every advisory request, the LLM checks the last-sync timestamp and surfaces it to the user if data is older than the staleness threshold — "last synced X ago, refresh for current values?" — user decides. LLM cost and sync cost remain fully independent and user-controlled.

5. **Error handling:** On SnapTrade unreachable or sync failure — show last-known-good data with "last synced X ago" timestamp. On Wealthsimple connection token invalidated (user changed password, Wealthsimple revoked access, etc.) — surface a soft in-app banner: "Wealthsimple connection needs attention — tap to reconnect." User re-runs SnapTrade OAuth flow (~60 seconds). Standard consumer fintech UX pattern — not a dev bug, a user-action-triggered event.

6. **Credential storage:** SnapTrade API key + client secret stored in Railway environment variables (never in DB). Per-user SnapTrade connection token stored AES-256 encrypted in Turso — same pattern as all third-party tokens (locked in ticket 009). No change to existing auth architecture.

7. **Multi-user readiness:** SnapTrade is OAuth per-user by design. Each user's connection token is a separate encrypted row in Turso. Adding a user = running the OAuth flow once + a new DB row. No architectural change required at any scale.

8. **Cost control at scale:**
   - Solo/dev: SnapTrade free tier ($0), 2-min debounce only
   - Early multi-user: pay-as-you-go, debounce + optional per-user-tier refresh limits (config change, not architectural)
   - Scale: negotiate custom SnapTrade plan (per-sync cost disappears, flat per-user rate)
