/**
 * SnapTrade portfolio sync for one user — shared by POST /api/snaptrade/sync
 * and the nightly 2am job (spec §7). Appends a portfolio_snapshots row +
 * holdings rows (never overwrites). Records itself in job_runs.
 */
import { db } from "@/db";
import { wealthsimpleConnections, portfolioSnapshots, holdings } from "@/db/schema";
import { eq } from "drizzle-orm";
import { decrypt } from "@/lib/crypto";
import { snaptrade } from "@/lib/snaptrade";
import { startJobRun, finishJobRun } from "@/lib/jobs/job-runs";
import { v4 as uuidv4 } from "uuid";

const DEBOUNCE_SECONDS = 120;

export async function syncSnapTradeForUser(
  userId: string
): Promise<{ skipped?: string; totalValue?: number; holdingsCount?: number }> {
  const now = Math.floor(Date.now() / 1000);

  const [conn] = await db
    .select()
    .from(wealthsimpleConnections)
    .where(eq(wealthsimpleConnections.userId, userId))
    .limit(1);

  if (!conn) return { skipped: "no_connection" };
  if (conn.lastSyncedAt && now - conn.lastSyncedAt < DEBOUNCE_SECONDS) {
    return { skipped: "debounce" };
  }

  const userSecret = decrypt(conn.snaptradeAuthToken);
  const jobId = await startJobRun("snaptrade_sync", userId);

  try {
    const accountsRes = await snaptrade.accountInformation.listUserAccounts({
      userId: conn.snaptradeUserId,
      userSecret,
    });
    const accounts = accountsRes.data ?? [];

    let totalValue = 0;
    const cashValue = 0;
    const accountBreakdown: Record<string, number> = {
      tfsa: 0, rrsp: 0, non_reg: 0, crypto: 0,
    };
    const allHoldings: Array<{
      ticker: string; name: string; quantity: number;
      costBasis: number; marketValue: number; openPnl: number | null; accountType: string;
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

        // v10 SDK nesting: Position.symbol (PositionSymbol) → .symbol (UniversalSymbol) → .symbol (ticker string)
        allHoldings.push({
          ticker: pos.symbol?.symbol?.symbol ?? "UNKNOWN",
          name: pos.symbol?.symbol?.description ?? pos.symbol?.description ?? "Unknown",
          quantity: pos.units ?? 0,
          costBasis: pos.average_purchase_price ?? 0,
          marketValue: mv,
          // Broker-computed unrealized P&L — can differ from our naive calc
          // (multiple lots, corporate actions); stored alongside, not instead
          openPnl: pos.open_pnl ?? null,
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

    await finishJobRun(jobId, {
      status: "complete",
      metadata: { totalValue, holdingsCount: allHoldings.length, accounts: accounts.length },
    });
    return { totalValue, holdingsCount: allHoldings.length };
  } catch (err) {
    await db
      .update(wealthsimpleConnections)
      .set({ status: "reconnect_required" })
      .where(eq(wealthsimpleConnections.id, conn.id));
    await finishJobRun(jobId, {
      status: "failed",
      errorMessage: err instanceof Error ? err.message : String(err),
    });
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
