/**
 * POST /api/webhooks/tradingview
 * Receives TradingView alert webhooks.
 *
 * Auth: per-user shared secret in the request body (no auth headers available
 * from TradingView). The secret's hash resolves the owning user via
 * webhook_credentials — no env var, no hardcoded user, multi-user from day one.
 * Must return 200 within 3 seconds — write and return immediately.
 *
 * Expected payload:
 * {
 *   "secret": "{{per-user-secret}}",
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
import { resolveWebhookUser } from "@/lib/webhook-secrets";
import { withJobRun } from "@/lib/jobs/job-runs";

export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    secret?: string;
    ticker?: string;
    interval?: string;
    price?: number;
    time?: string;
    condition?: string;
  };

  const userId = body.secret ? await resolveWebhookUser(body.secret, "tradingview") : null;
  if (!userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!body.ticker || !body.condition) {
    return NextResponse.json({ error: "Missing ticker or condition" }, { status: 400 });
  }

  // Write and return immediately — do not process synchronously
  await withJobRun(
    "tradingview_webhook",
    async () => {
      await db.insert(tradingviewAlerts).values({
        id: uuidv4(),
        userId,
        ticker: body.ticker!,
        conditionText: body.condition!,
        price: body.price ?? null,
        interval: body.interval ?? null,
        rawPayload: JSON.stringify({ ...body, secret: "[redacted]" }),
        receivedAt: Math.floor(Date.now() / 1000),
      });
      return { metadata: { ticker: body.ticker, condition: body.condition } };
    },
    userId
  );

  return NextResponse.json({ ok: true });
}
