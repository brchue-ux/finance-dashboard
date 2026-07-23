/**
 * GET /api/import/excel/workbook?file=<path>[&worksheet=<name>] — workbook
 * structure for the import screen: the worksheet (tab) names, and, once a
 * worksheet is chosen, its header row so the user can map columns without a
 * failed sync round-trip. One endpoint because the screen always wants them in
 * that order, and the second call reuses the same validated file path.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-guard";
import {
  excelAccessTokenForUser,
  listExcelWorksheets,
  readExcelUsedRange,
} from "@/lib/import/excel";

export async function GET(req: NextRequest) {
  const authed = await requireUser(req);
  if ("response" in authed) return authed.response;

  const { searchParams } = new URL(req.url);
  const file = searchParams.get("file");
  const worksheet = searchParams.get("worksheet");
  if (!file) return NextResponse.json({ error: "file required" }, { status: 400 });

  const authorized = await excelAccessTokenForUser(authed.userId);
  if (!authorized) return NextResponse.json({ error: "Excel not connected" }, { status: 409 });

  try {
    const worksheets = await listExcelWorksheets(authorized.accessToken, file);
    if (!worksheet) return NextResponse.json({ worksheets });

    // Header row for mapping. The used range is the whole sheet, but personal
    // budget workbooks are small; one fetch beats a bespoke range endpoint.
    const grid = await readExcelUsedRange(authorized.accessToken, file, worksheet);
    const headers = (grid[0] ?? []).map((h) => h.trim()).filter((h) => h !== "");
    return NextResponse.json({ worksheets, headers });
  } catch (err) {
    return NextResponse.json(
      { error: `Could not read the workbook: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 }
    );
  }
}
