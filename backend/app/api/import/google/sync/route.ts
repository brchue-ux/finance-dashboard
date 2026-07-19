/**
 * POST /api/import/google/sync — pull rows live from a connected Google Sheet
 * and import them (spec §5.7). Same normalize → dedup → importRows pipeline as
 * the CSV path; the only difference is the grid comes from the Sheets API rather
 * than an uploaded file. Persists the chosen file/range/mapping on the
 * connection so a future re-sync (or the nightly job) can repeat it.
 *
 * Body: {
 *   spreadsheet: string,   // full Sheets URL or bare spreadsheet ID
 *   range: string,         // A1 range or worksheet name, e.g. "Transactions!A:D"
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
import { googleClientForUser, readGoogleRange, parseSpreadsheetId } from "@/lib/import/google";

const bodySchema = z.object({
  spreadsheet: z.string().min(1),
  range: z.string().min(1),
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
  const { spreadsheet, range, mapping, negateAmounts } = parsed.data;

  const authorized = await googleClientForUser(session.user.id);
  if (!authorized) {
    return NextResponse.json({ error: "Google Sheets not connected" }, { status: 409 });
  }

  const spreadsheetId = parseSpreadsheetId(spreadsheet);

  let rows: string[][];
  try {
    rows = await readGoogleRange(authorized.client, spreadsheetId, range);
  } catch (err) {
    // A 401/403 here means the stored grant is dead — flag for re-auth
    await db
      .update(spreadsheetConnections)
      .set({ status: "reauth_required" })
      .where(eq(spreadsheetConnections.id, authorized.connection.id));
    return NextResponse.json(
      { error: `Could not read the sheet: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 }
    );
  }

  const { normalized, errors, headerError } = normalizeMappedRows(rows, mapping, negateAmounts);
  if (headerError) return NextResponse.json({ error: `Sheet ${headerError}` }, { status: 400 });

  const result = await withJobRun(
    "import_google_sheets",
    async () => {
      const res = await importRows(session.user.id, normalized);
      return {
        result: res,
        metadata: { ...res, rowsInFile: Math.max(rows.length - 1, 0), unparseableRows: errors.length },
      };
    },
    session.user.id
  );

  // Remember what was imported so this connection can be re-synced later
  await db
    .update(spreadsheetConnections)
    .set({
      externalFileId: spreadsheetId,
      worksheet: range,
      mapping: JSON.stringify(mapping),
      negateAmounts: negateAmounts ? 1 : 0,
      lastSyncedAt: Math.floor(Date.now() / 1000),
      status: "active",
    })
    .where(eq(spreadsheetConnections.id, authorized.connection.id));

  return NextResponse.json({ ok: true, ...result, unparseableRows: errors });
}
