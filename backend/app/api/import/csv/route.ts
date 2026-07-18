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
import { importRows, type NormalizedRow } from "@/lib/import/pipeline";
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
  if (rows.length < 2) {
    return NextResponse.json({ error: "CSV needs a header row and at least one data row" }, { status: 400 });
  }

  const header = rows[0].map((h) => h.trim());
  const col = (name: string) => header.indexOf(name);
  const dateIdx = col(mapping.date);
  const descIdx = col(mapping.description);
  const amountIdx = col(mapping.amount);
  const categoryIdx = mapping.category ? col(mapping.category) : -1;
  if (dateIdx === -1 || descIdx === -1 || amountIdx === -1) {
    return NextResponse.json(
      { error: `Mapped column not found in header: ${header.join(", ")}` },
      { status: 400 }
    );
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
      ...(categoryIdx !== -1 && r[categoryIdx]?.trim()
        ? { category: r[categoryIdx].trim() }
        : {}),
    });
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
