/**
 * POST /api/settings/webhook-secret — generate (or rotate) the user's
 * TradingView webhook secret. Returns the plaintext exactly once; only the
 * hash is stored. Rotating invalidates the previous secret immediately.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-guard";
import { issueWebhookSecret } from "@/lib/webhook-secrets";

export async function POST(req: NextRequest) {
  const authed = await requireUser(req);
  if ("response" in authed) return authed.response;

  const secret = await issueWebhookSecret(authed.userId, "tradingview");
  return NextResponse.json({ secret });
}
