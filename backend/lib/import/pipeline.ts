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
import { bankAccounts, transactions } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { categorize } from "@/lib/categorization";
import { loadCategorizationContext } from "@/lib/budget/categorization-context";
import { matchesTransferPattern } from "@/lib/budget/transfers";
import { resolveImportCategory } from "@/lib/import/category-match";

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
// Excel date-typed cells reach the grid as serial-number strings via the Graph
// values API ("46203" or "46203.8333..." with a time fraction), not display
// text. new Date("46203") would invent year-46203 dates, so convert serials in
// the plausible transaction range (~1954–2119) explicitly. 25569 = the serial
// of 1970-01-01; the time fraction is dropped (transactions are day-grained).
const EXCEL_EPOCH_OFFSET_DAYS = 25569;
function parseGridDate(raw: string): Date {
  if (/^\d{5}(\.\d+)?$/.test(raw)) {
    const serial = parseFloat(raw);
    if (serial >= 20000 && serial < 80000) {
      return new Date((Math.floor(serial) - EXCEL_EPOCH_OFFSET_DAYS) * 86400000);
    }
  }
  return new Date(raw);
}

// Accounting-style exports write negatives as "(45.67)"; banks also emit
// "$1,234.56". Strip currency furniture, honor the parentheses.
function parseGridAmount(raw: string): number {
  const parens = raw.match(/^\((.+)\)$/);
  const inner = (parens ? parens[1] : raw).replace(/[$,]/g, "");
  const value = parseFloat(inner);
  return parens ? -value : value;
}

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
    const rawDesc = (r[descIdx] ?? "").trim();
    const rawAmount = (r[amountIdx] ?? "").trim();
    // Spacer rows are sheet structure, not data errors — skip silently. A row
    // with ANY of the three essentials filled still falls through to error
    // reporting (e.g. a "Total" row has description+amount but no date).
    if (!rawDate && !rawDesc && !rawAmount) continue;
    const date = parseGridDate(rawDate);
    const amount = parseGridAmount(rawAmount);
    if (Number.isNaN(date.getTime()) || Number.isNaN(amount)) {
      // Include the description so the user can find the row in their sheet.
      errors.push(
        `row ${i + 1}${rawDesc ? ` ("${rawDesc}")` : ""}: unparseable date "${rawDate}" or amount "${r[amountIdx]}"`
      );
      continue;
    }
    normalized.push({
      date: date.toISOString().split("T")[0],
      description: rawDesc,
      amount: negateAmounts ? -amount : amount,
      ...(categoryIdx !== -1 && r[categoryIdx]?.trim() ? { category: r[categoryIdx].trim() } : {}),
    });
  }
  return { normalized, errors };
}

const MANUAL_ACCOUNT_NAME = "Imported transactions";

/**
 * Find or create the account an import lands in.
 *
 * `name` matters more than it looks. Without it every CSV ever imported shares
 * one bucket, so a chequing export and a credit-card export become the same
 * "account" — which makes a payment from one to the other look like it never
 * left anywhere. Transfers only make sense between distinguishable accounts,
 * and the Banks screen shows one blob otherwise. Existing callers keep the
 * original single-bucket behaviour by passing nothing.
 */
export async function ensureManualAccount(
  userId: string,
  name: string = MANUAL_ACCOUNT_NAME
): Promise<string> {
  const [existing] = await db
    .select({ id: bankAccounts.id })
    .from(bankAccounts)
    .where(
      and(
        eq(bankAccounts.userId, userId),
        eq(bankAccounts.type, "manual"),
        eq(bankAccounts.name, name)
      )
    )
    .limit(1);
  if (existing) return existing.id;

  const id = uuidv4();
  await db.insert(bankAccounts).values({
    id,
    userId,
    connectionId: null,
    plaidAccountId: null,
    name,
    type: "manual",
    mask: null,
    institution: "Manual import",
  });
  return id;
}

