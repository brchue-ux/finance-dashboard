import { relations, sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

// ── user / session / account / verification (Better Auth) ─────────────────────
// Generated via `npx @better-auth/cli generate` against lib/auth.ts.
// This is the canonical identity table — app tables reference user.id, not a
// separate `users` table.
export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" })
    .default(false)
    .notNull(),
  image: text("image"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
});

export const session = sqliteTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [index("session_userId_idx").on(t.userId)]
);

export const account = sqliteTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: integer("access_token_expires_at", { mode: "timestamp_ms" }),
    refreshTokenExpiresAt: integer("refresh_token_expires_at", { mode: "timestamp_ms" }),
    scope: text("scope"),
    password: text("password"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (t) => [index("account_userId_idx").on(t.userId)]
);

export const verification = sqliteTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)]
);

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, { fields: [session.userId], references: [user.id] }),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, { fields: [account.userId], references: [user.id] }),
}));

// ── bank_connections ─────────────────────────────────────────────────────────
export const bankConnections = sqliteTable("bank_connections", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id),
  institutionName: text("institution_name").notNull(), // "RBC" | "Tangerine" | "Scotiabank"
  // Plaid's stable institution identity (ins_xxx) — the dedup key for "is this
  // bank already connected". item_id can't serve: relinking mints a new item.
  // Nullable: legacy rows predate it, so name is their fallback identity.
  plaidInstitutionId: text("plaid_institution_id"),
  plaidItemId: text("plaid_item_id").notNull(),
  plaidAccessToken: text("plaid_access_token").notNull(), // AES-256-GCM encrypted
  status: text("status").notNull().default("active"), // "active" | "relink_required" | "error"
  lastSyncedAt: integer("last_synced_at"),
  createdAt: integer("created_at").notNull(),
});

// ── bank_accounts ────────────────────────────────────────────────────────────
export const bankAccounts = sqliteTable("bank_accounts", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id),
  connectionId: text("connection_id").references(() => bankConnections.id), // NULL for type = "manual"
  plaidAccountId: text("plaid_account_id").unique(), // NULL for type = "manual"
  name: text("name").notNull(),
  type: text("type").notNull(), // "chequing" | "savings" | "credit" | "manual"
  mask: text("mask"), // last 4 digits
  institution: text("institution").notNull(),
  // Current balances from Plaid /accounts/get — overwritten each sync; history in bank_balance_snapshots
  balanceAvailable: real("balance_available"),
  balanceCurrent: real("balance_current"),
  balanceLimit: real("balance_limit"), // credit accounts
  isoCurrencyCode: text("iso_currency_code"),
});

// ── transactions ─────────────────────────────────────────────────────────────
export const transactions = sqliteTable("transactions", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id),
  accountId: text("account_id")
    .notNull()
    .references(() => bankAccounts.id),
  plaidTransactionId: text("plaid_transaction_id").unique(), // NULL for imported/manual rows
  date: text("date").notNull(), // ISO 8601 YYYY-MM-DD (posted date)
  authorizedDate: text("authorized_date"), // Plaid authorized_date (vs posted); NULL for imported rows
  description: text("description").notNull(), // raw bank description
  merchantName: text("merchant_name"), // cleaned by categorization engine
  merchantLogoUrl: text("merchant_logo_url"), // Plaid merchant enrichment
  merchantWebsite: text("merchant_website"), // Plaid merchant enrichment
  amount: real("amount").notNull(), // negative = debit, positive = credit
  isoCurrencyCode: text("iso_currency_code"),
  category: text("category"), // envelope name assigned (app's own engine)
  // How `category` got its value. "manual" means the user set it by hand, and a
  // bulk recategorize must not overwrite it — see app/api/budget/recategorize.
  // NULL is read as "rule": every row predates this column, and none of them
  // were hand-set (there was no route to do it before build-reminders 6a).
  categorySource: text("category_source"), // "rule" | "manual" | NULL (= rule)
  // Non-NULL means this row is money moving between the user's OWN accounts,
  // and is excluded from both income and spending — see lib/budget/transfers.ts.
  // The value records what decided that ("rule" | "manual") so a re-run cannot
  // silently undo a correction, same contract as categorySource.
  transferSource: text("transfer_source"),
  // Non-NULL means this row sits OUTSIDE the period where we hold data from
  // every account, so it is stored and categorized but kept out of every total.
  // A month with only Wealthsimple dividends and no bank data is not a budget —
  // it is a fragment that reads as if the household earned $40 and spent
  // nothing. The value records why it was set aside.
  coverage: text("coverage"),
  pfCategoryPrimary: text("pf_category_primary"), // Plaid personal_finance_category.primary — second signal
  pfCategoryDetailed: text("pf_category_detailed"), // Plaid personal_finance_category.detailed
  paymentChannel: text("payment_channel"), // "online" | "in store" | "other"
  location: text("location"), // JSON: Plaid location object (address/city/lat/lon)
  pending: integer("pending").notNull().default(0), // boolean
  createdAt: integer("created_at").notNull(),
});

