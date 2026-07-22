/**
 * POST /api/import/csv/preview — item 7's "warn before committing".
 *
 * Same body as /api/import/csv, zero writes: parses the file the exact way
 * the commit will and reports which of its categories resolve to an active
 * envelope and which don't (with row counts and a best-effort suggestion
 * each), plus the user's envelope names so the client can offer a picker
 * without a second fetch. The client then re-submits to /api/import/csv with
 * whatever `categoryMappings` the user confirmed.
 *
 * Row counts are pre-dedup: rows that turn out to be duplicates are skipped
 * at commit regardless of category, so a re-import can overstate "rows that
 * won't count" — acceptable for an advisory number, not worth loading every
 * stored fingerprint here.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-guard";
import { parseCsv } from "@/lib/import/csv";
import { normalizeMappedRows } from "@/lib/import/pipeline";
import { analyzeSourceCategories } from "@/lib/import/category-match";
import { loadCategorizationContext } from "@/lib/budget/categorization-context";
import { csvImportSchema } from "@/lib/import/csv-request";

export async function POST(req: NextRequest) {
  const authed = await requireUser(req);
  if ("response" in authed) return authed.response;

  const parsed = csvImportSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const { csv, mapping, negateAmounts } = parsed.data;

  const rows = parseCsv(csv);
  const { normalized, errors, headerError } = normalizeMappedRows(rows, mapping, negateAmounts);
  if (headerError) {
    return NextResponse.json({ error: `CSV ${headerError}` }, { status: 400 });
  }

  const { envelopes } = await loadCategorizationContext(authed.userId);
  const { matched, unmatched } = analyzeSourceCategories(normalized, envelopes);

  return NextResponse.json({
    ok: true,
    rows: normalized.length,
    unparseableRows: errors.length,
    matched,
    unmatched,
    envelopeNames: envelopes.map((e) => e.name),
  });
}
