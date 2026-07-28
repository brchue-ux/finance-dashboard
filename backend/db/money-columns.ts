/**
 * The ledger-money columns that store integer cents, named once so the
 * migration, the verification script and any future audit cannot drift from
 * each other or from `schema.ts`.
 *
 * Deliberately NOT every `real` column in the schema. Integer cents exist to
 * make sums exact, so only values that are ledger facts belong here. Share
 * quantities, per-share and market prices, percentages and thresholds, and
 * derived portfolio valuations stay `real` — they are fractional or estimates,
 * and forcing them onto a two-decimal grid would be a bug, not a fix.
 *
 * `bank_balance_snapshots.balance_*` has to convert in the SAME pass as
 * `bank_accounts.balance_*`, not a later one. `lib/plaid-accounts.ts` writes
 * both from one sync and `app/api/reports/route.ts` reads both into one
 * net-worth series, so a window where the two tables disagreed about their unit
 * would corrupt that history by a factor of 100 — and the snapshot table is
 * append-only, so there is nothing to recompute it from afterwards.
 */
export const MONEY_COLUMNS: ReadonlyArray<{ table: string; columns: readonly string[] }> = [
  { table: "bank_accounts", columns: ["balance_available", "balance_current", "balance_limit"] },
  {
    table: "bank_balance_snapshots",
    columns: ["balance_available", "balance_current", "balance_limit"],
  },
  { table: "transactions", columns: ["amount"] },
  { table: "transaction_splits", columns: ["amount"] },
  { table: "budget_envelopes", columns: ["monthly_target"] },
  { table: "envelope_allocations", columns: ["allocated"] },
];

/**
 * Half a cent — the largest error the conversion can introduce, because
 * rounding to the nearest cent is exactly what it does. Any row further than
 * this from its original value means something other than rounding happened.
 */
export const CONVERSION_TOLERANCE_DOLLARS = 0.005;

/**
 * Slack for the float error in *computing* a comparison, not for the conversion
 * itself. A value that rounded by exactly half a cent yields a subtraction
 * result like 0.005000000000000115, which would trip a naive `> 0.005` test and
 * report a correct migration as broken. A nanodollar is ten million times
 * smaller than the smallest amount the ledger can hold, so it cannot mask a real
 * discrepancy.
 */
export const COMPARISON_EPSILON_DOLLARS = 1e-9;
