/**
 * POST /api/plaid/exchange
 * Exchanges a Plaid public_token for an access_token and stores it encrypted.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { plaidClient } from "@/lib/plaid";
import { db } from "@/db";
import { bankConnections } from "@/db/schema";
import { encrypt } from "@/lib/crypto";
import { v4 as uuidv4 } from "uuid";

export async function POST(req: NextRequest) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { public_token, institution_name } = (await req.json()) as {
    public_token: string;
    institution_name: string;
  };

  const exchangeRes = await plaidClient.itemPublicTokenExchange({ public_token });
  const { access_token, item_id } = exchangeRes.data;

  await db.insert(bankConnections).values({
    id: uuidv4(),
    userId: session.user.id,
    institutionName: institution_name,
    plaidItemId: item_id,
    plaidAccessToken: encrypt(access_token),
    status: "active",
    createdAt: Math.floor(Date.now() / 1000),
  });

  return NextResponse.json({ ok: true });
}
