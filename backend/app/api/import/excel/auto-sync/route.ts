/**
 * PATCH /api/import/excel/auto-sync — opt in/out of the nightly re-sync.
 * Propose-don't-impose: nothing auto-imports until the user flips this, and it
 * requires a saved config (there is nothing to replay without one).
 */
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-guard";
import { db } from "@/db";
import { spreadsheetConnections } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { savedExcelConfig } from "@/lib/import/spreadsheet-sync";

const bodySchema = z.object({ enabled: z.boolean() });

export async function PATCH(req: NextRequest) {
  const authed = await requireUser(req);
  if ("response" in authed) return authed.response;

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const [conn] = await db
    .select()
    .from(spreadsheetConnections)
    .where(
      and(eq(spreadsheetConnections.userId, authed.userId), eq(spreadsheetConnections.provider, "excel"))
    )
    .limit(1);
  if (!conn) return NextResponse.json({ error: "Excel not connected" }, { status: 409 });
  if (parsed.data.enabled && !savedExcelConfig(conn)) {
    return NextResponse.json(
      { error: "Sync a workbook once first — nightly re-sync replays that configuration" },
      { status: 409 }
    );
  }

  await db
    .update(spreadsheetConnections)
    .set({ autoSync: parsed.data.enabled ? 1 : 0 })
    .where(eq(spreadsheetConnections.id, conn.id));

  return NextResponse.json({ ok: true, autoSync: parsed.data.enabled });
}
