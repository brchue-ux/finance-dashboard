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
 *   negateAmounts?: boolean,           // set when the source uses positive-=-debit
 *   categoryMappings?: {               // user-confirmed from /preview (item 7):
 *     [sourceCategory]: envelopeName   // file category → one of their envelopes
 *   }
 * }
 */
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-guard";
import { z } from "zod";
import { parseCsv } from "@/lib/import/csv";
import { importRows, normalizeMappedRows } from "@/lib/import/pipeline";
import { csvImportSchema } from "@/lib/import/csv-request";
import { resolveCategoryAssignment } from "@/lib/budget/category-assignment";
import { loadCategorizationContext } from "@/lib/budget/categorization-context";
import { withJobRun } from "@/lib/jobs/job-runs";

const bodySchema = csvImportSchema.extend({
  categoryMappings: z.record(z.string(), z.string()).optional(),
});

export async function POST(req: NextRequest) {
  const authed = await requireUser(req);
  if ("response" in authed) return authed.response;

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const { csv, mapping, negateAmounts, categoryMappings } = parsed.data;

  const rows = parseCsv(csv);
  const { normalized, errors, headerError } = normalizeMappedRows(rows, mapping, negateAmounts);
  if (headerError) {
    return NextResponse.json({ error: `CSV ${headerError}` }, { status: 400 });
  }

  // Mapping targets are untrusted names — resolve each against the active
  // envelopes BEFORE any write, storing the envelope's own spelling and
  // normalizing keys so the file's casing can't dodge its mapping. A bad
  // target is a 400, not a partially-mapped import.
  let resolvedMappings: Record<string, string> | undefined;
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
    "import_csv",
    async () => {
      const res = await importRows(authed.userId, normalized, undefined, resolvedMappings);
      return {
        result: res,
        metadata: { ...res, rowsInFile: rows.length - 1, unparseableRows: errors.length },
      };
    },
    authed.userId
  );

  return NextResponse.json({ ok: true, ...result, unparseableRows: errors });
}
