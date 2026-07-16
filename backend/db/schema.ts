import { sql } from "drizzle-orm";
import {
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

// ── users ────────────────────────────────────────────────────────────────────
export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").unique().notNull(),
  createdAt: integer("created_at").notNull(),
});

// ── bank_connections ─────────────────────────────────────────────────────────
export const bankConnections = sqliteTable("bank_connections", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  institutionName: text("institution_name").notNull(), // "RBC" | "Tangerine" | "Scotiabank"
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
    .references(() => users.id),
  connectionId: text("connection_id")
    .notNull()
    .references(() => bankConnections.id),
  plaidAccountId: text("plaid_account_id").notNull().unique(),
  name: text("name").notNull(),
  type: text("type").notNull(), // "chequing" | "savings" | "credit"
  mask: text("mask"), // last 4 digits
  institution: text("institution").notNull(),
});

// ── transactions ─────────────────────────────────────────────────────────────
export const transactions = sqliteTable("transactions", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  accountId: text("account_id")
    .notNull()
    .references(() => bankAccounts.id),
  plaidTransactionId: text("plaid_transaction_id").unique(),
  date: text("date").notNull(), // ISO 8601 YYYY-MM-DD
  description: text("description").notNull(), // raw bank description
  merchantName: text("merchant_name"), // cleaned by categorization engine
  amount: real("amount").notNull(), // negative = debit, positive = credit
  category: text("category"), // envelope name assigned
  pending: integer("pending").notNull().default(0), // boolean
  createdAt: integer("created_at").notNull(),
});

// ── budget_envelopes ──────────────────────────────────────────────────────────
export const budgetEnvelopes = sqliteTable("budget_envelopes", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  name: text("name").notNull(),
  monthlyTarget: real("monthly_target").notNull(),
  categoryRules: text("category_rules").notNull(), // JSON: string[]
  active: integer("active").notNull().default(1),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: integer("created_at").notNull(),
});

// ── envelope_allocations ──────────────────────────────────────────────────────
export const envelopeAllocations = sqliteTable(
  "envelope_allocations",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
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
    .references(() => users.id),
  snaptradeUserId: text("snaptrade_user_id").notNull(),
  snaptradeAuthToken: text("snaptrade_auth_token").notNull(), // AES-256-GCM encrypted
  status: text("status").notNull().default("active"), // "active" | "reconnect_required"
  lastSyncedAt: integer("last_synced_at"),
  createdAt: integer("created_at").notNull(),
});

// ── portfolio_snapshots ───────────────────────────────────────────────────────
// Append-only time-series. Never overwritten.
export const portfolioSnapshots = sqliteTable("portfolio_snapshots", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
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
    .references(() => users.id),
  snapshotId: text("snapshot_id")
    .notNull()
    .references(() => portfolioSnapshots.id),
  ticker: text("ticker").notNull(),
  name: text("name").notNull(),
  quantity: real("quantity").notNull(),
  costBasis: real("cost_basis").notNull(), // per share
  marketValue: real("market_value").notNull(), // total position at snapshot time
  accountType: text("account_type").notNull(), // "tfsa" | "rrsp" | "non_reg" | "crypto"
  createdAt: integer("created_at").notNull(),
});

// ── portfolio_transactions ────────────────────────────────────────────────────
export const portfolioTransactions = sqliteTable("portfolio_transactions", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  date: text("date").notNull(), // ISO 8601
  type: text("type").notNull(), // "buy" | "sell" | "dividend" | "deposit" | "withdrawal"
  ticker: text("ticker"),
  quantity: real("quantity"),
  price: real("price"),
  amount: real("amount").notNull(),
  accountType: text("account_type").notNull(),
  createdAt: integer("created_at").notNull(),
});

// ── tradingview_alerts ────────────────────────────────────────────────────────
export const tradingviewAlerts = sqliteTable("tradingview_alerts", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  ticker: text("ticker").notNull(),
  conditionText: text("condition_text").notNull(),
  price: real("price"),
  interval: text("interval"),
  rawPayload: text("raw_payload").notNull(), // JSON: full webhook body
  receivedAt: integer("received_at").notNull(),
  analyzedAt: integer("analyzed_at"), // NULL until user triggers analysis
});

// ── llm_analysis_cache ────────────────────────────────────────────────────────
// Exception to append-only: always upserted with latest result.
export const llmAnalysisCache = sqliteTable(
  "llm_analysis_cache",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    view: text("view").notNull(), // "budget" | "portfolio"
    lastAnalyzedAt: integer("last_analyzed_at").notNull(),
    output: text("output").notNull(), // JSON: array of card objects
    createdAt: integer("created_at").notNull(),
  },
  (t) => [uniqueIndex("uq_llm_cache_user_view").on(t.userId, t.view)]
);

// ── import_jobs ───────────────────────────────────────────────────────────────
export const importJobs = sqliteTable("import_jobs", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  source: text("source").notNull(), // "google_sheets" | "csv"
  status: text("status").notNull().default("pending"), // "pending" | "processing" | "complete" | "failed"
  rowsImported: integer("rows_imported").default(0),
  errorMessage: text("error_message"),
  createdAt: integer("created_at").notNull(),
  completedAt: integer("completed_at"),
});
