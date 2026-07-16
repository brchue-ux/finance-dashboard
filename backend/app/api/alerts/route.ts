/**
 * GET /api/alerts  — list all alerts for the authenticated user
 * PATCH /api/alerts/:id — mark alert as analyzed
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { tradingviewAlerts } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { classifySeverity } from "@/lib/alert-severity";

export async function GET(req: NextRequest) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const alerts = await db
    .select()
    .from(tradingviewAlerts)
    .where(eq(tradingviewAlerts.userId, session.user.id))
    .orderBy(desc(tradingviewAlerts.receivedAt));

  return NextResponse.json({
    alerts: alerts.map((a) => ({
      ...a,
      severity: classifySeverity(a.conditionText),
      unread: a.analyzedAt === null,
    })),
  });
}
