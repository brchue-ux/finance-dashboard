/**
 * Shared Excel sync engine — one implementation behind three callers with one
 * behavior: the sync route (explicit or saved config), the import screen's
 * "Sync now", and the nightly auto-resync. The route persisting config and the
 * nightly replaying it MUST agree on what a config is, so both go through here.
 */
import { db } from "@/db";
import { spreadsheetConnections } from "@/db/schema";
import { eq } from "drizzle-orm";
import { importRows, normalizeMappedRows, type ColumnMapping } from "@/lib/import/pipeline";
import { analyzeSourceCategories, type SourceCategoryAnalysis } from "@/lib/import/category-match";
import { loadCategorizationContext } from "@/lib/budget/categorization-context";
import { excelAccessTokenForUser, readExcelUsedRange, type ExcelConnection } from "@/lib/import/excel";

export interface ExcelSyncConfig {
  file: string;
  worksheet: string;
  mapping: ColumnMapping;
  negateAmounts?: boolean;
}

/** The saved config on a connection row, or null if none was persisted yet. */
export function savedExcelConfig(conn: ExcelConnection): ExcelSyncConfig | null {
  if (!conn.externalFileName || !conn.worksheet || !conn.mapping) return null;
  return {
    file: conn.externalFileName,
    worksheet: conn.worksheet,
    mapping: JSON.parse(conn.mapping) as ColumnMapping,
    negateAmounts: conn.negateAmounts === 1,
  };
}

/** Read + normalize the configured worksheet. Marks the connection
 *  reauth_required on a Graph failure so the UI can say why syncs stopped. */
async function readNormalized(userId: string, config: ExcelSyncConfig) {
  const authorized = await excelAccessTokenForUser(userId);
  if (!authorized) throw new SpreadsheetSyncError("not_connected", "Excel not connected");

  let rows: string[][];
  try {
    rows = await readExcelUsedRange(authorized.accessToken, config.file, config.worksheet);
  } catch (err) {
    await db
      .update(spreadsheetConnections)
      .set({ status: "reauth_required" })
      .where(eq(spreadsheetConnections.id, authorized.connection.id));
    throw new SpreadsheetSyncError(
      "read_failed",
      `Could not read the workbook: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  const { normalized, errors, headerError } = normalizeMappedRows(rows, config.mapping, config.negateAmounts);
  if (headerError) throw new SpreadsheetSyncError("bad_header", `Workbook ${headerError}`);
  return { connection: authorized.connection, rows, normalized, errors };
}

/** Item-7 parity: what the sheet's category column resolves to, before import. */
export async function previewExcelCategories(
  userId: string,
  config: ExcelSyncConfig
): Promise<SourceCategoryAnalysis & { rows: number; unparseableRows: number; envelopeNames: string[] }> {
  const { normalized, errors } = await readNormalized(userId, config);
  const { envelopes } = await loadCategorizationContext(userId);
  const analysis = analyzeSourceCategories(normalized, envelopes);
  return {
    ...analysis,
    rows: normalized.length,
    unparseableRows: errors.length,
    envelopeNames: envelopes.map((e) => e.name),
  };
}

export async function syncExcel(
  userId: string,
  config: ExcelSyncConfig,
  categoryMappings?: Record<string, string>
): Promise<{ imported: number; duplicates: number; unparseableRows: string[]; rowsInFile: number }> {
  const { connection, rows, normalized, errors } = await readNormalized(userId, config);

  const res = await importRows(userId, normalized, undefined, categoryMappings);

  // Persist the config so "Sync now" and the nightly can replay it verbatim.
  await db
    .update(spreadsheetConnections)
    .set({
      externalFileName: config.file,
      worksheet: config.worksheet,
      mapping: JSON.stringify(config.mapping),
      negateAmounts: config.negateAmounts ? 1 : 0,
      lastSyncedAt: Math.floor(Date.now() / 1000),
      status: "active",
    })
    .where(eq(spreadsheetConnections.id, connection.id));

  return { ...res, unparseableRows: errors, rowsInFile: Math.max(rows.length - 1, 0) };
}

/** Typed failure so the route can map cause → HTTP status without string-matching. */
export class SpreadsheetSyncError extends Error {
  constructor(
    public readonly kind: "not_connected" | "read_failed" | "bad_header",
    message: string
  ) {
    super(message);
  }
}
