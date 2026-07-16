/**
 * POST /api/webhooks/tradingview
 * Receives TradingView alert webhooks.
 *
 * Auth: shared secret in request body (no auth headers available from TradingView).
 * Must return 200 within 5 seconds — write and return immediately.
 *
 * Expected payload:
 * {
 *   "secret": "{{your-shared-secret}}",
 *   "ticker": "{{ticker}}",
 *   "interval": "{{interval}}",
 *   "price": {{close}},
 *   "time": "{{time}}",
 *   "condition": "RSI Oversold"
 * }
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { tradingviewAlerts } from "@/db/schema";
import { v4 as uuidv4 } from "uuid";

// SnapTrade webhook is user-agnostic; alerts are attributed to the single user.
// When multi-user is enabled, route by a user token embedded in the secret.
const SINGLE_USER_ID_PLACEHOLDER = "DEFAULT_USER";

export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    secret?: string;
    ticker?: string;
    interval?: string;
    price?: number;
    time?: string;
    condition?: string;
  };

  const expectedSecret = process.env.TRADINGVIEW_WEBHOOK_SECRET;
  if (!expectedSecret || body.secret !== expectedSecret) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!body.ticker || !body.condition) {
    return NextResponse.json({ error: "Missing ticker or condition" }, { status: 400 });
  }

  // Write and return immediately — do not process synchronously
  await db.insert(tradingviewAlerts).values({
    id: uuidv4(),
    userId: SINGLE_USER_ID_PLACEHOLDER, // TODO: resolve real user_id on multi-user
    ticker: body.ticker,
    conditionText: body.condition,
    price: body.price ?? null,
    interval: body.interval ?? null,
    rawPayload: JSON.stringify(body),
    receivedAt: Math.floor(Date.now() / 1000),
  });

  return NextResponse.json({ ok: true });
}
