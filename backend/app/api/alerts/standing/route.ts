/**
 * GET /api/alerts/standing — the user's standing price_alerts (the "Manage
 * alerts" view). Distinct from the fires feed: these are monitoring
 * instructions, not events.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { priceAlerts } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { nativeConditionLabel } from "@/lib/alerts/severity";

export async function GET(req: NextRequest) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const alerts = await db
    .select()
    .from(priceAlerts)
    .where(eq(priceAlerts.userId, session.user.id))
    .orderBy(desc(priceAlerts.createdAt));

  return NextResponse.json({
    alerts: alerts.map((a) => ({
      id: a.id,
      ticker: a.ticker,
      label: a.label,
      conditionLabel: nativeConditionLabel(a.conditionType, a.threshold),
      conditionType: a.conditionType,
      threshold: a.threshold,
      status: a.status,
      extendedHours: a.extendedHours === 1,
      cooldownSeconds: a.cooldownSeconds,
      lastTriggeredAt: a.lastTriggeredAt,
      triggerCount: a.triggerCount,
      expiresAt: a.expiresAt,
      createdAt: a.createdAt,
    })),
  });
}
