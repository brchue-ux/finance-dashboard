/**
 * GET /api/import/excel/files — the connected OneDrive's .xlsx files, plus
 * connection status in one call: the import screen's Excel card needs both to
 * decide whether to show "Connect" or the workbook list. 200 with
 * connected:false rather than an error — an unconnected state is a normal one.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-guard";
import { excelAccessTokenForUser, excelConfigured, listExcelFiles } from "@/lib/import/excel";
import { savedExcelConfig } from "@/lib/import/spreadsheet-sync";

export async function GET(req: NextRequest) {
  const authed = await requireUser(req);
  if ("response" in authed) return authed.response;

  if (!excelConfigured()) {
    return NextResponse.json({ configured: false, connected: false, files: [] });
  }
  const authorized = await excelAccessTokenForUser(authed.userId);
  if (!authorized) {
    return NextResponse.json({ configured: true, connected: false, files: [] });
  }

  try {
    const files = await listExcelFiles(authorized.accessToken);
    // Saved-sync state rides along so the import card can offer "Sync now" and
    // the nightly toggle without a second call.
    const saved = savedExcelConfig(authorized.connection);
    return NextResponse.json({
      configured: true,
      connected: true,
      files,
      saved: saved ? { file: saved.file, worksheet: saved.worksheet } : null,
      lastSyncedAt: authorized.connection.lastSyncedAt,
      autoSync: authorized.connection.autoSync === 1,
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Could not list OneDrive files: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 }
    );
  }
}
