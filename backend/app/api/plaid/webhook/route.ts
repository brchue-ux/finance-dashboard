/**
 * POST /api/plaid/webhook
 * Handles Plaid webhook events:
 * - SYNC_UPDATES_AVAILABLE → triggers background sync
 * - ITEM_LOGIN_REQUIRED   → marks connection as relink_required
 *
 * Unauthenticated by necessity — Plaid has no session here — so the
 * `Plaid-Verification` JWT is the only thing standing between this write path
 * and the open internet (the backend is reachable via `tailscale serve`).
 * Verification happens BEFORE anything is read out of the body, and the
 * `item_id` is confirmed against a real connection before anything is written,
 * so a validly signed event for an item this install has never seen is a no-op
 * rather than a silent broad UPDATE.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { bankConnections } from "@/db/schema";
import { eq } from "drizzle-orm";
import { verifyPlaidWebhook } from "@/lib/plaid-webhook";

export async function POST(req: NextRequest) {
  // The raw text, not req.json(): the signature covers these exact bytes, and
  // parse-then-re-serialize would not reproduce them.
  let rawBody: string;
  try {
    rawBody = await req.text();
  } catch {
    return NextResponse.json({ error: "Unreadable request body" }, { status: 400 });
  }

  const verification = await verifyPlaidWebhook({
    header: req.headers.get("plaid-verification"),
    rawBody,
  });
  if (!verification.ok) {
    console.warn(`[plaid/webhook] rejected: ${verification.error}`);
    // Deliberately unspecific to the caller — the reason is in the log.
    return NextResponse.json({ error: "Webhook verification failed" }, { status: 401 });
  }

  let body: { webhook_type?: unknown; webhook_code?: unknown; item_id?: unknown };
  try {
    const parsed: unknown = JSON.parse(rawBody);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return NextResponse.json({ error: "Body must be a JSON object" }, { status: 400 });
    }
    body = parsed as typeof body;
  } catch {
    return NextResponse.json({ error: "Body must be valid JSON" }, { status: 400 });
  }

  const webhookType = typeof body.webhook_type === "string" ? body.webhook_type : null;
  const webhookCode = typeof body.webhook_code === "string" ? body.webhook_code : null;
  const itemId = typeof body.item_id === "string" && body.item_id ? body.item_id : null;

  if (!webhookType || !webhookCode || !itemId) {
    return NextResponse.json(
      { error: "webhook_type, webhook_code and item_id are required" },
      { status: 400 }
    );
  }

  // A signed event still has to name an item we actually hold. Without this the
  // UPDATE below would simply match nothing — but returning ok:true for an
  // unknown item hides a misrouted webhook, and the check is one indexed read.
  const [connection] = await db
    .select({ id: bankConnections.id })
    .from(bankConnections)
    .where(eq(bankConnections.plaidItemId, itemId))
    .limit(1);

  if (!connection) {
    console.warn(`[plaid/webhook] verified event for unknown item ${itemId}`);
    return NextResponse.json({ error: "Unknown item" }, { status: 404 });
  }

  if (webhookType === "TRANSACTIONS") {
    if (webhookCode === "SYNC_UPDATES_AVAILABLE") {
      // Background sync will pick this up on next cron run / app open
      console.log(`Plaid sync available for item ${itemId}`);
    }

    if (webhookCode === "ITEM_LOGIN_REQUIRED") {
      await db
        .update(bankConnections)
        .set({ status: "relink_required" })
        .where(eq(bankConnections.id, connection.id));
    }
  }

  return NextResponse.json({ ok: true });
}