// ── transaction_splits ────────────────────────────────────────────────────────
// One purchase spanning several envelopes — a Walmart run that is part
// groceries, part household. Without this, `transactions.category` forces the
// whole amount into one envelope, which is wrong for exactly the merchants
// where the amounts are largest.
//
// Model: a transaction either has NO split rows (its own `category` applies, as
// before) or has splits that fully replace it. There is no partial state — the
// splits must sum to the parent amount, so money can't appear or vanish from
// budget totals. Existing rows need no migration.
export const transactionSplits = sqliteTable(
  "transaction_splits",
  {
    id: text("id").primaryKey(),
    transactionId: text("transaction_id")
      .notNull()
      .references(() => transactions.id, { onDelete: "cascade" }),
    // Denormalized from the parent so per-user queries don't need a join.
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    // Envelope NAME, matching transactions.category — envelopes are referenced
    // by name throughout, and past rows must survive an envelope being renamed
    // or deactivated.
    category: text("category").notNull(),
    // Same sign convention as the parent: negative = spend.
    amount: real("amount").notNull(),
    note: text("note"), // optional, e.g. "dog food"
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    index("idx_splits_transaction").on(t.transactionId), // load a transaction's splits
    index("idx_splits_user_category").on(t.userId, t.category), // budget rollups
  ]
);

// ── learned_rules ─────────────────────────────────────────────────────────────
// The learning loop (build-reminders 6b). A user correction (6a) turned into a
// standing rule. This is our stand-in for the merchant-identity + override layer
// the big aggregators get from a population-scale model: we cannot infer a
// merchant's boundary from a database we don't have, so the user declares it —
// by approving a pattern they widened or narrowed against a live catch count —
// and that declaration OVERRIDES the shipped seed rules (categorize() consults
// these first). A user's correction is authoritative; a shipped guess is not.
//
// Kept in its own table, not appended to an envelope's category_rules, for two
// reasons the array cannot serve: these must win over seed rules regardless of
// which rule is longer (precedence is by SOURCE, not specificity), and they
// carry provenance — what taught them, and what the user agreed to at the time.
// ── transfer_patterns ─────────────────────────────────────────────────────────
// The user's APPROVED transfer patterns — the first production writer for
// transactions.transfer_source (the real data's 828 transfers were marked by
// one-off scripts; SUGGESTED_TRANSFER_PATTERNS seeds the proposal UI, never
// applied unapproved). Matching uses matchesTransferPattern (substring on the
// shared normalization). On save, existing unmarked rows are retro-marked
// 'rule'; manual marks are never touched by pattern changes.
export const transferPatterns = sqliteTable(
  "transfer_patterns",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    pattern: text("pattern").notNull(),
    // The row-match count the user saw when approving — what they agreed to.
    catchesAtCreation: integer("catches_at_creation"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("idx_transfer_patterns_user").on(t.userId)]
);

