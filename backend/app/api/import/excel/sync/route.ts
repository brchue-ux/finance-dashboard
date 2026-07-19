/**
 * POST /api/import/excel/sync — pull rows live from a connected OneDrive Excel
 * workbook and import them (spec §5.7). Same normalize → dedup → importRows
 * pipeline as CSV/Sheets; the grid comes from Graph's worksheet usedRange.
 *
 * Body: {
 *   file: string,          // path under the drive root, e.g. "Documents/budget.xlsx"
 *   worksheet: string,     // worksheet (tab) name
 *   mapping: { date, description, amount, category? },  // header names in the sheet
 *   negateAmounts?: boolean
 * }
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { spreadsheetConnections } from "@/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { importRows, normalizeMappedRows } from "@/lib/import/pipeline";
import { withJobRun } from "@/lib/jobs/job-runs";
import { excelAccessTokenForUser, readExcelUsedRange } from "@/lib/import/excel";

const bodySchema = z.object({
  file: z.string().min(1),
  worksheet: z.string().min(1),
  mapping: z.object({
    date: z.string().min(1),
    description: z.string().min(1),
    amount: z.string().min(1),
    category: z.string().optional(),
  }),
  negateAmounts: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const { file, worksheet, mapping, negateAmounts } = parsed.data;

  const authorized = await excelAccessTokenForUser(session.user.id);
  if (!authorized) {
    return NextResponse.json({ error: "Excel not connected" }, { status: 409 });
  }

  let rows: string[][];
  try {
    rows = await readExcelUsedRange(authorized.accessToken, file, worksheet);
  } catch (err) {
    await db
      .update(spreadsheetConnections)
      .set({ status: "reauth_required" })
      .where(eq(spreadsheetConnections.id, authorized.connection.id));
    return NextResponse.json(
      { error: `Could not read the workbook: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 }
    );
  }

  const { normalized, errors, headerError } = normalizeMappedRows(rows, mapping, negateAmounts);
  if (headerError) return NextResponse.json({ error: `Workbook ${headerError}` }, { status: 400 });

  const result = await withJobRun(
    "import_excel",
    async () => {
      const res = await importRows(session.user.id, normalized);
      return {
        result: res,
        metadata: { ...res, rowsInFile: Math.max(rows.length - 1, 0), unparseableRows: errors.length },
      };
    },
    session.user.id
  );

  await db
    .update(spreadsheetConnections)
    .set({
      externalFileName: file,
      worksheet,
      mapping: JSON.stringify(mapping),
      negateAmounts: negateAmounts ? 1 : 0,
      lastSyncedAt: Math.floor(Date.now() / 1000),
      status: "active",
    })
    .where(eq(spreadsheetConnections.id, authorized.connection.id));

  return NextResponse.json({ ok: true, ...result, unparseableRows: errors });
}
