/**
 * POST /api/import/excel/sync — pull rows live from a connected OneDrive Excel
 * workbook and import them (spec §5.7). Same normalize → dedup → importRows
 * pipeline as CSV/Sheets; the grid comes from Graph's worksheet usedRange.
 *
 * Body — either an explicit config or the saved one:
 *   { file, worksheet, mapping: {date,description,amount,category?}, negateAmounts? }
 *   { useSaved: true }        // replay the config persisted by the last sync
 * plus, when the sheet has a category column (item-7 parity with CSV):
 *   { previewOnly: true }     // report matched/unmatched categories, import nothing
 *   { categoryMappings: { [sourceCategory]: envelopeName } }  // user-confirmed
 */
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-guard";
import { db } from "@/db";
import { spreadsheetConnections } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withJobRun } from "@/lib/jobs/job-runs";
import { resolveCategoryAssignment } from "@/lib/budget/category-assignment";
import { loadCategorizationContext } from "@/lib/budget/categorization-context";
import {
  syncExcel,
  previewExcelCategories,
  savedExcelConfig,
  SpreadsheetSyncError,
  type ExcelSyncConfig,
} from "@/lib/import/spreadsheet-sync";

const bodySchema = z.union([
  z.object({
    file: z.string().min(1),
    worksheet: z.string().min(1),
    mapping: z.object({
      date: z.string().min(1),
      description: z.string().min(1),
      amount: z.string().min(1),
      category: z.string().optional(),
    }),
    negateAmounts: z.boolean().optional(),
    previewOnly: z.boolean().optional(),
    categoryMappings: z.record(z.string(), z.string()).optional(),
  }),
  z.object({
    useSaved: z.literal(true),
    previewOnly: z.boolean().optional(),
    categoryMappings: z.record(z.string(), z.string()).optional(),
  }),
]);

function errorStatus(kind: SpreadsheetSyncError["kind"]): number {
  return kind === "not_connected" ? 409 : kind === "bad_header" ? 400 : 502;
}

export async function POST(req: NextRequest) {
  const authed = await requireUser(req);
  if ("response" in authed) return authed.response;

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  let config: ExcelSyncConfig;
  if ("useSaved" in parsed.data) {
    const [conn] = await db
      .select()
      .from(spreadsheetConnections)
      .where(
        and(
          eq(spreadsheetConnections.userId, authed.userId),
          eq(spreadsheetConnections.provider, "excel")
        )
      )
      .limit(1);
    const saved = conn ? savedExcelConfig(conn) : null;
    if (!saved) {
      return NextResponse.json(
        { error: "No saved sync configuration — pick a workbook first" },
        { status: 409 }
      );
    }
    config = saved;
  } else {
    config = parsed.data;
  }

  try {
    if (parsed.data.previewOnly) {
      return NextResponse.json({ ok: true, ...(await previewExcelCategories(authed.userId, config)) });
    }

    // Mapping targets are untrusted names — resolve each against the active
    // envelopes BEFORE any write (same contract as the CSV commit).
    let resolvedMappings: Record<string, string> | undefined;
    const categoryMappings = parsed.data.categoryMappings;
    if (categoryMappings && Object.keys(categoryMappings).length > 0) {
      const { envelopes } = await loadCategorizationContext(authed.userId);
      resolvedMappings = {};
      for (const [source, target] of Object.entries(categoryMappings)) {
        const resolved = resolveCategoryAssignment(target, envelopes);
        if (!resolved.ok) {
          return NextResponse.json(
            { error: `mapping for "${source}": ${resolved.error}` },
            { status: 400 }
          );
        }
        resolvedMappings[source.trim().toLowerCase()] = resolved.category;
      }
    }

    const result = await withJobRun(
      "import_excel",
      async () => {
        const res = await syncExcel(authed.userId, config, resolvedMappings);
        return {
          result: res,
          metadata: {
            imported: res.imported,
            duplicates: res.duplicates,
            rowsInFile: res.rowsInFile,
            unparseableRows: res.unparseableRows.length,
          },
        };
      },
      authed.userId
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof SpreadsheetSyncError) {
      return NextResponse.json({ error: err.message }, { status: errorStatus(err.kind) });
    }
    throw err;
  }
}
