/**
 * Proves that `db/migrate-money-to-cents.ts` was faithful. Run it after every
 * migration run — the migration's own success output speaks for the schema,
 * never for the data (DB safety protocol, rule 1).
 *
 *   npx tsx --env-file=.env.local db/verify-money-cents.ts --before <pre-migration-backup.db>
 *
 * `--before` is the copy taken BEFORE the migration; the "after" database is
 * whatever `DATABASE_URL` points at, or `--after <path>` if you would rather be
 * explicit than trust the environment. A bare path is accepted for either and
 * gets the `file:` prefix added.
 *
 * Six checks, all of which must pass. Exits non-zero on the first failure class
 * it finds, and prints every failing row up to a cap so the output is a place to
 * start debugging rather than just a verdict.
 *
 *   1. Every table in the before database still exists after.
 *   2. Row counts match, per table, across ALL tables — not just migrated ones.
 *      A rebuild that dropped rows from an untouched table is exactly the
 *      silent-loss failure this project has been bitten by twice.
 *   3. Each migrated column is declared INTEGER after (and was REAL before).
 *   4. Every stored value after is an integer. A fractional one means dollars
 *      survived the conversion.
 *   5. Every row round-trips, checked two ways: the stored cents are EXACTLY
 *      what the documented rounding rule produces from the original dollars,
 *      and — independently of that rule — `fromCents(after)` is within half a
 *      cent of the original. NULL before ⟺ NULL after.
 *   6. Column totals reconcile: the sum of the column before, and the sum of
 *      the cents after converted back to dollars, agree to within half a cent
 *      per row. This is the check that speaks to the headline invariant.
 */
import { createClient, type Client } from "@libsql/client";

import { fromCents, toCents } from "../lib/money";
import {
  COMPARISON_EPSILON_DOLLARS,
  CONVERSION_TOLERANCE_DOLLARS,
  MONEY_COLUMNS,
} from "./money-columns";

const MAX_REPORTED_ROWS = 20;

/** Rows fetched per round trip, per side. See `readRows`. */
const PAGE_SIZE = 500;

let failures = 0;

function pass(message: string): void {
  console.log(`  ✓ ${message}`);
}

function fail(message: string, detail?: string[]): void {
  failures += 1;
  console.error(`  ✗ ${message}`);
  for (const line of detail ?? []) console.error(`      ${line}`);
}

function abort(message: string): never {
  console.error(`\n✗ ${message}\n`);
  process.exit(2);
}

function asUrl(value: string): string {
  return /^(file:|libsql:|https?:|wss?:|:memory:)/.test(value) ? value : `file:${value}`;
}

function arg(name: string): string | undefined {
  const argv = process.argv.slice(2);
  const i = argv.indexOf(name);
  return i === -1 ? undefined : argv[i + 1];
}

async function tableNames(client: Client): Promise<string[]> {
  const r = await client.execute(
    `select name from sqlite_master where type = 'table' and name not like 'sqlite_%' order by name`
  );
  return r.rows.map((row) => String(row.name));
}

async function rowCount(client: Client, table: string): Promise<number> {
  const r = await client.execute(`select count(*) as n from "${table.replace(/"/g, '""')}"`);
  return Number(r.rows[0].n);
}

async function declaredType(client: Client, table: string, column: string): Promise<string> {
  const r = await client.execute(`pragma table_info("${table.replace(/"/g, '""')}")`);
  const row = r.rows.find((x) => String(x.name) === column);
  return row ? String(row.type).toLowerCase() : "";
}

async function checkRowCounts(before: Client, after: Client): Promise<void> {
  console.log("\n  Row counts (all tables)");
  const beforeTables = await tableNames(before);
  const afterTables = new Set(await tableNames(after));

  const missing = beforeTables.filter((t) => !afterTables.has(t));
  if (missing.length > 0) fail(`tables missing after migration: ${missing.join(", ")}`);

  let mismatches = 0;
  for (const table of beforeTables) {
    if (!afterTables.has(table)) continue;
    const [b, a] = [await rowCount(before, table), await rowCount(after, table)];
    if (b !== a) {
      mismatches += 1;
      fail(`${table}: ${b} rows before, ${a} after`);
    }
  }
  if (mismatches === 0 && missing.length === 0) {
    pass(`${beforeTables.length} tables, every row count unchanged`);
  }
}

