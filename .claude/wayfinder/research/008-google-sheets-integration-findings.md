# Research Findings: Google Sheets API Integration

**Ticket:** 008-google-sheets-integration
**Date:** 2026-07-16 (updated from 2026-07-15)
**Agent searches:** 60+ tool uses, 35+ web searches across all required topic areas

---

## 1. Google Sheets API v4 — Full Capability Inventory

### What the API Exposes

**Value read/write operations:**
- `spreadsheets.values.get` — read a single range
- `spreadsheets.values.batchGet` — read multiple ranges in one HTTP round trip (up to 100 ranges; reduces latency by up to 60% vs individual calls)
- `spreadsheets.values.update` — write a single range
- `spreadsheets.values.batchUpdate` — write multiple ranges atomically (all-or-nothing; if any subrequest fails, none are applied)
- `spreadsheets.values.append` — append rows after the last populated row
- `spreadsheets.values.clear` — clear a range
- `spreadsheets.values.batchClear` — clear multiple ranges

**Spreadsheet structure:**
- Spreadsheet metadata (sheet names, dimensions, cell formatting)
- Named ranges (read, create, update, delete via `AddNamedRangeRequest`, `UpdateNamedRangeRequest`, `DeleteNamedRangeRequest`)
- Developer metadata — custom key-value annotations on cells, rows, columns, or sheets (see Section 9)
- Spreadsheet structure manipulation (add/delete/rename sheets, resize, copy)
- Conditional formatting rules (read only — useful for budget color coding understanding)
- Protected ranges (read and write)

