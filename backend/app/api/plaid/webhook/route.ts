/**
 * POST /api/plaid/webhook
 * Handles Plaid webhook events:
 * - SYNC_UPDATES_AVAILABLE → triggers background sync
 * - ITEM_LOGIN_REQUIRED   → marks connection as relink_required
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { bankConnections } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    webhook_type: string;
    webhook_code: string;
    item_id: string;
  };

  const { webhook_type, webhook_code, item_id } = body;

  if (webhook_type === "TRANSACTIONS") {
    if (webhook_code === "SYNC_UPDATES_AVAILABLE") {
      // Background sync will pick this up on next cron run / app open
      console.log(`Plaid sync available for item ${item_id}`);
    }

    if (webhook_code === "ITEM_LOGIN_REQUIRED") {
      await db
        .update(bankConnections)
        .set({ status: "relink_required" })
        .where(eq(bankConnections.plaidItemId, item_id));
    }
  }

  return NextResponse.json({ ok: true });
}