export const learnedRules = sqliteTable(
  "learned_rules",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    // Matched against a normalized description with the same machinery as a seed
    // rule (lib/categorization.ts). This is the user-declared merchant identity.
    pattern: text("pattern").notNull(),
    // Envelope NAME, matching transactions.category — categories are referenced
    // by name throughout, so a learned rule survives an envelope rename via the
    // same cascade that rewrites transactions.category (see envelopes/[id]).
    category: text("category").notNull(),
    // Which correction taught this, so the rule is traceable and the UI can say
    // "learned from <merchant>". Nullable: the teaching row may later be deleted,
    // but the rule it taught outlives it.
    learnedFromTransactionId: text("learned_from_transaction_id"),
    // The catch count the user saw when they approved the rule — an audit of what
    // they actually agreed to, so a later "why did this grab 40 rows?" has an
    // answer that isn't a guess.
    catchesAtCreation: integer("catches_at_creation"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    index("idx_learned_rules_user").on(t.userId), // load a user's rules for categorize
    // One category per pattern per user: re-teaching the same pattern updates the
    // target rather than leaving two rules fighting over the same rows.
    uniqueIndex("uq_learned_rules_user_pattern").on(t.userId, t.pattern),
  ]
);

// ── categorization_events ─────────────────────────────────────────────────────
// Append-only log of the labeled examples the learning loop produces — the
// durable asset, and the answer to "what happens when this needs to scale."
//
// A learned rule (learned_rules) is a lossy, per-user compression of one fact:
// "this bank description belongs in this category." Every categorizer that could
// ever replace or augment our hand-written matching — an ML model, a
// merchant-entity resolver, an aggregator's enrichment — trains on that
// (description, category) pair itself, at volume. learned_rules is the runtime
// index; THIS is the training set. It is also the one thing that cannot be
// reconstructed after the fact, so it is captured now under the same "capture
// now, trim later, can't backfill" rule as job_runs and the snapshot tables.
//
// Never updated, never deleted: a row that is later re-corrected appends a new
// event rather than overwriting, so the sequence of what the user decided — and
// what the engine got wrong — survives intact.
export const categorizationEvents = sqliteTable(
  "categorization_events",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    // "manual_correction" — a row re-filed by hand (6a); "rule_saved" — a
    // correction promoted to a standing rule (6b). Both are labels; a rule event
    // additionally records the merchant boundary the user drew.
    eventType: text("event_type").notNull(),
    // The transaction the label came from, when there is one. Deliberately not a
    // cascading FK: the label must outlive the row it came from — the whole
    // reason this lives in its own table.
    transactionId: text("transaction_id"),
    // The raw bank description, verbatim — the model input.
    rawDescription: text("raw_description").notNull(),
    // normalizeDescription() of the raw string: today's best merchant handle.
    // Stored so a future entity resolver can re-cluster labels by merchant
    // without re-asking the user, even though right now it is an approximation.
    merchantHandle: text("merchant_handle").notNull(),
    // The user's OWN category word (the envelope name), verbatim. A future
    // canonical taxonomy maps ONTO this; storing only a mapped value would throw
    // away the raw word, which cannot be recovered.
    category: text("category").notNull(),
    // What the row was categorized as before the correction — signal about what
    // the engine got wrong. Null when there is no prior value.
    previousCategory: text("previous_category"),
    // For rule_saved: the pattern the user approved — the boundary they drew.
    // Null for a plain correction.
    pattern: text("pattern"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("idx_categorization_events_user").on(t.userId, t.createdAt)]
);

// ── budget_envelopes ──────────────────────────────────────────────────────────
export const budgetEnvelopes = sqliteTable("budget_envelopes", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id),
  name: text("name").notNull(),
  monthlyTarget: real("monthly_target").notNull(),
  categoryRules: text("category_rules").notNull(), // JSON: string[]
  active: integer("active").notNull().default(1),
  sortOrder: integer("sort_order").notNull().default(0),
  // Parent group for the budget tab's app-folder-style tiles. Nullable: a
  // category with no group falls into an "Ungrouped" tile. User-assignable, so
  // it is a plain label, not a foreign key to a groups table — the set of
  // groups is just the distinct names in use.
  groupName: text("group_name"),
  createdAt: integer("created_at").notNull(),
});

