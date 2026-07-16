/**
 * POST /api/snaptrade/sync
 * Syncs Wealthsimple portfolio via SnapTrade.
 * Appends a new portfolio_snapshots row + holdings rows. Never overwrites.
 * Respects 2-minute debounce.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import {
  wealthsimpleConnections,
  portfolioSnapshots,
  holdings,
  portfolioTransactions,
} from "@/db/schema";
import { eq } from "drizzle-orm";
import { decrypt } from "@/lib/crypto";
import { snaptrade } from "@/lib/snaptrade";
import { v4 as uuidv4 } from "uuid";

const DEBOUNCE_SECONDS = 120;

export async function POST(req: NextRequest) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = session.user.id;
  const now = Math.floor(Date.now() / 1000);

  const [conn] = await db
    .select()
    .from(wealthsimpleConnections)
    .where(eq(wealthsimpleConnections.userId, userId))
    .limit(1);

  if (!conn) return NextResponse.json({ error: "No Wealthsimple connection" }, { status: 404 });

  if (conn.lastSyncedAt && now - conn.lastSyncedAt < DEBOUNCE_SECONDS) {
    return NextResponse.json({ ok: true, skipped: true, reason: "debounce" });
  }

  const userSecret = decrypt(conn.snaptradeAuthToken);

  try {
    const accountsRes = await snaptrade.accountInformation.listUserAccounts({
      userId: conn.snaptradeUserId,
      userSecret,
    });
    const accounts = accountsRes.data ?? [];

    let totalValue = 0;
    let cashValue = 0;
    const accountBreakdown: Record<string, number> = {
      tfsa: 0, rrsp: 0, non_reg: 0, crypto: 0,
    };
    const allHoldings: Array<{
      ticker: string; name: string; quantity: number;
      costBasis: number; marketValue: number; accountType: string;
    }> = [];

    for (const account of accounts) {
      const holdingsRes = await snaptrade.accountInformation.getUserHoldings({
        accountId: account.id!,
        userId: conn.snaptradeUserId,
        userSecret,
      });

      const accountType = inferAccountType(account.name ?? "");
      const positions = holdingsRes.data?.positions ?? [];

      for (const pos of positions) {
        const mv = (pos.units ?? 0) * ((pos.price ?? 0));
        totalValue += mv;
        accountBreakdown[accountType] = (accountBreakdown[accountType] ?? 0) + mv;

        allHoldings.push({
          ticker: pos.symbol?.symbol ?? "UNKNOWN",
          name: pos.symbol?.description ?? pos.symbol?.symbol ?? "Unknown",
          quantity: pos.units ?? 0,
          costBasis: pos.average_purchase_price ?? 0,
          marketValue: mv,
          accountType,
        });
      }
    }

    const snapshotId = uuidv4();
    await db.insert(portfolioSnapshots).values({
      id: snapshotId,
      userId,
      snapshotAt: now,
      totalValue,
      cashValue,
      accounts: JSON.stringify(accountBreakdown),
      createdAt: now,
    });

    for (const h of allHoldings) {
      await db.insert(holdings).values({
        id: uuidv4(),
        userId,
        snapshotId,
        ...h,
        createdAt: now,
      });
    }

    await db
      .update(wealthsimpleConnections)
      .set({ lastSyncedAt: now, status: "active" })
      .where(eq(wealthsimpleConnections.id, conn.id));

    return NextResponse.json({ ok: true, totalValue, holdingsCount: allHoldings.length });
  } catch (err) {
    await db
      .update(wealthsimpleConnections)
      .set({ status: "reconnect_required" })
      .where(eq(wealthsimpleConnections.id, conn.id));
    throw err;
  }
}

function inferAccountType(accountName: string): "tfsa" | "rrsp" | "non_reg" | "crypto" {
  const lower = accountName.toLowerCase();
  if (lower.includes("tfsa")) return "tfsa";
  if (lower.includes("rrsp")) return "rrsp";
  if (lower.includes("crypto")) return "crypto";
  return "non_reg";
}
