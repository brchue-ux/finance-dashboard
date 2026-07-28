/**
 * One-shot migration: the five ledger-money columns move from floating-point
 * dollars to integer cents. See `lib/money.ts` for the seam this lands on and
 * `db/money-columns.ts` for exactly which columns are in scope.
 *
 *   npx tsx --env-file=.env.local db/migrate-money-to-cents.ts --dry-run
 *   npx tsx --env-file=.env.local db/migrate-money-to-cents.ts --confirm
 *
 * `--dry-run` opens the database read-only-in-effect (it writes nothing) and
 * prints exactly what the real run would do. Nothing is written without
 * `--confirm`; the target URL is printed loudly either way, because
 * `.env.local` points at the real financial database by absolute path.
 *
 * ## How it works, and why not more simply
 *
 * Two phases, both inside ONE transaction so a failure leaves the database
 * exactly as it was:
 *
 *   A. Convert the values in place, `dollars → cents`, using `toCents` — the
 *      same rounding rule the running app uses. Deliberately computed in
 *      TypeScript rather than as SQL `ROUND(x*100)`: one rule, one
 *      implementation, one set of tests. The column is still declared REAL at
 *      this point, which stores the now-integral values exactly (they are far
 *      inside the 2^53 range a double represents without loss).
 *
 *   B. Rebuild each table with the money columns declared INTEGER, via the
 *      standard SQLite "create new, copy, drop, rename, recreate indexes"
 *      procedure — SQLite cannot ALTER a column's type. The copy uses
 *      `CAST(col AS INTEGER)`, which is lossless because phase A already made
 *      every value integral.
 *
 * The new table's DDL is derived from the database's OWN `sqlite_master` entry
 * with only the money columns' type token rewritten, so whatever the live
 * schema actually has — constraints, defaults, columns added since — survives
 * verbatim instead of being replaced by this file's idea of it.
 *
 * Idempotent: a table whose money columns are already declared INTEGER is
 * skipped. That marker is only set in phase B, and phases A and B share a
 * transaction, so "converted values but still REAL" is not a reachable state.
 *
 * Running it is NOT this script's whole job — `db/verify-money-cents.ts` proves
 * the result against a pre-migration copy. Take that copy first.
 */
import { createClient, type Client, type Transaction } from "@libsql/client";

import { toCents } from "../lib/money";
import { MONEY_COLUMNS } from "./money-columns";

const TEMP_PREFIX = "__cents_migration_";

type ColumnState = { column: string; declaredType: string; alreadyCents: boolean };