// ── envelope_allocations ──────────────────────────────────────────────────────
export const envelopeAllocations = sqliteTable(
  "envelope_allocations",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    envelopeId: text("envelope_id")
      .notNull()
      .references(() => budgetEnvelopes.id),
    year: integer("year").notNull(),
    month: integer("month").notNull(), // 1-12
    allocated: real("allocated").notNull(),
  },
  (t) => [uniqueIndex("uq_envelope_year_month").on(t.envelopeId, t.year, t.month)]
);

// ── wealthsimple_connections ──────────────────────────────────────────────────
export const wealthsimpleConnections = sqliteTable("wealthsimple_connections", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id),
  snaptradeUserId: text("snaptrade_user_id").notNull(),
  snaptradeAuthToken: text("snaptrade_auth_token").notNull(), // AES-256-GCM encrypted
  status: text("status").notNull().default("active"), // "active" | "reconnect_required"
  lastSyncedAt: integer("last_synced_at"),
  // JSON map of SnapTrade account id → user-chosen display name. SnapTrade
  // does not carry Wealthsimple's own nicknames (every account arrives as
  // "Wealthsimple Trade <TYPE>" + an internal slug), so the user names their
  // accounts here, once, in-app.
  accountNames: text("account_names"),
  createdAt: integer("created_at").notNull(),
});

// ── portfolio_snapshots ───────────────────────────────────────────────────────
// Append-only time-series. Never overwritten.
export const portfolioSnapshots = sqliteTable("portfolio_snapshots", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id),
  snapshotAt: integer("snapshot_at").notNull(), // Unix timestamp
  totalValue: real("total_value").notNull(),
  cashValue: real("cash_value").notNull(),
  accounts: text("accounts").notNull(), // JSON: { tfsa, rrsp, non_reg, crypto }
  createdAt: integer("created_at").notNull(),
});

// ── holdings ──────────────────────────────────────────────────────────────────
export const holdings = sqliteTable("holdings", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id),
  snapshotId: text("snapshot_id")
    .notNull()
    .references(() => portfolioSnapshots.id),
  ticker: text("ticker").notNull(),
  name: text("name").notNull(),
  quantity: real("quantity").notNull(),
  costBasis: real("cost_basis").notNull(), // per share
  marketValue: real("market_value").notNull(), // total position at snapshot time
  openPnl: real("open_pnl"), // broker-computed unrealized P&L (SnapTrade Position.open_pnl) — stored alongside, not replacing, the app's own calc
  accountType: text("account_type").notNull(), // "tfsa" | "rrsp" | "non_reg" | "crypto"
  createdAt: integer("created_at").notNull(),
});

// ── portfolio_transactions ────────────────────────────────────────────────────
export const portfolioTransactions = sqliteTable("portfolio_transactions", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id),
  date: text("date").notNull(), // ISO 8601
  type: text("type").notNull(), // "buy" | "sell" | "dividend" | "deposit" | "withdrawal"
  ticker: text("ticker"),
  quantity: real("quantity"),
  price: real("price"),
  amount: real("amount").notNull(),
  accountType: text("account_type").notNull(),
  createdAt: integer("created_at").notNull(),
});

// ── price_alerts ──────────────────────────────────────────────────────────────
export const priceAlerts = sqliteTable(
  "price_alerts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    ticker: text("ticker").notNull(),
    holdingId: text("holding_id").references(() => holdings.id),
    label: text("label"),
    conditionType: text("condition_type").notNull(), // "price_above" | "price_below" | "pct_change_up" | "pct_change_down"
    // v2: "ma_cross_above" | "ma_cross_below" | "rsi_above" | "rsi_below" | "volume_spike"
    threshold: real("threshold").notNull(), // dollar price OR decimal pct (0.03 = 3%)
    conditionParams: text("condition_params"), // JSON: extra params for v2 conditions, NULL for simple threshold alerts
    extendedHours: integer("extended_hours").notNull().default(0), // 0 = regular session only, 1 = include pre/post market
    status: text("status").notNull().default("active"), // "active" | "triggered" | "paused" | "expired"
    cooldownSeconds: integer("cooldown_seconds"), // NULL = one-time fire (default)
    nextCheckAt: integer("next_check_at"), // Unix timestamp; NULL = check every poll
    lastTriggeredAt: integer("last_triggered_at"),
    triggerCount: integer("trigger_count").notNull().default(0),
    source: text("source").notNull().default("native"), // "native" | "tradingview"
    notificationChannels: text("notification_channels").notNull().default('["in_app"]'), // JSON array
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    expiresAt: integer("expires_at"),
  },
  (t) => [
    index("idx_price_alerts_ticker_status").on(t.ticker, t.status), // polling query
    index("idx_price_alerts_user_status").on(t.userId, t.status), // user alert list
    index("idx_price_alerts_next_check").on(t.nextCheckAt), // cooldown window
  ]
);