async function checkColumnTypes(before: Client, after: Client): Promise<void> {
  console.log("\n  Declared column types");
  for (const { table, columns } of MONEY_COLUMNS) {
    for (const column of columns) {
      const [b, a] = [
        await declaredType(before, table, column),
        await declaredType(after, table, column),
      ];
      if (!a.startsWith("int")) {
        fail(`${table}.${column} is declared "${a}" after migration, expected integer`);
      } else if (!b.startsWith("real")) {
        fail(`${table}.${column} was declared "${b}" before migration, expected real`);
      } else {
        pass(`${table}.${column}: real → integer`);
      }
    }
  }
}

/**
 * One column's running verdict. Held per column for the length of a table's
 * walk; nothing else about the table is retained.
 */
interface ColumnCheck {
  compared: number;
  nulls: number;
  nonInteger: number;
  maxDelta: number;
  sumBefore: number;
  sumCentsAfter: number;
  problems: string[];
}

function newColumnCheck(): ColumnCheck {
  return {
    compared: 0,
    nulls: 0,
    nonInteger: 0,
    maxDelta: 0,
    sumBefore: 0,
    sumCentsAfter: 0,
    problems: [],
  };
}

/** Marks "the before row has no counterpart after", distinct from a NULL value. */
const ROW_MISSING = Symbol("row missing after");

function checkCell(
  c: ColumnCheck,
  id: string,
  rawBefore: unknown,
  rawAfter: unknown | typeof ROW_MISSING
): void {
  if (rawAfter === ROW_MISSING) {
    if (c.problems.length < MAX_REPORTED_ROWS) c.problems.push(`id ${id}: row missing after`);
    return;
  }

  if (rawBefore === null || rawBefore === undefined) {
    c.nulls += 1;
    if (rawAfter !== null && rawAfter !== undefined) {
      if (c.problems.length < MAX_REPORTED_ROWS) {
        c.problems.push(`id ${id}: NULL before, ${String(rawAfter)} after`);
      }
    }
    return;
  }
  if (rawAfter === null || rawAfter === undefined) {
    if (c.problems.length < MAX_REPORTED_ROWS) {
      c.problems.push(`id ${id}: ${String(rawBefore)} before, NULL after`);
    }
    return;
  }

  const dollarsBefore = Number(rawBefore);
  const centsAfter = Number(rawAfter);

  if (!Number.isInteger(centsAfter)) {
    c.nonInteger += 1;
    if (c.problems.length < MAX_REPORTED_ROWS) {
      c.problems.push(`id ${id}: stored value ${centsAfter} is not an integer`);
    }
    return;
  }

  // Primary check, and it is exact: the stored cents must be what the
  // documented rounding rule produces from the original dollars. No
  // tolerance is needed or wanted here — "close enough" would hide a row
  // the migration skipped and something else later nudged.
  const expected = toCents(dollarsBefore);
  if (centsAfter !== expected) {
    if (c.problems.length < MAX_REPORTED_ROWS) {
      c.problems.push(
        `id ${id}: ${dollarsBefore} → expected ${expected}¢ by the rounding rule, stored ${centsAfter}¢`
      );
    }
    return;
  }

  // Independent bound, derived from the values rather than from the rule,
  // so a wrong rule cannot pass by agreeing with itself.
  const delta = Math.abs(fromCents(centsAfter) - dollarsBefore);
  if (delta > CONVERSION_TOLERANCE_DOLLARS + COMPARISON_EPSILON_DOLLARS) {
    if (c.problems.length < MAX_REPORTED_ROWS) {
      c.problems.push(
        `id ${id}: ${dollarsBefore} before → ${fromCents(centsAfter)} after (Δ ${delta})`
      );
    }
  }

  c.compared += 1;
  c.maxDelta = Math.max(c.maxDelta, delta);
  c.sumBefore += dollarsBefore;
  c.sumCentsAfter += centsAfter;
}

/**
 * A table's id + money columns, read in keyset pages over `id` rather than all
 * at once. `DATABASE_URL` may be remote (`drizzle.config.ts` uses the "turso"
 * dialect), and holding two whole tables in memory to compare them is the one
 * cost this script has no reason to pay.
 */
