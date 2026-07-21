/**
 * GET  /api/alerts — unified alerts feed: alert_fires (native) + tradingview_alerts
 *                    (webhook log), normalized into one shape (spec §5.6).
 * POST /api/alerts — create a standing price alert. Arbitrary symbols allowed,
 *                    not just holdings (index alerts like ^GSPC are first-class).
 */
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-guard";
import { db } from "@/db";
import { alertFires, priceAlerts, tradingviewAlerts } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import { classifySeverity } from "@/lib/alert-severity";
import { nativeConditionLabel, nativeSeverity } from "@/lib/alerts/severity";

export interface UnifiedAlert {
  id: string;
  source: "native" | "tradingview";
  ticker: string;
  conditionLabel: string;
  price: number | null;
  timestamp: number; // fired_at / received_at, Unix seconds
  severity: "red" | "yellow" | "green";
  unread: boolean;
  analyzedAt: number | null; // TradingView only; null for native fires
  alertId: string | null; // standing price_alerts id; null for TradingView
}

const FEED_LIMIT = 100;

export async function GET(req: NextRequest) {
  const authed = await requireUser(req);
  if ("response" in authed) return authed.response;

  const [fires, tvAlerts] = await Promise.all([
    db
      .select()
      .from(alertFires)
      .where(eq(alertFires.userId, authed.userId))
      .orderBy(desc(alertFires.firedAt))
      .limit(FEED_LIMIT),
    db
      .select()
      .from(tradingviewAlerts)
      .where(eq(tradingviewAlerts.userId, authed.userId))
      .orderBy(desc(tradingviewAlerts.receivedAt))
      .limit(FEED_LIMIT),
  ]);

  const unified: UnifiedAlert[] = [
    ...fires.map((f): UnifiedAlert => ({
      id: f.id,
      source: "native",
      ticker: f.ticker,
      conditionLabel: nativeConditionLabel(f.conditionType, f.threshold),
      price: f.triggerPrice,
      timestamp: f.firedAt,
      severity: nativeSeverity(f.conditionType),
      unread: f.readAt === null,
      analyzedAt: null,
      alertId: f.alertId,
    })),
    ...tvAlerts.map((a): UnifiedAlert => ({
      id: a.id,
      source: "tradingview",
      ticker: a.ticker,
      conditionLabel: a.conditionText,
      price: a.price,
      timestamp: a.receivedAt,
      severity: classifySeverity(a.conditionText),
      unread: a.readAt === null,
      analyzedAt: a.analyzedAt,
      alertId: null,
    })),
  ]
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, FEED_LIMIT);

  return NextResponse.json({ alerts: unified });
}

const createAlertSchema = z.object({
  ticker: z.string().min(1).max(12).transform((t) => t.toUpperCase()),
  conditionType: z.enum(["price_above", "price_below", "pct_change_up", "pct_change_down"]),
  threshold: z.number().positive(), // dollar price OR decimal pct (0.03 = 3%)
  label: z.string().max(80).optional(),
  holdingId: z.string().optional(),
  extendedHours: z.boolean().optional(),
  cooldownSeconds: z.number().int().positive().optional(), // omitted = one-time fire
  expiresAt: z.number().int().positive().optional(),
});

export async function POST(req: NextRequest) {
  const authed = await requireUser(req);
  if ("response" in authed) return authed.response;

  const parsed = createAlertSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const body = parsed.data;
  const now = Math.floor(Date.now() / 1000);
  const id = uuidv4();

  await db.insert(priceAlerts).values({
    id,
    userId: authed.userId,
    ticker: body.ticker,
    holdingId: body.holdingId ?? null,
    label: body.label ?? null,
    conditionType: body.conditionType,
    threshold: body.threshold,
    extendedHours: body.extendedHours ? 1 : 0,
    status: "active",
    cooldownSeconds: body.cooldownSeconds ?? null,
    source: "native",
    notificationChannels: '["in_app"]',
    createdAt: now,
    updatedAt: now,
    expiresAt: body.expiresAt ?? null,
  });

  return NextResponse.json({ id }, { status: 201 });
}