/**
 * Identity of a transaction for duplicate detection.
 *
 * Note what this deliberately CANNOT distinguish: two genuinely separate
 * transactions with the same date, description and amount. Banks provide no
 * per-row id in a CSV export, so they are indistinguishable by content. They
 * are common in real data — three $50 transfers to the same place on one day —
 * which is why callers must compare COUNTS rather than mere presence.
 */
const fingerprint = (r: { date: string; description: string; amount: number }) =>
  `${r.date}|${r.description.trim()}|${r.amount.toFixed(2)}`;

/**
 * Build the duplicate test for one import run, given what is already stored.
 *
 * Counts, not presence. Presence-only dedup silently destroyed real data: on a
 * real chequing export it dropped 74 rows worth $7,294, because three separate
 * $50 transfers on one day are byte-identical to one transfer imported three
 * times. Counting keeps re-importing the same file idempotent — the file must
 * contain MORE copies than the database already holds for a row to be new.
 *
 * Stateful across calls within a run by design: each call consumes one copy.
 * Pure and exported so this can be tested without a database, since the bug it
 * fixes is invisible in aggregate row counts.
 */
export function duplicateFilter(existingFingerprints: string[]): (fp: string) => boolean {
  const remaining = new Map<string, number>();
  for (const fp of existingFingerprints) remaining.set(fp, (remaining.get(fp) ?? 0) + 1);

  return (fp: string) => {
    const left = remaining.get(fp) ?? 0;
    if (left === 0) return false;
    remaining.set(fp, left - 1);
    return true;
  };
}

/**
 * @param categoryMappings user-confirmed source-category → envelope mappings
 *        from the import preview (item 7), keys normalized (trim+lowercase),
 *        values already resolved to the envelope's own spelling by the route.
 *        Mapped rows get `category_source = "manual"` — the mapping is the
 *        user's explicit choice and must survive a bulk re-derive.
 */
export async function importRows(
  userId: string,
  rows: NormalizedRow[],
  accountName?: string,
  categoryMappings?: Record<string, string>
): Promise<{ imported: number; duplicates: number; accountId: string }> {
  const accountId = await ensureManualAccount(userId, accountName);
  const now = Math.floor(Date.now() / 1000);

  const existing = await db
    .select({
      date: transactions.date,
      description: transactions.description,
      amount: transactions.amount,
    })
    .from(transactions)
    .where(eq(transactions.userId, userId));
  const isDuplicate = duplicateFilter(existing.map(fingerprint));

  const { envelopes: parsedEnvelopes, learnedRules, transferPatterns } =
    await loadCategorizationContext(userId);

  let imported = 0;
  let duplicates = 0;

  for (const row of rows) {
    if (isDuplicate(fingerprint(row))) {
      duplicates++;
      continue;
    }

    // A source-provided category goes through the resolver so a match modulo
    // case/whitespace is stored under the envelope's own spelling — verbatim
    // storage fragments an envelope's totals ("groceries" ≠ "Groceries" to
    // every budget query). Applies to all import paths, not just CSV.
    let category: string;
    let categorySource: string | null = null;
    if (row.category) {
      const resolved = resolveImportCategory(row.category, parsedEnvelopes, categoryMappings);
      category = resolved.category;
      if (resolved.mapped) categorySource = "manual";
    } else {
      category = categorize(row.description, parsedEnvelopes, learnedRules);
    }

    await db.insert(transactions).values({
      id: uuidv4(),
      userId,
      accountId,
      plaidTransactionId: null,
      date: row.date,
      description: row.description.trim(),
      merchantName: null,
      amount: row.amount,
      category,
      categorySource,
      // The user's approved transfer patterns mark at write time — a matching
      // row is money moving between their own accounts, not income/spending.
      transferSource: matchesTransferPattern(row.description, transferPatterns) ? "rule" : null,
      pending: 0,
      createdAt: now,
    });
    imported++;
  }

  return { imported, duplicates, accountId };
}