async function* readRows(
  client: Client,
  table: string,
  columns: readonly string[]
): AsyncGenerator<Record<string, unknown>> {
  const quoted = columns.map((c) => `"${c}"`).join(", ");
  const name = `"${table.replace(/"/g, '""')}"`;
  let cursor: string | null = null;

  for (;;) {
    const page = await client.execute({
      sql:
        `select "id", ${quoted} from ${name} ` +
        `${cursor === null ? "" : 'where "id" > ? '}order by "id" limit ?`,
      args: cursor === null ? [PAGE_SIZE] : [cursor, PAGE_SIZE],
    });
    if (page.rows.length === 0) return;
    for (const row of page.rows) yield row as unknown as Record<string, unknown>;
    if (page.rows.length < PAGE_SIZE) return;
    cursor = String(page.rows[page.rows.length - 1].id);
  }
}

async function checkValues(before: Client, after: Client): Promise<void> {
  console.log("\n  Per-row round trip and column totals");

  for (const { table, columns } of MONEY_COLUMNS) {
    // Both sides arrive in `id` order, so one merge-walk pairs them without
    // indexing either side. Extra rows on the after side are not this check's
    // business — checkRowCounts already speaks for those.
    const beforeRows = readRows(before, table, columns);
    const afterRows = readRows(after, table, columns);
    const checks = new Map(columns.map((c) => [c, newColumnCheck()]));

    let b = await beforeRows.next();
    let a = await afterRows.next();
    while (!b.done) {
      const id = String(b.value.id);
      while (!a.done && String(a.value.id) < id) a = await afterRows.next();
      const paired = !a.done && String(a.value.id) === id ? a.value : null;

      for (const column of columns) {
        checkCell(
          checks.get(column)!,
          id,
          b.value[column],
          paired ? paired[column] : ROW_MISSING
        );
      }

      if (paired) a = await afterRows.next();
      b = await beforeRows.next();
    }

    for (const column of columns) {
      const { compared, nulls, nonInteger, maxDelta, sumBefore, sumCentsAfter, problems } =
        checks.get(column)!;

      const label = `${table}.${column}`;
      if (problems.length > 0 || nonInteger > 0) {
        fail(`${label}: ${problems.length} row(s) failed`, problems);
        continue;
      }

      // Totals. The two sums cannot be compared for exact equality: the "before"
      // side is a float running sum and is itself the drift this migration
      // removes. Half a cent per row is the honest bound.
      const totalAfter = fromCents(sumCentsAfter);
      const totalDelta = Math.abs(totalAfter - sumBefore);
      const totalBound =
        CONVERSION_TOLERANCE_DOLLARS * Math.max(compared, 1) + COMPARISON_EPSILON_DOLLARS;
      if (totalDelta > totalBound) {
        fail(
          `${label}: total moved $${totalDelta.toFixed(4)} ` +
            `($${sumBefore.toFixed(2)} → $${totalAfter.toFixed(2)}), bound $${totalBound.toFixed(4)}`
        );
        continue;
      }

      pass(
        `${label}: ${compared} values + ${nulls} null round-trip; ` +
          `max Δ $${maxDelta.toFixed(4)}; total $${sumBefore.toFixed(2)} → $${totalAfter.toFixed(2)}`
      );
    }
  }
}

async function main() {
  const beforePath = arg("--before");
  if (!beforePath) {
    abort(
      "--before <pre-migration-backup.db> is required.\n" +
        "  There is no way to prove the conversion was faithful without the values it started from."
    );
  }
  const afterPath = arg("--after") ?? process.env.DATABASE_URL;
  if (!afterPath) abort("no --after and no DATABASE_URL — nothing to verify against");

  console.log("\n  money → integer cents verification");
  console.log(`  before: ${asUrl(beforePath)}`);
  console.log(`  after:  ${asUrl(afterPath)}`);

  const before = createClient({ url: asUrl(beforePath) });
  const after = createClient({
    url: asUrl(afterPath),
    authToken: process.env.DATABASE_AUTH_TOKEN,
  });

  await checkRowCounts(before, after);
  await checkColumnTypes(before, after);
  await checkValues(before, after);

  await before.close();
  await after.close();

  if (failures > 0) {
    console.error(`\n✗ VERIFICATION FAILED — ${failures} check(s) failed. Restore from backup.\n`);
    process.exit(1);
  }
  console.log("\n✓ VERIFICATION PASSED — conversion is faithful.\n");
}

main().catch((err) => abort(err instanceof Error ? (err.stack ?? err.message) : String(err)));