function fail(message: string): never {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

/** The table's CREATE statement as the database itself stores it. */
async function tableDdl(client: Client, table: string): Promise<string> {
  const r = await client.execute({
    sql: "select sql from sqlite_master where type = 'table' and name = ?",
    args: [table],
  });
  if (r.rows.length === 0) fail(`table "${table}" does not exist in this database`);
  return String(r.rows[0].sql);
}

/**
 * Index DDL to recreate after the rebuild. Indexes implied by UNIQUE/PRIMARY
 * KEY constraints have a NULL `sql` — they ride along inside the CREATE TABLE
 * and must not be recreated by hand.
 */
async function tableIndexDdl(client: Client, table: string): Promise<string[]> {
  const r = await client.execute({
    sql: "select sql from sqlite_master where type = 'index' and tbl_name = ? and sql is not null",
    args: [table],
  });
  return r.rows.map((row) => String(row.sql));
}

async function columnStates(
  client: Client,
  table: string,
  columns: readonly string[]
): Promise<ColumnState[]> {
  const info = await client.execute(`pragma table_info(${quoteIdent(table)})`);
  return columns.map((column) => {
    const row = info.rows.find((r) => String(r.name) === column);
    if (!row) fail(`column "${table}.${column}" does not exist in this database`);
    const declaredType = String(row.type);
    return { column, declaredType, alreadyCents: /^int/i.test(declaredType) };
  });
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/**
 * Rewrite just the type token of the named columns in a CREATE TABLE statement,
 * leaving every other byte alone. Anchored on the column name as drizzle-kit
 * emits it (a quoted identifier at the start of a column definition), and the
 * result is asserted to have actually changed, so a schema this pattern does not
 * fit fails loudly instead of silently migrating nothing.
 */
function rewriteDdl(ddl: string, table: string, columns: readonly string[]): string {
  let out = ddl;
  for (const column of columns) {
    const pattern = new RegExp(`(["\`\\[]?${column}["\`\\]]?\\s+)real\\b`, "i");
    if (!pattern.test(out)) {
      fail(
        `could not locate the REAL type of "${table}.${column}" in its CREATE statement — ` +
          `migrate this table by hand rather than trusting this rewrite:\n${ddl}`
      );
    }
    out = out.replace(pattern, "$1integer");
  }
  // Point the CREATE at the temporary name; the original is dropped first.
  const named = out.replace(
    new RegExp(`(create\\s+table\\s+)(["\`\\[]?)${table}\\2`, "i"),
    `$1${quoteIdent(TEMP_PREFIX + table)}`
  );
  if (named === out) fail(`could not rename the CREATE statement for "${table}":\n${ddl}`);
  return named;
}

/** Phase A — convert this table's money values to cents, in place. */
async function convertValues(
  tx: Transaction,
  table: string,
  columns: readonly string[]
): Promise<{ rows: number; converted: number; nulls: number; maxShiftDollars: number }> {
  const cols = columns.map(quoteIdent).join(", ");
  const rows = await tx.execute(`select "id", ${cols} from ${quoteIdent(table)}`);

  let converted = 0;
  let nulls = 0;
  let maxShiftDollars = 0;

  for (const row of rows.rows) {
    const updates: string[] = [];
    const args: (number | string)[] = [];

    for (const column of columns) {
      const value = row[column];
      if (value === null || value === undefined) {
        nulls += 1;
        continue;
      }
      const dollars = Number(value);
      if (!Number.isFinite(dollars)) {
        fail(
          `${table}.${column} holds a non-numeric value (${String(value)}) for id ${String(row.id)} — ` +
            `resolve that row before migrating`
        );
      }
      const cents = toCents(dollars);
      maxShiftDollars = Math.max(maxShiftDollars, Math.abs(cents / 100 - dollars));
      updates.push(`${quoteIdent(column)} = ?`);
      args.push(cents);
      converted += 1;
    }

    if (updates.length === 0) continue;
    args.push(String(row.id));
    await tx.execute({
      sql: `update ${quoteIdent(table)} set ${updates.join(", ")} where "id" = ?`,
      args,
    });
  }

  return { rows: rows.rows.length, converted, nulls, maxShiftDollars };
}

/** Phase B — rebuild the table with the money columns declared INTEGER. */
async function rebuildTable(
  tx: Transaction,
  table: string,
  columns: readonly string[],
  newDdl: string,
  indexDdl: string[],
  columnNames: string[]
): Promise<void> {
  const temp = TEMP_PREFIX + table;
  const moneySet = new Set(columns);
  const selectList = columnNames
    .map((c) => (moneySet.has(c) ? `cast(${quoteIdent(c)} as integer)` : quoteIdent(c)))
    .join(", ");
  const insertList = columnNames.map(quoteIdent).join(", ");

  await tx.execute(newDdl);
  await tx.execute(
    `insert into ${quoteIdent(temp)} (${insertList}) select ${selectList} from ${quoteIdent(table)}`
  );
  await tx.execute(`drop table ${quoteIdent(table)}`);
  await tx.execute(`alter table ${quoteIdent(temp)} rename to ${quoteIdent(table)}`);
  for (const ddl of indexDdl) await tx.execute(ddl);
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const dryRun = args.has("--dry-run");
  const confirmed = args.has("--confirm");

  const url = process.env.DATABASE_URL;
  if (!url) fail("DATABASE_URL is not set — pass --env-file=.env.local (or your scratch env)");

  console.log("\n  money → integer cents migration");
  console.log(`  target: ${url}`);
  console.log(`  mode:   ${dryRun ? "DRY RUN (writes nothing)" : confirmed ? "APPLY" : "—"}\n`);

  if (!dryRun && !confirmed) {
    fail(
      "refusing to run without an explicit mode. Pass --dry-run to preview, or --confirm to apply.\n" +
        "  Back the database up first: this rewrites five tables."
    );
  }

  const client = createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN });

  // Views and triggers are not part of the rebuild procedure below; if the
  // schema ever grows one over a money table, stop rather than silently drop it.
  const derived = await client.execute({
    sql: `select name, type, tbl_name from sqlite_master where type in ('view', 'trigger')`,
    args: [],
  });
  const touched = new Set(MONEY_COLUMNS.map((t) => t.table));
  const conflicting = derived.rows.filter((r) => touched.has(String(r.tbl_name)));
  if (conflicting.length > 0) {
    fail(
      `this database has triggers/views over migrated tables, which the rebuild would drop: ` +
        conflicting.map((r) => `${r.type} ${r.name}`).join(", ")
    );
  }

  // Survey first, so a dry run and a real run report the same thing.
  const plan: {
    table: string;
    columns: string[];
    states: ColumnState[];
    skip: boolean;
    rowCount: number;
  }[] = [];

  for (const { table, columns } of MONEY_COLUMNS) {
    const states = await columnStates(client, table, columns);
    const done = states.filter((s) => s.alreadyCents);
    if (done.length > 0 && done.length !== states.length) {
      fail(
        `"${table}" is half-migrated (${done.map((s) => s.column).join(", ")} already integer) — ` +
          `restore from backup rather than continuing`
      );
    }
    const count = await client.execute(`select count(*) as n from ${quoteIdent(table)}`);
    plan.push({
      table,
      columns: [...columns],
      states,
      skip: done.length === states.length,
      rowCount: Number(count.rows[0].n),
    });
  }

  for (const p of plan) {
    const types = p.states.map((s) => `${s.column} ${s.declaredType.toLowerCase()}`).join(", ");
    console.log(
      `  ${p.skip ? "skip" : "plan"}  ${p.table.padEnd(22)} ${String(p.rowCount).padStart(7)} rows  (${types})`
    );
  }

  const todo = plan.filter((p) => !p.skip);
  if (todo.length === 0) {
    console.log("\n  Nothing to do — every money column already stores integer cents.\n");
    await client.close();
    return;
  }

  if (dryRun) {
    console.log(`\n  DRY RUN — ${todo.length} table(s) would be rewritten. Nothing was written.\n`);
    await client.close();
    return;
  }

  // Foreign keys off for the rebuild: with them on, RENAME rewrites other
  // tables' REFERENCES clauses, and the moment between DROP and RENAME looks
  // like a broken schema. This is the procedure SQLite documents. Both PRAGMAs
  // must sit outside the transaction.
  await client.execute("pragma foreign_keys = off");
  await client.execute("pragma legacy_alter_table = on");

  const tx = await client.transaction("write");
  try {
    for (const p of todo) {
      const ddl = await tableDdl(client, p.table);
      const indexDdl = await tableIndexDdl(client, p.table);
      const info = await client.execute(`pragma table_info(${quoteIdent(p.table)})`);
      const columnNames = info.rows.map((r) => String(r.name));

      const stats = await convertValues(tx, p.table, p.columns);
      await rebuildTable(
        tx,
        p.table,
        p.columns,
        rewriteDdl(ddl, p.table, p.columns),
        indexDdl,
        columnNames
      );

      console.log(
        `  done  ${p.table.padEnd(22)} ${String(stats.rows).padStart(7)} rows  ` +
          `${stats.converted} values converted, ${stats.nulls} null, ` +
          `max rounding shift $${stats.maxShiftDollars.toFixed(4)}`
      );
    }

    const fkCheck = await tx.execute("pragma foreign_key_check");
    if (fkCheck.rows.length > 0) {
      throw new Error(
        `foreign_key_check reported ${fkCheck.rows.length} violation(s) — rolling back`
      );
    }

    await tx.commit();
  } catch (err) {
    await tx.rollback();
    await client.execute("pragma legacy_alter_table = off");
    await client.execute("pragma foreign_keys = on");
    await client.close();
    fail(`migration rolled back, database unchanged: ${err instanceof Error ? err.message : err}`);
  }

  await client.execute("pragma legacy_alter_table = off");
  await client.execute("pragma foreign_keys = on");

  // Reclaim the pages the rebuild orphaned, and make sure everything is on disk
  // rather than sitting in the WAL (see the DB safety protocol).
  await client.execute("vacuum");
  await client.execute("pragma wal_checkpoint(truncate)");
  await client.close();

  console.log(
    "\n  Migration applied. Now prove it:\n" +
      "    npx tsx --env-file=.env.local db/verify-money-cents.ts --before <pre-migration-backup.db>\n"
  );
}

main().catch((err) => fail(err instanceof Error ? (err.stack ?? err.message) : String(err)));
