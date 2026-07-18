/**
 * PATCH /api/alerts/:id/read — mark a unified-feed item read. Routes to the
 * correct table by the item's source (alert_fires.read_at vs
 * tradingview_alerts.read_at — analyzed_at is a different fact).
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { alertFires, tradingviewAlerts } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

const bodySchema = z.object({ source: z.enum(["native", "tradingview"]) });

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const now = Math.floor(Date.now() / 1000);

  const result =
    parsed.data.source === "native"
      ? await db
          .update(alertFires)
          .set({ readAt: now })
          .where(and(eq(alertFires.id, id), eq(alertFires.userId, session.user.id)))
      : await db
          .update(tradingviewAlerts)
          .set({ readAt: now })
          .where(and(eq(tradingviewAlerts.id, id), eq(tradingviewAlerts.userId, session.user.id)));

  if (result.rowsAffected === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