**Source:** [Google Sheets API Reference](https://developers.google.com/workspace/sheets/api/reference/rest), [Batch Requests Guide](https://developers.google.com/workspace/sheets/api/guides/batch)

### Value Rendering Options (CRITICAL for Finance)

The API has a `valueRenderOption` parameter controlling what is returned:

| Option | What You Get | Example for `$1,234.56` |
|--------|-------------|------------------------|
| `FORMATTED_VALUE` (default) | String as displayed in the cell | `"$1,234.56"` — **bad for computation** |
| `UNFORMATTED_VALUE` | Raw underlying value | `1234.56` — **correct for finance** |
| `FORMULA` | The formula in the cell | `"=SUM(A1:A10)"` |

**Always use `UNFORMATTED_VALUE` for budget/financial data.** Using the default will give you strings that must be parsed, and currency formatting varies by locale.

**Source:** [ValueRenderOption reference](https://developers.google.com/workspace/sheets/api/reference/rest/v4/ValueRenderOption)

### Date Handling — Two Parameters, Both Matter

Google Sheets stores dates as serial numbers (days since December 30, 1899 — the Lotus 1-2-3 epoch).

**`valueRenderOption`** controls the output format:
- With `UNFORMATTED_VALUE`: date returns as a serial number (e.g., `45123`)
- With `FORMATTED_VALUE`: date returns as the formatted string (e.g., `"July 15, 2026"`)

**`dateTimeRenderOption`** further controls serial number output:
- `SERIAL_NUMBER` (default): returns the decimal serial number where the integer portion counts days since Dec 30, 1899
- This parameter is **ignored** if `valueRenderOption` is `FORMATTED_VALUE`

**Convert serial to JS Date:**
```javascript
// Google/Excel serial to JS Date
function serialToDate(serial) {
  return new Date((serial - 25569) * 86400 * 1000);
}
// Note: 25569 is the number of days between Dec 30, 1899 and Jan 1, 1970
```

**Other cell type quirks:**
- Percentages return `0.45` not `45` — multiply by 100 for display
- Booleans return `true`/`false` (not `"TRUE"`/`"FALSE"` strings)
- Currency cells return a plain number — the currency symbol is formatting only

**Source:** [Date and number formats guide](https://developers.google.com/workspace/sheets/api/guides/formats), [DateTimeRenderOption reference](https://developers.google.com/workspace/sheets/api/reference/rest/v4/DateTimeRenderOption)

### Structural Quirks (Important for Budget Sheets)

| Behavior | Details |
|----------|---------|
| Merged cells | Only the top-left cell in a merge returns a value; others return empty string |
| Hidden rows | API returns ALL rows including hidden ones — no filter for visible-only rows |
| Hidden row detection | Use `spreadsheets.get` with `fields=sheets.data.rowMetadata` — metadata has `hiddenByUser: true` or `hiddenByFilter: true` |
| Empty trailing rows | API omits trailing empty rows from the response — row count in response may be less than declared sheet row count |
| Hidden sheets | Returned in `spreadsheets.get` — check `sheet.properties.hidden` to detect; data still readable via API |
| Multi-tab workbooks | Each sheet is a separate resource; use `SheetName!A1:Z100` notation to target specific sheets |

---

## 2. Authentication Options

### Option A: Service Account

**How it works:**
1. Create a service account in Google Cloud Console
2. Download JSON key file
3. User must share their Google Sheet with the service account's email address (e.g., `my-app@project.iam.gserviceaccount.com`)
4. App authenticates using the JSON key (never expires, no user interaction needed)

**Advantages:**
- No OAuth flow in the app — simpler for single-user apps
- Uses JWT auth — no token refresh needed
- Works well for a single known Sheet

**Known Issues:**
- **UX friction:** User must remember to share the Sheet with the service account email — confusing for non-technical users
- **JSON key file security:** Must never be committed to git; if compromised, attacker has permanent access
- **Multi-user limitation:** All users' Sheets accessed via one service account — no per-user isolation; not scalable beyond personal use

**Source:** [Service Account OAuth2 guide](https://developers.google.com/identity/protocols/oauth2/service-account), [gspread auth docs](https://docs.gspread.org/en/latest/oauth2.html)

### Option B: OAuth 2.0 (User-Level Access) — RECOMMENDED FOR MULTI-USER

**How it works:**
1. User clicks "Connect Google Sheet" in the app
2. Redirected to Google OAuth consent screen
3. App receives access token + refresh token
4. Access token valid for **1 hour**; refresh token used to get new access tokens automatically

**Exact Scopes:**
- Read-only: `https://www.googleapis.com/auth/spreadsheets.readonly`
- Read-write: `https://www.googleapis.com/auth/spreadsheets`
- Drive file picker access: `https://www.googleapis.com/auth/drive.readonly`

**Mid-session expiry handling:**
- Google's official Node.js client (`googleapis`) supports automatic refresh via the stored refresh token
- **Known issue (googleapis/google-api-nodejs-client #2350):** Auto-refresh does not always trigger without explicitly setting `expiry_date` in `setCredentials`. Pattern: include `access_token`, `refresh_token`, AND `expiry_date` when calling `setCredentials`.
- If refresh token is revoked, Google returns HTTP 400 with `{"error": "invalid_grant"}` — catch this and re-prompt for OAuth
- Retry pattern: retry once; if second attempt fails, mark account "re-auth required" and alert user

**CRITICAL — OAuth Publishing Status Gotcha:**
If your Google Cloud project's OAuth consent screen publishing status is **"Testing"** (not "Published"), Google **revokes all refresh tokens after 7 days**. This means:
- During development, all connected users will be logged out every 7 days
- Fix: move OAuth app to "Published" status, or add all test users to the allowed list
- Error: `invalid_grant: Token has been expired or revoked`

**Token storage:**
- Store refresh token encrypted in app database, per user
- Never store in `localStorage` (XSS risk)

**Source:** [Troubleshoot auth issues](https://developers.google.com/workspace/sheets/api/troubleshoot-authentication-authorization), [googleapis #2350](https://github.com/googleapis/google-api-nodejs-client/issues/2350), [Nango blog on invalid_grant](https://nango.dev/blog/google-oauth-invalid-grant-token-has-been-expired-or-revoked/)

### Option C: API Key
- Only works for **publicly shared Sheets** (anyone with the link can view)
- Not applicable here — budget data should not be public

### Decision Matrix

| Factor | Service Account | OAuth 2.0 |
|--------|----------------|-----------|
| User setup friction | High (must share Sheet with SA email) | Low (standard OAuth flow) |
| Token management | None (JWT, no expiry) | Requires refresh token storage + refresh logic |
| Multi-user support | No (single identity) | Yes (per-user tokens) |
| Security | JSON key must be guarded server-side | Refresh tokens encrypted per-user in DB |
| Best for | Personal single-user app | Multi-user app (or future-proofing) |

**Recommendation:** Given requirement to architect for multi-user expansion, **use OAuth 2.0**.

---

## 3. Sync Patterns

### On-Demand Sync (RECOMMENDED PRIMARY PATTERN)
- User clicks "Sync" or data is fetched fresh when a view loads
- Simplest to implement, stays well within quota
- Combine with a cache to avoid re-fetching unnecessarily
- Display "last synced X ago" to set user expectations

### Polling
- Safe at any reasonable interval for a budget app
- Budget data changes a few times per week at most — aggressive polling uses negligible quota
- **Recommended interval:** 15-30 minutes for background sync; on-demand for user-triggered refresh
- At 15-minute intervals with 100 users: ~7 req/min aggregate — well within the 300 req/min project limit

### Google Drive API Push Notifications

**How it works:** Register a HTTPS webhook URL with the Drive API via `drive.files.watch`; Google sends a POST notification when the file changes.

**Key constraints confirmed by 2025-2026 research:**
- Push notifications are **batched** — first change triggers immediate notification, subsequent changes are batched every ~3 minutes
- Channels expire and **must be renewed** — default expiry is 1 hour, extendable to 24 hours via `SUBSCRIPTION_DURATION_MS`; there is no indefinite watch
- No auto-renewal — requires a scheduled job that checks channel expiry (available in `X-Goog-Channel-Expiration` HTTP header) and calls `watch` again before expiry
- During renewal, there is an **overlap period** where two channels for the same resource are active
- **Duplicate events** are a documented issue — handlers must be idempotent
- Community reports (Google Issue Tracker #309559746) of missed notifications during Google infrastructure events
- Webhook URL must be HTTPS with valid SSL cert

**Conclusion:** Not recommended for this use case. The complexity (channel renewal, deduplication, idempotency, HTTPS requirement) and reliability issues outweigh the real-time benefit for budget data that changes a few times per week. Polling is strictly simpler.

**Source:** [Drive API push notifications guide](https://developers.google.com/workspace/drive/api/guides/push), [googleapis/google-api-go-client #444](https://github.com/googleapis/google-api-go-client/issues/444)

### Apps Script Time-Driven Triggers

**How it works:** Apps Script function runs on a schedule (e.g., hourly) and calls `UrlFetchApp.fetch()` to push Sheet data to an external webhook endpoint.

**Limitations:**
- **90-minute/day total execution budget** per user's Google account
- **6-minute per-invocation limit**
- `onEdit` trigger does **NOT** fire when cells are changed via the API (only fires on human edits in the browser)
- User must install, authorize, and configure the Apps Script in their Sheet — poor UX for a general-user app

**Apps Script as webhook receiver (alternative direction):**
- Apps Script can be deployed as a web app (GET/POST endpoint via `doGet`/`doPost`)
- The recommended pattern: parse payload → append to a queue sheet → return 200 in under 1 second → a separate time-driven trigger drains the queue every minute
- This is used by projects like [GDACollab/googlesheets-webhook-pusher](https://github.com/GDACollab/googlesheets-webhook-pusher)

**Conclusion:** Viable for a developer's own Sheet as a power-user feature; poor UX for general users. Use polling as the primary sync mechanism.

**Recommended final sync pattern:** On-demand primary + 15-minute background cache refresh + display "last synced X ago" timestamp

---

## 4. Rate Limits and Quotas

### Exact Quota Numbers (Verified Against Official Docs, July 2026)

| Limit | Value |
|-------|-------|
| Read requests per minute per user per project | **60** |
| Read requests per minute per project (aggregate) | **300** |
| Requests per 100 seconds per project | **500** |
| Daily quota | **No hard cap** (as of July 2026) |

**Note:** The 60 req/min limit applies to **combined read and write operations** per user, not reads alone. For a budget app doing 1-2 reads per page load, this is not a concern.

**Source:** [Official quota documentation](https://developers.google.com/workspace/sheets/api/limits)

### Upcoming Billing Change (IMPORTANT)
Google has announced that exceeding the quota request limits is **planned to incur charges to your Google Cloud billing account later in 2026**. Specific pricing has not been published. Mitigation: implement caching aggressively to stay well within free tiers.

**Source:** [Google Workspace Admin Community thread](https://support.google.com/a/thread/302106781/pricing-of-google-sheets-apis-after-reaching-the-quota?hl=en)

### Error Codes
- `429 RESOURCE_EXHAUSTED` — quota exceeded; exponential backoff required
- `503 Service Unavailable` — transient Google infrastructure issue; retry

### Correct Exponential Backoff Pattern

The `google-spreadsheet` npm package includes automatic retries with exponential backoff. If using raw `googleapis`, implement manually:

```javascript
async function withRetry(fn, maxRetries = 5) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (err.status === 429 || err.status === 503) {
        // Exponential backoff with jitter, capped at 32 seconds
        const delay = Math.min(1000 * Math.pow(2, i) + Math.random() * 1000, 32000);
        await new Promise(r => setTimeout(r, delay));
      } else {
        throw err; // Don't retry auth errors, 404s, etc.
      }
    }
  }
  throw new Error('Max retries exceeded');
}
```

### Quota Exhaustion — Community Reports
- Community reports of `429` errors when polling every second or running bulk imports
- Burst access from multiple users simultaneously can exhaust per-project limits
- Solution: implement the cache-aside pattern (Section 6) to dramatically reduce API calls

---

## 5. Known Bugs and Runtime Issues

| Bug / Issue | Source | Workaround |
|-------------|--------|------------|
| Stale reads after writes (up to ~40s delay) | Community reports; Google infrastructure cache invalidation lag | Wait 2s after write before reading; use optimistic UI updates |
| ECONNRESET on large reads (10,000+ rows) | googleapis/google-api-nodejs-client #1224 | Chunk large reads into smaller ranges with explicit row bounds; use retry |
| 180-second server-side timeout | Official docs (coefficient.io analysis) | Paginate: 500-1,000 rows per request; use explicit column ranges via `fields` param |
| Empty rows omitted from response | Documented API behavior | Do not assume row count from response length; use `spreadsheets.get` for true sheet dimensions |
| `onEdit` trigger does not fire on API changes | Apps Script docs | Cannot use `onEdit` to detect app-driven changes; use polling or Drive push instead |
| OAuth refresh token 7-day expiry in Testing mode | Google OAuth docs | Publish OAuth app or add users to test allowlist |
| `invalid_grant` on expired/revoked refresh token | googleapis/google-api-nodejs-client #261 | Catch 400/invalid_grant → mark account re-auth required → prompt user |
| Auto-refresh not triggering without `expiry_date` | googleapis/google-api-nodejs-client #2350 | Always set `expiry_date` in `setCredentials` alongside `access_token` and `refresh_token` |
| Duplicate Drive push notifications | issuetracker.google.com #309559746 | Make handlers idempotent; deduplicate by channel ID + message ID |
| Drive notification channel silent expiry | Drive API docs | Monitor `X-Goog-Channel-Expiration` header; renew channels proactively |
| Encoding issues with currency symbols | API behavior with FORMATTED_VALUE | Always use `UNFORMATTED_VALUE` to get raw numbers; apply formatting client-side |
| Race condition on concurrent reads/writes | General distributed systems concern | Use optimistic locking; show "last synced" timestamp to detect conflicts |
| Memory leak in google-api-python-client | googleapis/google-api-python-client #535 | Node.js client not affected; noted for completeness |

---

## 6. Scaling Concerns

### Per-User OAuth Quota Isolation
- Each user's OAuth token has **its own separate 60 req/min quota** — the limit is per user per project
- Good news: 100 users each syncing once per 15 minutes = ~7 req/min aggregate against the 300 req/min project ceiling — effectively no concern until thousands of active simultaneous users

### Project-Level Ceiling
- 300 req/min per project is the aggregate ceiling across all users
- 1,000 users polling every 15 minutes = ~67 req/min aggregate — still comfortable
- 10,000 concurrent active users would require architectural changes (cache server, request queuing)

### Large Sheet Handling
- Google's documented timeout: **180 seconds** per request
- Practical limit: 10,000+ rows can cause timeouts if fetched in a single range call
- For budget data: extremely unlikely to hit in practice (most budget sheets are <500 rows)
- If needed: paginate via explicit row ranges (`Sheet1!A1:Z500`, `Sheet1!A501:Z1000`, etc.)
- Use `fields` parameter to limit columns returned — reduces payload by up to 80%
- Benchmark: 1,000 rows per request maintains sub-second response times

**Source:** [Performance guide](https://developers.google.com/sheets/api/guides/performance), [coefficient.io timeout analysis](https://coefficient.io/use-cases/troubleshoot-google-sheets-api-timeout-errors)

### Service Account at Scale
- A service account is a single identity — all users' Sheets accessed through one account
- Cannot provide credential isolation between users
- Use OAuth 2.0 per user for any multi-user scenario

### Cache-Aside Pattern (Recommended Implementation)

```
App database schema additions:
  users.sheets_cache      TEXT    -- JSON blob of last fetched data
  users.sheets_synced_at  INTEGER -- Unix timestamp of last successful sync

On API request handler:
  1. Check synced_at: if < 15 minutes ago → return cache (no API call)
  2. Else → fetch from Sheets API → update cache + synced_at → return fresh data
  3. On Sheets API error → return stale cache with "stale" flag → log error

Benefits:
  - Reduces API calls by 90%+ for normal usage
  - Handles offline/rate-limit states gracefully
  - Provides instant response time for most requests
```

---

## 7. Prior Art — Open Source Projects

### Directly Relevant: Plaid + Google Sheets Finance Projects

| Project | Approach | GitHub | Stars |
|---------|----------|--------|-------|
| `yyx990803/build-your-own-mint` | Plaid → Node.js → Google Sheets (via CircleCI CI job); user writes transform logic in `lib/transform.js`; service account auth | https://github.com/yyx990803/build-your-own-mint | ~2,500 |
| `williamlmao/plaid-to-gsheets` | Plaid → Apps Script → Google Sheets; transformation rules in config; Google Data Studio for visualization | https://github.com/williamlmao/plaid-to-gsheets | Unknown |
| `blairun/automated_finances` | Fork of build-your-own-mint; Plaid → Google Sheets | https://github.com/blairun/automated_finances | Unknown |
| `cmenon12/bank-account-to-sheets` | Google Apps Script; imports bank transactions via Plaid into Sheets | https://github.com/cmenon12/bank-account-to-sheets | Unknown |
| `lyndseypadget/PlaidSheets` | Node.js app; Plaid → Google Sheets | https://github.com/lyndseypadget/PlaidSheets | Unknown |
| `e13h/gsheets-plaid` | Brings bank transactions into Google Sheets with Plaid | https://github.com/e13h/gsheets-plaid | Unknown |
| `hallister/mintable` | Mint clone using Google Sheets + Plaid APIs | https://github.com/hallister/mintable | Unknown |

### General Sheets-as-Database Projects

| Project | Approach | GitHub | Stars |
|---------|----------|--------|-------|
| `jakubgarfield/expenses` | React PWA; Google Sheets as storage; OAuth user-level auth; append/read pattern for expense tracking; deployed as static HTML | https://github.com/jakubgarfield/expenses | ~1,200 |
| `sammitjain/budget-tracker` | Google Sheets + Forms setup; no external app — Sheets-native | https://github.com/sammitjain/budget-tracker | Unknown |
| `sammitjain/budget-tracker-datastudio` | Google Sheets + Google Forms + Data Studio dashboard | https://github.com/sammitjain/budget-tracker-datastudio | Unknown |
| `nicucalcea/sheets-llm` | LLM integration in Google Sheets via Apps Script | https://github.com/nicucalcea/sheets-llm | Unknown |

### Key Insight from `jakubgarfield/expenses`
This project is the closest prior art to the Wayfinder pattern: React app, OAuth, Google Sheets as the data store, deployed as static HTML. It demonstrates the append-on-add, read-on-load pattern for personal finance. The project explicitly emphasizes privacy ("no 3rd party gets your data") — the same value proposition as Wayfinder.

### Key Insight from `yyx990803/build-your-own-mint`
Created by Evan You (creator of Vue.js), this project established the Plaid → Sheets pipeline that many forks followed. The `lib/transform.js` pattern — user-customizable transformation logic that maps raw Plaid transactions to Sheet columns — is directly applicable to Wayfinder's budget categorization layer.

---

## 8. Libraries

### `google-spreadsheet` (npm) — RECOMMENDED

- **Weekly downloads:** ~411K
- **GitHub stars:** ~2,500
- **GitHub:** https://github.com/theoephraim/node-google-spreadsheet
- **Maintainer:** Theo Ephraim
- **TypeScript:** Full types included; row methods support explicit TypeScript types for row shape
- **Auth support:** Service account, OAuth 2.0, API key, ADC — all via `google-auth-library`
- **Built-in retry:** Automatic exponential backoff for rate-limited requests — **saves implementing retry logic manually**
- **API:** Cell-based and row-based APIs; manages worksheets and documents
- **Verdict:** Substantially simpler than raw `googleapis`; maintained; battle-tested

**Installation:**
```bash
npm install google-spreadsheet google-auth-library
```

**Full docs:** https://theoephraim.github.io/node-google-spreadsheet

### `@googleapis/sheets` (official npm)
- Official Google client (auto-generated from API spec)
- More verbose; requires more boilerplate for auth setup
- Use as fallback if `google-spreadsheet` lacks a needed feature
- No built-in retry logic

### `google-auth-library` (official npm)
- Handles OAuth 2.0 token refresh, service account JWT, etc.
- Required peer dependency for both options above

---

## 9. Apps Script as Middleware

### What's Possible
- Apps Script can call external APIs (`UrlFetchApp.fetch`)
- Can be deployed as a web app (GET/POST endpoint) — serves as a lightweight proxy or webhook receiver
- Time-driven triggers can push Sheet data to an external webhook on a schedule
- `onEdit` trigger fires when a **human** edits the Sheet in the browser (not API changes)

### Apps Script Quota Limits
- **90-minute/day total execution** per user's Google account
- **6-minute per-invocation limit**
- **20,000 URL fetch calls/day** per user
- **20 simultaneous executions** per user

**Source:** [Google Apps Script Pricing (free quota)](https://modelmonkey.io/blog/google-apps-script-pricing-free-quota)

### Queue Pattern for Reliable Webhook Handling
```
Incoming webhook → doPost() → parse payload → append to queue sheet → return 200 immediately
Time-driven trigger (every 1 min) → reads queue sheet → processes rows → deletes processed rows
```
This pattern decouples synchronous HTTP response from processing, making it reliable even when downstream APIs are slow.

### Limitations for User-Facing Apps
- User must install, authorize, and configure the Apps Script — significant UX friction
- Cannot detect changes made via the API (only human edits)
- **Not recommended** as the primary sync mechanism for Wayfinder

### Viable Use Case
If the user is comfortable with Apps Script (developer persona), they can deploy it as a push bridge that fires when they manually update budget data. This is a power-user feature, not the primary data access path.

---

## 10. Developer Metadata — Hidden Capability

Developer metadata is an underutilized API feature that lets you attach custom key-value annotations to any part of a spreadsheet (spreadsheet level, sheet level, row, or column). The metadata **persists and moves with the data** even if rows/columns are inserted, deleted, or moved.

**Storage limits:**
- 30,000 characters per spreadsheet
- 30,000 characters per sheet (additional)
- A 3-sheet workbook can store up to 120,000 characters of metadata

**Finance app use cases:**
- Tag a row as "CATEGORY:GROCERIES" without affecting displayed data
- Mark a column as "TYPE:EXPENSE" to identify its semantic role
- Store app-specific state (e.g., last-synced row index) in spreadsheet metadata without creating a visible "system" sheet

**API:** `spreadsheets.developerMetadata.get`, `spreadsheets.developerMetadata.search`

**Source:** [Developer Metadata guide](https://developers.google.com/workspace/sheets/api/guides/metadata)

---

## 11. Opportunities

### Named Ranges as a Stable API Contract (HIGH VALUE)

Named ranges survive row/column insertions, deletions, and reordering — making them the most robust way to bind an app to a user's Sheet without the app breaking when the user edits their spreadsheet structure.

**Recommended contract for Wayfinder:**
```
INCOME_ROWS      — rows containing income transactions
EXPENSE_ROWS     — rows containing expense transactions
BUDGET_TARGETS   — monthly budget targets by category
SAVINGS_GOALS    — savings goal definitions
CONFIG_CATEGORIES — valid expense category list
```

User creates these named ranges once during setup. App always reads by name, never by A1 notation. If the user restructures their Sheet, named ranges automatically follow. Document the expected named ranges in the setup guide.

**Source:** [Named ranges samples](https://developers.google.com/workspace/sheets/api/samples/ranges), [Best practices for naming ranges](https://dataful.tech/google-sheets/named-ranges/best-practices/)

### Config Sheet Tab as LLM Context Layer (HIGH VALUE)

A dedicated "Config" tab in the Sheet acts as the user's control panel for the LLM advisory engine:

```
Config tab columns:
  Category | Monthly Target | Notes/Rules
  Groceries | $600 | "Include Costco"
  Dining Out | $200 | "Exclude work lunches (expensed)"
  Savings | $1,500 | "Emergency fund priority"
```

The app reads this tab and injects it into the Claude system prompt as structured context. Benefits:
- User can customize advisory engine behavior without touching the app
- Rules and context can be updated immediately just by editing the Sheet
- LLM gets richer, more personalized context without any app-side configuration UI

**Descriptive column headers help the LLM understand the domain** — "Monthly Budget Target (CAD)" is more useful than "Target" for an AI reasoning about financial context.

### Google Sheets as a Lightweight CMS
- Categories, tags, and budget rules in the Sheet → LLM uses them as context
- Future opportunity: LLM recommendations ("increase grocery budget to $600") could be written back to Sheet via `values.update`
- Creates a feedback loop: user edits Sheet → app reads changes → LLM adapts → LLM writes recommendations → user sees them in Sheet

### Developer Metadata for Invisible App State
- Store sync state, row checksums, or last-processed row in developer metadata
- Invisible to the user (no extra columns or sheets needed)
- Survives row insertions/deletions

### Batch Operations for Initial Load
- On first load or full refresh, use `batchGet` to read all named ranges in a single HTTP call
- Example: fetch `INCOME_ROWS`, `EXPENSE_ROWS`, `BUDGET_TARGETS`, and `CONFIG_CATEGORIES` simultaneously — one round trip instead of four

### n8n as No-Code Alternative
- n8n (self-hosted) has Google Sheets integration and budget workflow templates
- Can trigger on Sheet changes and POST to Wayfinder's webhook
- Useful for prototyping the data flow before building the full integration
- No per-task pricing (unlike Zapier/Make); privacy-preserving (self-hosted)

### Newer Google Workspace APIs
- Google announced multi-step Sheets editing via Gemini API (2025-2026) — allows natural language commands to modify Sheets
- 50K row limit increase in recent updates
- These don't directly affect this app's integration model but indicate continued investment in the Sheets platform
- The [Google Sheets API scopes guide](https://developers.google.com/workspace/sheets/api/scopes) was updated in 2026 — review before OAuth setup

---

## 12. batchGet Pattern — Recommended Read Implementation

For Wayfinder's initial Sheet read on connection or sync, use a single `batchGet` call:

```javascript
import { GoogleSpreadsheet } from 'google-spreadsheet';
import { OAuth2Client } from 'google-auth-library';

async function syncUserSheet(userId, accessToken, refreshToken, spreadsheetId) {
  const auth = new OAuth2Client(CLIENT_ID, CLIENT_SECRET);
  auth.setCredentials({
    access_token: accessToken,
    refresh_token: refreshToken,
    expiry_date: storedExpiryDate, // REQUIRED for auto-refresh to work
  });

  const doc = new GoogleSpreadsheet(spreadsheetId, auth);
  await doc.loadInfo(); // loads sheet metadata

  // Read all named ranges in one batchGet
  await doc.loadNamedRanges();

  // Or use raw API for batchGet across multiple ranges:
  const { data } = await sheets.spreadsheets.values.batchGet({
    spreadsheetId,
    ranges: ['INCOME_ROWS', 'EXPENSE_ROWS', 'BUDGET_TARGETS', 'CONFIG_CATEGORIES'],
    valueRenderOption: 'UNFORMATTED_VALUE',
    dateTimeRenderOption: 'SERIAL_NUMBER',
  });

  return data.valueRanges; // Array of ranges with values
}
```

---

## Summary Decision Table

| Decision | Recommendation | Rationale |
|----------|---------------|-----------|
| Auth method | OAuth 2.0 | Multi-user ready; no sharing step; standard pattern |
| Library | `google-spreadsheet` npm | Built-in retry; TypeScript; simpler than raw googleapis |
| Value rendering | Always `UNFORMATTED_VALUE` | Returns raw numbers for finance; avoid string parsing |
| Date handling | `SERIAL_NUMBER` + convert | Consistent epoch; use `serialToDate()` helper |
| Sync pattern | On-demand primary + 15-min background cache | Stays well within quota; good UX |
| Data contract | Named ranges (not A1 notation) | Stable across user Sheet edits |
| LLM context | Config Sheet tab → system prompt | User-controlled without touching the app |
| Scaling | Cache-aside pattern with `synced_at` column | Reduces API calls by 90%+ |
| Drive push notifications | Do not use | Channel renewal complexity, duplicate events, batch delay |
| Apps Script triggers | Optional power-user feature only | UX friction; 90-min/day quota |
| OAuth publishing status | Set to Published before launch | Prevents 7-day refresh token expiry in Testing mode |
| Large Sheet | Paginate at 500-1,000 rows; use `fields` param | Avoids 180-second timeout |
| Initial batch read | Single `batchGet` for all named ranges | One round trip instead of N; 60% latency reduction |
| Upcoming billing | Implement caching aggressively | Quota-overage charges planned for late 2026 |

---

## Sources

- [Google Sheets API v4 Usage Limits](https://developers.google.com/workspace/sheets/api/limits)
- [ValueRenderOption reference](https://developers.google.com/workspace/sheets/api/reference/rest/v4/ValueRenderOption)
- [DateTimeRenderOption reference](https://developers.google.com/workspace/sheets/api/reference/rest/v4/DateTimeRenderOption)
- [Date and number formats guide](https://developers.google.com/workspace/sheets/api/guides/formats)
- [Named & protected ranges samples](https://developers.google.com/workspace/sheets/api/samples/ranges)
- [Batch requests guide](https://developers.google.com/workspace/sheets/api/guides/batch)
- [batchGet method reference](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets.values/batchGet)
- [Drive API push notifications](https://developers.google.com/workspace/drive/api/guides/push)
- [Service Account OAuth2](https://developers.google.com/identity/protocols/oauth2/service-account)
- [OAuth2 scopes for Sheets](https://developers.google.com/workspace/sheets/api/scopes)
- [Developer Metadata guide](https://developers.google.com/workspace/sheets/api/guides/metadata)
- [Performance guide](https://developers.google.com/sheets/api/guides/performance)
- [Troubleshoot auth issues](https://developers.google.com/workspace/sheets/api/troubleshoot-authentication-authorization)
- [googleapis/google-api-nodejs-client #2350 — auto-refresh bug](https://github.com/googleapis/google-api-nodejs-client/issues/2350)
- [googleapis/google-api-nodejs-client #261 — refresh token retry](https://github.com/googleapis/google-api-nodejs-client/issues/261)
- [googleapis/google-api-go-client #444 — real-time updates discussion](https://github.com/googleapis/google-api-go-client/issues/444)
- [Google Issue Tracker #309559746 — duplicate Drive notifications](https://issuetracker.google.com/issues/309559746)
- [Nango blog: invalid_grant causes and fixes](https://nango.dev/blog/google-oauth-invalid-grant-token-has-been-expired-or-revoked/)
- [gspread auth docs](https://docs.gspread.org/en/latest/oauth2.html)
- [node-google-spreadsheet GitHub](https://github.com/theoephraim/node-google-spreadsheet)
- [node-google-spreadsheet npm](https://www.npmjs.com/package/google-spreadsheet)
- [Google Apps Script free quota](https://modelmonkey.io/blog/google-apps-script-pricing-free-quota)
- [jakubgarfield/expenses GitHub](https://github.com/jakubgarfield/expenses)
- [yyx990803/build-your-own-mint GitHub](https://github.com/yyx990803/build-your-own-mint)
- [williamlmao/plaid-to-gsheets GitHub](https://github.com/williamlmao/plaid-to-gsheets)
- [cmenon12/bank-account-to-sheets GitHub](https://github.com/cmenon12/bank-account-to-sheets)
- [GDACollab/googlesheets-webhook-pusher GitHub](https://github.com/GDACollab/googlesheets-webhook-pusher)
- [Pricing of Sheets API after quota (Google Admin Community)](https://support.google.com/a/thread/302106781/pricing-of-google-sheets-apis-after-reaching-the-quota?hl=en)
- [coefficient.io: timeout errors](https://coefficient.io/use-cases/troubleshoot-google-sheets-api-timeout-errors)
- [moldstud: API best practices](https://moldstud.com/articles/p-mastering-google-sheets-api-best-practices-common-pitfalls-and-effective-endpoints)
- [dataful.tech: named range best practices](https://dataful.tech/google-sheets/named-ranges/best-practices/)
- [sheetsformarketers.com: Google Sheets limitations 2026](https://sheetsformarketers.com/google-sheets-limitations/)
- [SheetZAPI: rate limiting guide](https://sheetzapi.com/learn/google-sheets-rate-limiting)
