/**
 * POST /api/snaptrade/connect
 * Creates a SnapTrade user (if needed) and returns the OAuth connection URL.
 *
 * GET /api/snaptrade/connect
 * Returns current connection status.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { wealthsimpleConnections } from "@/db/schema";
import { eq } from "drizzle-orm";
import { snaptrade } from "@/lib/snaptrade";
import { encrypt } from "@/lib/crypto";
import { v4 as uuidv4 } from "uuid";

export async function GET(req: NextRequest) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const conn = await db
    .select({ status: wealthsimpleConnections.status, lastSyncedAt: wealthsimpleConnections.lastSyncedAt })
    .from(wealthsimpleConnections)
    .where(eq(wealthsimpleConnections.userId, session.user.id))
    .limit(1);

  return NextResponse.json({ connection: conn[0] ?? null });
}

export async function POST(req: NextRequest) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = session.user.id;

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
    snaptradeUserSecret = existing[0].snaptradeAuthToken; // encrypted — decrypt before use
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

  // Generate connection link
  const loginRes = await snaptrade.authentication.loginSnapTradeUser({
    userId: snaptradeUserId,
    userSecret: snaptradeUserSecret,
  });

  return NextResponse.json({ redirectUri: loginRes.data.redirectURI });
}