// ── alert_fires ───────────────────────────────────────────────────────────────
export const alertFires = sqliteTable(
  "alert_fires",
  {
    id: text("id").primaryKey(),
    alertId: text("alert_id")
      .notNull()
      .references(() => priceAlerts.id),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    ticker: text("ticker").notNull(),
    conditionType: text("condition_type").notNull(),
    threshold: real("threshold").notNull(),
    triggerPrice: real("trigger_price").notNull(), // actual price at fire time
    triggerPctChange: real("trigger_pct_change"), // populated for pct_change conditions
    source: text("source").notNull(), // "native" | "tradingview"
    firedAt: integer("fired_at").notNull(), // Unix timestamp
    firedAtBucket: integer("fired_at_bucket").notNull(), // FLOOR(fired_at / 300) * 300 — 5-min dedup bucket
    deliveredChannels: text("delivered_channels").notNull(), // JSON array
    readAt: integer("read_at"), // NULL until user marks read
  },
  (t) => [
    uniqueIndex("uq_alert_fires_alert_bucket").on(t.alertId, t.firedAtBucket), // hard DB-level dedup guard
  ]
);

// ── price_cache ───────────────────────────────────────────────────────────────
// Last-known-good prices. Prevents false alerts from null/stale data mid-poll-cycle.
export const priceCache = sqliteTable("price_cache", {
  ticker: text("ticker").primaryKey(),
  regularMarketPrice: real("regular_market_price").notNull(),
  regularMarketChangePercent: real("regular_market_change_percent"),
  preMarketPrice: real("pre_market_price"),
  postMarketPrice: real("post_market_price"),
  previousClose: real("previous_close"),
  fetchedAt: integer("fetched_at").notNull(), // Unix timestamp of last successful fetch
  source: text("source").notNull().default("yahoo"),
});

// ── tradingview_alerts ────────────────────────────────────────────────────────
export const tradingviewAlerts = sqliteTable("tradingview_alerts", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id),
  ticker: text("ticker").notNull(),
  conditionText: text("condition_text").notNull(),
  price: real("price"),
  interval: text("interval"),
  rawPayload: text("raw_payload").notNull(), // JSON: full webhook body
  receivedAt: integer("received_at").notNull(),
  readAt: integer("read_at"), // NULL until user marks read (mirrors alert_fires.read_at)
  analyzedAt: integer("analyzed_at"), // NULL until user triggers LLM analysis — a different fact than read_at
});

// ── llm_analysis_cache ────────────────────────────────────────────────────────
// Exception to append-only: always upserted with latest result.
export const llmAnalysisCache = sqliteTable(
  "llm_analysis_cache",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    view: text("view").notNull(), // "budget" | "portfolio"
    lastAnalyzedAt: integer("last_analyzed_at").notNull(),
    output: text("output").notNull(), // JSON: array of card objects
    createdAt: integer("created_at").notNull(),
  },
  (t) => [uniqueIndex("uq_llm_cache_user_view").on(t.userId, t.view)]
);

// ── job_runs ──────────────────────────────────────────────────────────────────
// Observability spine — every background execution writes a row (replaces import_jobs).
// Metadata rule: capture every data point available per run; trim later, can't backfill.
export const jobRuns = sqliteTable(
  "job_runs",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").references(() => user.id), // NULL for system-wide jobs (alert_poll)
    jobType: text("job_type").notNull(), // "plaid_sync" | "snaptrade_sync" | "alert_poll" | "nightly_batch"
    // | "import_csv" | "import_google_sheets" | "import_excel"
    // | "tradingview_webhook" | "graph_subscription_renewal" | "recategorize"
    status: text("status").notNull(), // "running" | "complete" | "partial" | "failed"
    startedAt: integer("started_at").notNull(),
    finishedAt: integer("finished_at"),
    errorMessage: text("error_message"),
    metadata: text("metadata"), // JSON: tickers polled, alerts fired, rows synced/imported, tokens used, batch IDs, …
  },
  (t) => [
    index("idx_job_runs_type_started").on(t.jobType, t.startedAt), // dev-screen filtering, heartbeat queries
    index("idx_job_runs_user").on(t.userId), // per-user views (import history)
  ]
);

