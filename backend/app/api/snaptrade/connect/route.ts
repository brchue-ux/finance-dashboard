/**
 * POST /api/snaptrade/connect
 * Creates a SnapTrade user (if needed) and returns the OAuth connection URL.
 *
 * GET /api/snaptrade/connect
 * Returns current connection status.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-guard";
import { db } from "@/db";
import { wealthsimpleConnections } from "@/db/schema";
import { eq } from "drizzle-orm";
import { snaptrade } from "@/lib/snaptrade";
import { encrypt, decrypt } from "@/lib/crypto";
import { v4 as uuidv4 } from "uuid";

export async function GET(req: NextRequest) {
  const authed = await requireUser(req);
  if ("response" in authed) return authed.response;

  const conn = await db
    .select({ status: wealthsimpleConnections.status, lastSyncedAt: wealthsimpleConnections.lastSyncedAt })
    .from(wealthsimpleConnections)
    .where(eq(wealthsimpleConnections.userId, authed.userId))
    .limit(1);

  return NextResponse.json({ connection: conn[0] ?? null });
}

export async function POST(req: NextRequest) {
  const authed = await requireUser(req);
  if ("response" in authed) return authed.response;

  const userId = authed.userId;

  // Check for existing connection
  const existing = await db
    .select()
    .from(wealthsimpleConnections)
    .where(eq(wealthsimpleConnections.userId, userId))
    .limit(1);

  let snaptradeUserId: string;
  let snaptradeUserSecret: string;

  if (existing.length > 0) {
    snaptradeUserId = existing[0].snaptradeUserId;
    snaptradeUserSecret = decrypt(existing[0].snaptradeAuthToken);
  } else {
    // Register new SnapTrade user
    const registerRes = await snaptrade.authentication.registerSnapTradeUser({
      userId,
    });
    snaptradeUserId = registerRes.data.userId!;
    snaptradeUserSecret = registerRes.data.userSecret!;

    await db.insert(wealthsimpleConnections).values({
      id: uuidv4(),
      userId,
      snaptradeUserId,
      snaptradeAuthToken: encrypt(snaptradeUserSecret),
      status: "active",
      createdAt: Math.floor(Date.now() / 1000),
    });
  }

  // Generate connection link. customRedirect points the hosted portal back
  // into the app after the Wealthsimple OAuth finishes (spec §5.2) — without
  // it the user lands stranded on a SnapTrade default page. Same platform
  // split as Plaid Hosted Link.
  const body = (await req.json().catch(() => ({}))) as { platform?: "native" | "web" };
  const loginRes = await snaptrade.authentication.loginSnapTradeUser({
    userId: snaptradeUserId,
    userSecret: snaptradeUserSecret,
    ...(body.platform === "native"
      ? { customRedirect: "finance-dashboard://snaptrade-complete" }
      : {}),
  });

  const data = loginRes.data as { redirectURI?: string };
  return NextResponse.json({ redirectUri: data.redirectURI });
}
