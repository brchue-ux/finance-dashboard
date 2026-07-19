/**
 * Shared import pipeline (spec §5.7): all adapters normalize into this shape
 * before writing. Users with zero linked banks get a synthetic "manual"
 * bank_accounts row created on first import so the entire app (feed, budget
 * math, categorization) works identically regardless of data source.
 *
 * Dedup: fingerprint (date, description, amount) against already-imported
 * transactions — re-exports realistically contain the full history each time
 * and there's no stable external ID like plaid_transaction_id.
 */
import { db } from "@/db";
import { bankAccounts, transactions, budgetEnvelopes } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { categorize } from "@/lib/categorization";

export interface NormalizedRow {
  date: string; // ISO 8601 YYYY-MM-DD
  description: string;
  amount: number; // negative = debit, positive = credit (app convention)
  category?: string; // optional source-provided category; app rules win when absent
}

export interface ColumnMapping {
  date: string;
  description: string;
  amount: string;
  category?: string;
}

/**
 * Shared row normalization for every import source (CSV upload, Google Sheets,
 * Excel) — all three arrive as a `string[][]` grid with a header row, so the
 * header-mapping, date/amount parsing, and per-row error collection live here
 * once instead of in each route.
 * `headerError` is set for a whole-file problem (no header, missing mapped
 * column); `errors` collects individual unparseable rows (the rest still import).
 */
export function normalizeMappedRows(
  rows: string[][],
  mapping: ColumnMapping,
  negateAmounts?: boolean
): { normalized: NormalizedRow[]; errors: string[]; headerError?: string } {
  if (rows.length < 2) {
    return { normalized: [], errors: [], headerError: "needs a header row and at least one data row" };
  }
  const header = rows[0].map((h) => h.trim());
  const col = (name: string) => header.indexOf(name);
  const dateIdx = col(mapping.date);
  const descIdx = col(mapping.description);
  const amountIdx = col(mapping.amount);
  const categoryIdx = mapping.category ? col(mapping.category) : -1;
  if (dateIdx === -1 || descIdx === -1 || amountIdx === -1) {
    return { normalized: [], errors: [], headerError: `Mapped column not found in header: ${header.join(", ")}` };
  }

  const normalized: NormalizedRow[] = [];
  const errors: string[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const rawDate = (r[dateIdx] ?? "").trim();
    const date = new Date(rawDate);
    const amount = parseFloat((r[amountIdx] ?? "").replace(/[$,]/g, ""));
    if (Number.isNaN(date.getTime()) || Number.isNaN(amount)) {
      errors.push(`row ${i + 1}: unparseable date "${rawDate}" or amount "${r[amountIdx]}"`);
      continue;
    }
    normalized.push({
      date: date.toISOString().split("T")[0],
      description: (r[descIdx] ?? "").trim(),
      amount: negateAmounts ? -amount : amount,
      ...(categoryIdx !== -1 && r[categoryIdx]?.trim() ? { category: r[categoryIdx].trim() } : {}),
    });
  }
  return { normalized, errors };
}

const MANUAL_ACCOUNT_NAME = "Imported transactions";

export async function ensureManualAccount(userId: string): Promise<string> {
  const [existing] = await db
    .select({ id: bankAccounts.id })
    .from(bankAccounts)
    .where(and(eq(bankAccounts.userId, userId), eq(bankAccounts.type, "manual")))
    .limit(1);
  if (existing) return existing.id;

  const id = uuidv4();
  await db.insert(bankAccounts).values({
    id,
    userId,
    connectionId: null,
    plaidAccountId: null,
    name: MANUAL_ACCOUNT_NAME,
    type: "manual",
    mask: null,
    institution: "Manual import",
  });
  return id;
}

const fingerprint = (r: { date: string; description: string; amount: number }) =>
  `${r.date}|${r.description.trim()}|${r.amount.toFixed(2)}`;

export async function importRows(
  userId: string,
  rows: NormalizedRow[]
): Promise<{ imported: number; duplicates: number; accountId: string }> {
  const accountId = await ensureManualAccount(userId);
  const now = Math.floor(Date.now() / 1000);

  const existing = await db
    .select({
      date: transactions.date,
      description: transactions.description,
      amount: transactions.amount,
    })
    .from(transactions)
    .where(eq(transactions.userId, userId));
  const seen = new Set(existing.map(fingerprint));

  const envelopes = await db
    .select({
      name: budgetEnvelopes.name,
      categoryRules: budgetEnvelopes.categoryRules,
      sortOrder: budgetEnvelopes.sortOrder,
    })
    .from(budgetEnvelopes)
    .where(and(eq(budgetEnvelopes.userId, userId), eq(budgetEnvelopes.active, 1)));
  const parsedEnvelopes = envelopes.map((e) => ({
    ...e,
    categoryRules: JSON.parse(e.categoryRules) as string[],
  }));

  let imported = 0;
  let duplicates = 0;

  for (const row of rows) {
    const fp = fingerprint(row);
    if (seen.has(fp)) {
      duplicates++;
      continue;
    }
    seen.add(fp); // in-file duplicates dedup against each other too

    await db.insert(transactions).values({
      id: uuidv4(),
      userId,
      accountId,
      plaidTransactionId: null,
      date: row.date,
      description: row.description.trim(),
      merchantName: null,
      amount: row.amount,
      category: row.category ?? categorize(row.description, parsedEnvelopes),
      pending: 0,
      createdAt: now,
    });
    imported++;
  }

  return { imported, duplicates, accountId };
}
