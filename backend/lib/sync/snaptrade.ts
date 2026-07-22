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
    let cashValue = 0;
    // Per-account-type rollup, replacing the old fixed 4-bucket breakdown that
    // filed managed RESPs, 12 cash buckets and the personal account together
    // as one opaque "non_reg" number. `managed` is DERIVED: value the account
    // reports but no position itemizes is money run by Wealthsimple's robo —
    // the UI must say so, or the missing line items read as a sync bug.
    const groups = new Map<string, AccountGroup>();
    const allHoldings: Array<{
      ticker: string; name: string; quantity: number;
      costBasis: number; marketValue: number; openPnl: number | null; accountType: string;
    }> = [];

    for (const account of accounts) {
      // Wealthsimple reports every account ever opened; closed ones can hold
      // no positions, and each poll is a call against the rate limit.
      if (account.status === "closed") continue;

      // The combined holdings endpoint is retired for this API tier — it now
      // returns 410 "This endpoint is no longer available for your account"
      // (verified live 2026-07-22). Positions is the granular replacement and
      // returns the same Position shape this loop already reads.
      const positionsRes = await snaptrade.accountInformation.getUserAccountPositions({
        accountId: account.id!,
        userId: conn.snaptradeUserId,
        userSecret,
      });

      const accountType = inferAccountType(account.raw_type ?? account.name ?? "");
      const positions = positionsRes.data ?? [];

      // The account's own total is the authoritative value, NOT the sum of
      // positions: Wealthsimple MANAGED accounts (this household's RESPs,
      // ~$19.7k each) report no itemized positions at all, and cash accounts
      // hold real money with no tickers. Summing positions alone valued a
      // ~$78k Wealthsimple relationship at $5.18 (verified live 2026-07-22).
      const accountTotal = account.balance?.total?.amount ?? 0;
      totalValue += accountTotal;

      // Cash split out per user decision: totalValue is everything at the
      // brokerage; cashValue lets screens show invested-vs-cash honestly.
      const balanceRes = await snaptrade.accountInformation.getUserAccountBalance({
        accountId: account.id!,
        userId: conn.snaptradeUserId,
        userSecret,
      });
      let accountCash = 0;
      for (const b of balanceRes.data ?? []) accountCash += b.cash ?? 0;
      cashValue += accountCash;

      const group = groups.get(accountType) ?? {
        type: accountType,
        total: 0,
        cash: 0,
        positionsValue: 0,
        accountCount: 0,
        managed: false,
        accounts: [],
      };
      group.total += accountTotal;
      group.cash += accountCash;
      group.accountCount += 1;
      group.accounts.push({
        id: account.id!,
        last4: (account.number ?? "").slice(-4),
        total: accountTotal,
        cash: accountCash,
      });
      groups.set(accountType, group);

      for (const pos of positions) {
        const mv = (pos.units ?? 0) * ((pos.price ?? 0));
        group.positionsValue += mv;

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

    // Value neither cash nor an itemized position = run by the robo.
    // $1 of slack absorbs float noise from the three separately-reported sums.
    for (const g of groups.values()) {
      g.managed = g.total - g.cash - g.positionsValue > 1;
      g.accounts.sort((a, b) => b.total - a.total);
    }

    const snapshotId = uuidv4();
    await db.insert(portfolioSnapshots).values({
      id: snapshotId,
      userId,
      snapshotAt: now,
      totalValue,
      cashValue,
      // New shape: an ARRAY of typed groups (biggest first). Readers detect
      // array-vs-object to keep rendering pre-2026-07-22 snapshots.
      accounts: JSON.stringify([...groups.values()].sort((a, b) => b.total - a.total)),
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

/** One row of the snapshot's `accounts` JSON — an account-type rollup. */
export interface AccountGroup {
  type: string;
  total: number;
  cash: number;
  /** Sum of itemized position market values in this group. */
  positionsValue: number;
  accountCount: number;
  /** True when value exists that no position itemizes — Wealthsimple robo. */
  managed: boolean;
  /** The individual accounts behind the rollup — the drill-down a tapped
   *  group opens. Wealthsimple names every account identically and exposes no
   *  user nicknames, so `id` keys the user's own in-app names and last-4 of
   *  the internal slug is the only default label available. */
  accounts: { id: string; last4: string; total: number; cash: number }[];
}

/**
 * Maps the API's `raw_type` ("TFSA", "RRSP", "CRYPTO", "MSB", "RESP", "FHSA",
 * "PERSONAL") to a display type — Wealthsimple names every account
 * "Wealthsimple Trade <TYPE>", so the old name-sniffing worked only by
 * accident. Each real type keeps its own identity now; MSB is Wealthsimple's
 * cash product.
 */
function inferAccountType(rawTypeOrName: string): string {
  const lower = rawTypeOrName.toLowerCase();
  if (lower.includes("tfsa")) return "tfsa";
  if (lower.includes("rrsp")) return "rrsp";
  if (lower.includes("crypto")) return "crypto";
  if (lower.includes("resp")) return "resp";
  if (lower.includes("fhsa")) return "fhsa";
  if (lower.includes("msb")) return "cash";
  if (lower.includes("personal")) return "personal";
  return "non_reg";
}
