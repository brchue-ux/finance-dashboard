---
label: wayfinder:grilling
status: closed
assignee:
parent: map
blocks: []
blocked-by: [007]
---

# What auth system and deployment configuration should the app use?

## Decision: Better Auth, encrypted token storage, auto-deploy with staged rollout path, smart sync strategy

## Decisions

1. **Sign-up flow:** No public sign-up UI at launch. User account seeded directly into the database at deploy time. `PUBLIC_SIGNUP_ENABLED` environment variable controls whether sign-up is open — flip to `true` when publishing to the store. No code change required.

2. **Credential storage:**
   - All third-party tokens (bank aggregator, Wealthsimple, Google OAuth) stored AES-256 encrypted in Turso, encrypted before write, decrypted at runtime
   - Encryption key stored as Railway environment variable (Railway encrypts env vars at rest)
   - HTTPS enforced everywhere — Railway and Vercel both provide this automatically, covering in-transit interception
   - Architecture is identical whether 1 user or 1 million — no security upgrade needed at scale, just more rows

3. **CI/CD pipeline:**
   - Now: auto-deploy on push to `main` — Railway (backend) and Vercel (frontend) redeploy automatically
   - Later (when real users exist): staging environment + manual production approval gate added via Railway/Vercel config — no rebuild required
   - Working pattern: feature branches → `dev` → test → merge to `main` to ship

4. **Custom domain:** Deferred to build time. Will be configured via DNS CNAME record pointing to Railway (backend) and Vercel (frontend). No architectural impact — API base URL is an environment variable.

5. **Sync strategy:**
   - On app open: check staleness — if last sync < 15 minutes ago, serve cached data instantly; if older, sync in background while showing last-known data
   - Pull-to-refresh: always triggers a sync regardless of staleness (explicit user request)
   - Hard debounce: if last sync < 2 minutes ago, ignore request entirely (prevents runaway API costs)
   - Background sync: daily at 2am — ensures data is fresh even on days the app isn't opened
   - Panel-specific refresh: transaction/budget panels refresh on sync; static panels (budget targets, category config) only update on explicit edit
   - Staleness threshold is a single config value — tunable upward (30-60 min) at scale to reduce aggregator API call volume
   - LLM (Anthropic) never runs on sync — only fires on explicit user request for analysis; refresh does not affect LLM costs
