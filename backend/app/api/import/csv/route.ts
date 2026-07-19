/**
 * POST /api/import/csv — the CSV import path (spec §5.7). Zero-OAuth: works
 * identically for Google Sheets and Excel exports.
 *
 * Body: {
 *   csv: string,                       // raw file contents, header row required
 *   mapping: {                         // header names in the user's file
 *     date: string,                    // column with ISO or YYYY-MM-DD-parseable dates
 *     description: string,
 *     amount: string,                  // negative = debit (app convention)
 *     category?: string
 *   },
 *   negateAmounts?: boolean            // set when the source uses positive-=-debit
 * }
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { z } from "zod";
import { parseCsv } from "@/lib/import/csv";
import { importRows, normalizeMappedRows } from "@/lib/import/pipeline";
import { withJobRun } from "@/lib/jobs/job-runs";

const bodySchema = z.object({
  csv: z.string().min(1),
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
  const { csv, mapping, negateAmounts } = parsed.data;

  const rows = parseCsv(csv);
  const { normalized, errors, headerError } = normalizeMappedRows(rows, mapping, negateAmounts);
  if (headerError) {
    return NextResponse.json({ error: `CSV ${headerError}` }, { status: 400 });
  }

  const result = await withJobRun(
    "import_csv",
    async () => {
      const res = await importRows(session.user.id, normalized);
      return {
        result: res,
        metadata: { ...res, rowsInFile: rows.length - 1, unparseableRows: errors.length },
      };
    },
    session.user.id
  );

  return NextResponse.json({ ok: true, ...result, unparseableRows: errors });
}
