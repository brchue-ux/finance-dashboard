import { createClient } from "@libsql/client";
import { eq, getTableColumns, getTableName, gt, is, isNull, lt } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { SQLiteTable, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";

import { MONEY_COLUMNS } from "@/db/money-columns";
import * as schema from "@/db/schema";

import {
  CENTS_PER_DOLLAR,
  fromCents,
  fromCentsOrNull,
  isWholeCents,
  moneyCents,
  toCents,
  toCentsOrNull,
} from "./money";

describe("toCents", () => {
  it("converts whole and fractional dollars", () => {
    expect(toCents(0)).toBe(0);
    expect(toCents(1)).toBe(100);
    expect(toCents(12.34)).toBe(1234);
    expect(toCents(0.01)).toBe(1);
    expect(toCents(1234567.89)).toBe(123456789);
  });

  it("preserves the ledger sign convention (negative = debit)", () => {
    expect(toCents(-12.34)).toBe(-1234);
    expect(toCents(-0.01)).toBe(-1);
    expect(toCents(-1234567.89)).toBe(-123456789);
  });

  it("negating an amount negates its cents", () => {
    for (const dollars of [0.005, 1.005, 2.675, 12.34, 0.145, 99.999]) {
      expect(toCents(-dollars)).toBe(-toCents(dollars));
    }
  });

  // The whole reason this module does not just call Math.round: the double
  // nearest to 1.005 sits below it, so `Math.round(1.005 * 100)` is 100.
  describe("half-cent boundary", () => {
    it("rounds a half cent away from zero", () => {
      expect(toCents(0.005)).toBe(1);
      expect(toCents(0.015)).toBe(2);
      expect(toCents(1.005)).toBe(101);
      expect(toCents(2.675)).toBe(268);
      expect(toCents(8.325)).toBe(833);
      expect(toCents(1.115)).toBe(112);
    });

    it("rounds a negative half cent away from zero", () => {
      expect(toCents(-0.005)).toBe(-1);
      expect(toCents(-1.005)).toBe(-101);
      expect(toCents(-2.675)).toBe(-268);
      expect(toCents(-8.325)).toBe(-833);
    });

    it("does not disagree with naive rounding on values that are not boundaries", () => {
      expect(toCents(1.004)).toBe(100);
      expect(toCents(1.006)).toBe(101);
      expect(toCents(-1.004)).toBe(-100);
      expect(toCents(-1.006)).toBe(-101);
    });

    it("never returns negative zero", () => {
      expect(Object.is(toCents(-0.004), 0)).toBe(true);
      expect(Object.is(toCents(-0), 0)).toBe(true);
    });
  });

  it("rejects values that cannot be stored faithfully", () => {
    expect(() => toCents(Number.NaN)).toThrow(TypeError);
    expect(() => toCents(Number.POSITIVE_INFINITY)).toThrow(TypeError);
    expect(() => toCents(Number.NEGATIVE_INFINITY)).toThrow(TypeError);
    expect(() => toCents(undefined as unknown as number)).toThrow(TypeError);
    expect(() => toCents(null as unknown as number)).toThrow(TypeError);
    expect(() => toCents(1e15)).toThrow(RangeError);
  });
});

describe("fromCents", () => {
  it("converts integer cents to dollars", () => {
    expect(fromCents(0)).toBe(0);
    expect(fromCents(1234)).toBe(12.34);
    expect(fromCents(-1234)).toBe(-12.34);
    expect(fromCents(1)).toBe(0.01);
    expect(fromCents(-1)).toBe(-0.01);
  });

  it("rejects a value that is not integer cents — the un-migrated-column signal", () => {
    expect(() => fromCents(12.34)).toThrow(/un-migrated/);
    expect(() => fromCents(-0.5)).toThrow(TypeError);
    expect(() => fromCents(Number.NaN)).toThrow(TypeError);
  });
});

describe("round trip", () => {
  it("dollars → cents → dollars is exact for values with at most two decimals", () => {
    const values = [
      0, 0.01, -0.01, 1, -1, 12.34, -12.34, 99.99, -99.99, 1000, 4321.05, -4321.05, 0.1, 0.2, 0.3,
      1234567.89, -1234567.89,
    ];
    for (const dollars of values) {
      expect(fromCents(toCents(dollars))).toBe(dollars);
    }
  });

  it("cents → dollars → cents is the identity", () => {
    for (let cents = -5000; cents <= 5000; cents += 7) {
      expect(toCents(fromCents(cents))).toBe(cents);
    }
    for (const cents of [1, -1, 999999999, -999999999, 100000000001]) {
      expect(toCents(fromCents(cents))).toBe(cents);
    }
  });

  it("summing in cents is exact where summing in dollars is not", () => {
    const dollars = Array.from({ length: 10 }, () => 0.1);
    const floatSum = dollars.reduce((a, b) => a + b, 0);
    const centSum = dollars.map(toCents).reduce((a, b) => a + b, 0);

    expect(floatSum).not.toBe(1); // 0.9999999999999999
    expect(fromCents(centSum)).toBe(1);
  });
});

describe("nullable helpers", () => {
  it("passes null and undefined through", () => {
    expect(toCentsOrNull(null)).toBeNull();
    expect(toCentsOrNull(undefined)).toBeNull();
    expect(fromCentsOrNull(null)).toBeNull();
    expect(fromCentsOrNull(undefined)).toBeNull();
  });

  it("converts a present value exactly as the non-null helpers do", () => {
    expect(toCentsOrNull(-12.34)).toBe(-1234);
    expect(fromCentsOrNull(-1234)).toBe(-12.34);
  });
});

describe("isWholeCents", () => {
  it("accepts amounts the ledger can store exactly", () => {
    for (const v of [0, 1, -1, 12.34, -12.34, 0.01, -0.01, 1000000.99]) {
      expect(isWholeCents(v)).toBe(true);
    }
  });

  it("rejects sub-cent amounts, including the half-cent boundary", () => {
    for (const v of [1.005, -1.005, 0.001, -0.001, 5.0049, 10.005]) {
      expect(isWholeCents(v)).toBe(false);
    }
  });

  it("agrees with the module's own rounding rule rather than a second one", () => {
    // Whatever toCents produces is by definition storable; the predicate must
    // never contradict it.
    for (const v of [0.07, 2.675, -2.675, 99.99]) {
      expect(isWholeCents(fromCents(toCents(v)))).toBe(true);
    }
  });
});

// Exercised against a real libsql database rather than by poking at the column
// builder's internals: what matters is that EVERY drizzle path is covered, and
// only a round trip through the driver can show that.
describe("moneyCents column type", () => {
  const ledger = sqliteTable("ledger", {
    id: text("id").primaryKey(),
    amount: moneyCents("amount").notNull(),
    balance: moneyCents("balance"), // nullable, like bank_accounts.balance_*
  });

  async function freshDb() {
    const client = createClient({ url: ":memory:" });
    await client.execute(
      "create table ledger (id text primary key, amount integer not null, balance integer)"
    );
    return { client, db: drizzle(client, { schema: { ledger } }) };
  }

  it("stores cents in the database and reads back dollars", async () => {
    const { client, db } = await freshDb();
    await db.insert(ledger).values([
      { id: "a", amount: -12.34, balance: 1000.5 },
      { id: "b", amount: 1.005, balance: null },
    ]);

    const stored = await client.execute("select id, amount, balance from ledger order by id");
    expect(stored.rows).toEqual([
      { id: "a", amount: -1234, balance: 100050 },
      { id: "b", amount: 101, balance: null },
    ]);

    expect(await db.select().from(ledger).orderBy(ledger.id)).toEqual([
      { id: "a", amount: -12.34, balance: 1000.5 },
      { id: "b", amount: 1.01, balance: null },
    ]);
  });

  it("converts update and returning paths too", async () => {
    const { client, db } = await freshDb();
    await db.insert(ledger).values({ id: "a", amount: 0 });

    await db.update(ledger).set({ amount: -5.55 }).where(eq(ledger.id, "a"));
    expect((await client.execute("select amount from ledger")).rows[0].amount).toBe(-555);

    const returned = await db
      .insert(ledger)
      .values({ id: "b", amount: 9.99 })
      .returning({ amount: ledger.amount });
    expect(returned[0].amount).toBe(9.99);
  });

  // Comparison operators bind their operand through the column's encoder, so a
  // `where` written in dollars keeps matching after the migration.
  it("encodes dollars in where-clause operands", async () => {
    const { db } = await freshDb();
    await db.insert(ledger).values([
      { id: "debit", amount: -12.34 },
      { id: "credit", amount: 40 },
      { id: "zero", amount: 0 },
    ]);

    expect(await db.select({ id: ledger.id }).from(ledger).where(eq(ledger.amount, -12.34))).toEqual(
      [{ id: "debit" }]
    );
    expect(await db.select({ id: ledger.id }).from(ledger).where(lt(ledger.amount, 0))).toEqual([
      { id: "debit" },
    ]);
    expect(await db.select({ id: ledger.id }).from(ledger).where(gt(ledger.amount, 0))).toEqual([
      { id: "credit" },
    ]);
  });

  it("leaves nulls alone in both directions", async () => {
    const { db } = await freshDb();
    await db.insert(ledger).values([
      { id: "a", amount: 1, balance: null },
      { id: "b", amount: 2 },
    ]);
    expect(await db.select({ id: ledger.id }).from(ledger).where(isNull(ledger.balance))).toEqual([
      { id: "a" },
      { id: "b" },
    ]);
  });

  // The invariant the migration exists for: SQL sums integers exactly.
  it("sums exactly in SQL where dollars would drift", async () => {
    const { client, db } = await freshDb();
    await db.insert(ledger).values(
      Array.from({ length: 10 }, (_, i) => ({ id: `r${i}`, amount: -0.1 }))
    );
    const total = (await client.execute("select sum(amount) as s from ledger")).rows[0].s;
    expect(fromCents(Number(total))).toBe(-1);
  });
});

// `db/money-columns.ts` drives the migration and the verification script, while
// `db/schema.ts` drives the running app. Nothing but these assertions stops the
// two from disagreeing — and a column listed in one but not the other is either
// data the migration silently skips or a column the app reads 100× wrong.
describe("schema and the migration's column list agree", () => {
  // `schema` also exports relations objects, so the values are widened to
  // unknown before narrowing — a predicate over the exported union cannot
  // express "one of these many table types".
  const schemaExports: unknown[] = Object.values(schema);
  const tables = schemaExports.filter((v): v is SQLiteTable => is(v, SQLiteTable));

  const moneyColumnsInSchema = tables
    .flatMap((table) =>
      Object.values(getTableColumns(table))
        .filter((c) => c.columnType === "SQLiteCustomColumn")
        .map((c) => `${getTableName(table)}.${c.name}`)
    )
    .sort();

  const moneyColumnsDeclared = MONEY_COLUMNS.flatMap(({ table, columns }) =>
    columns.map((c) => `${table}.${c}`)
  ).sort();

  it("declares exactly the listed columns with the money seam", () => {
    expect(moneyColumnsInSchema).toEqual(moneyColumnsDeclared);
  });

  it("stores every one of them as integer cents", () => {
    const sqlTypes = tables.flatMap((table) =>
      Object.values(getTableColumns(table))
        .filter((c) => c.columnType === "SQLiteCustomColumn")
        .map((c) => c.getSQLType())
    );
    expect(sqlTypes).toHaveLength(moneyColumnsDeclared.length);
    expect([...new Set(sqlTypes)]).toEqual(["integer"]);
  });

  // The two tables are written by one Plaid sync and read into one net-worth
  // series, and the snapshot table is append-only — a period where they
  // disagreed about their unit could never be recomputed.
  it("keeps bank_accounts and bank_balance_snapshots on the same unit", () => {
    const balanceColumns = (table: SQLiteTable) =>
      Object.values(getTableColumns(table))
        .filter((c) => c.name.startsWith("balance_"))
        .map((c) => `${c.name}:${c.columnType}`)
        .sort();

    expect(balanceColumns(schema.bankBalanceSnapshots)).toEqual(
      balanceColumns(schema.bankAccounts)
    );
    expect(balanceColumns(schema.bankAccounts)).toHaveLength(3);
  });
});

describe("CENTS_PER_DOLLAR", () => {
  it("is the scale both directions agree on", () => {
    expect(CENTS_PER_DOLLAR).toBe(100);
    expect(toCents(1)).toBe(CENTS_PER_DOLLAR);
    expect(fromCents(CENTS_PER_DOLLAR)).toBe(1);
  });
});
