/**
 * POST /api/settings/webhook-secret — generate (or rotate) the user's
 * TradingView webhook secret. Returns the plaintext exactly once; only the
 * hash is stored. Rotating invalidates the previous secret immediately.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { issueWebhookSecret } from "@/lib/webhook-secrets";

export async function POST(req: NextRequest) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const secret = await issueWebhookSecret(session.user.id, "tradingview");
  return NextResponse.json({ secret });
}