// ── bank_balance_snapshots ────────────────────────────────────────────────────
// Append-only balance history — banking-side analog of portfolio_snapshots.
// One row per account per daily sync. Powers net-worth-over-time; cannot be backfilled.
export const bankBalanceSnapshots = sqliteTable(
  "bank_balance_snapshots",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => bankAccounts.id),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    balanceAvailable: real("balance_available"),
    balanceCurrent: real("balance_current"),
    balanceLimit: real("balance_limit"),
    isoCurrencyCode: text("iso_currency_code"),
    capturedAt: integer("captured_at").notNull(),
  },
  (t) => [
    index("idx_balance_snapshots_account").on(t.accountId, t.capturedAt), // per-account history
    index("idx_balance_snapshots_user").on(t.userId, t.capturedAt), // net-worth query
  ]
);

// ── webhook_credentials ───────────────────────────────────────────────────────
// Per-user webhook secrets — the secret identifies the user for unauthenticated
// inbound webhooks (TradingView sends it in the request body; plaintext never stored).
export const webhookCredentials = sqliteTable(
  "webhook_credentials",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    service: text("service").notNull(), // "tradingview"
    secretHash: text("secret_hash").notNull(),
    createdAt: integer("created_at").notNull(),
    lastUsedAt: integer("last_used_at"),
  },
  (t) => [uniqueIndex("uq_webhook_credentials_hash").on(t.secretHash)] // lookup key on inbound webhook
);

// ── ohlcv_cache ───────────────────────────────────────────────────────────────
// Durable OHLCV persistence (24h TTL enforced in code via fetched_at). Survives
// Railway restarts — Yahoo breakage must not make historical chart data unrecoverable.
export const ohlcvCache = sqliteTable(
  "ohlcv_cache",
  {
    ticker: text("ticker").notNull(),
    range: text("range").notNull(), // "1mo" | "3mo" | "6mo" | "1y" | "2y" | "5y"
    bars: text("bars").notNull(), // JSON: OHLCV bar array
    fetchedAt: integer("fetched_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.ticker, t.range] })]
);

// ── spreadsheet_connections ───────────────────────────────────────────────────
// Live Google Sheets / Excel import connections (spec §5.7 / Tickets 008/004).
// Mirrors the dedicated encrypted-token pattern of wealthsimple_connections
// rather than reusing Better Auth's login `account` table — data-access OAuth is
// a different concern from sign-in, and Excel isn't a login provider at all.
// Tokens are AES-256-GCM encrypted (lib/crypto), same as Plaid/SnapTrade tokens.
export const spreadsheetConnections = sqliteTable(
  "spreadsheet_connections",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    provider: text("provider").notNull(), // "google_sheets" | "excel"
    accessToken: text("access_token").notNull(), // encrypted
    refreshToken: text("refresh_token"), // encrypted; may be absent if provider omits it
    expiresAt: integer("expires_at"), // unix seconds — when the access token expires
    scope: text("scope"),
    // Source pointer — set after the user picks a file/range post-connect (nullable until then)
    externalFileId: text("external_file_id"), // spreadsheetId (Google) / driveItem id (Excel)
    externalFileName: text("external_file_name"),
    worksheet: text("worksheet"), // sheet/tab name or A1 range
    mapping: text("mapping"), // JSON: { date, description, amount, category? } column headers
    negateAmounts: integer("negate_amounts"), // boolean; source uses positive = debit
    status: text("status").notNull().default("active"), // "active" | "reauth_required"
    lastSyncedAt: integer("last_synced_at"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("idx_spreadsheet_connections_user").on(t.userId)]
);
