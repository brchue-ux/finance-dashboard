/**
 * Fetches real account metadata (name, mask, type) AND current balances from
 * Plaid and upserts bank_accounts rows. Called after exchange (initial
 * population) and at the start of every sync (keeps names/types current if the
 * user renames an account at their bank, or a new account is added to an
 * existing Item).
 *
 * Balances: current values overwrite bank_accounts.* each call; history is
 * appended to bank_balance_snapshots at most once per account per UTC day
 * (the durable series that powers net-worth-over-time — spec §4/§9 Reports).
 */
import { db } from "@/db";
import { bankAccounts, bankBalanceSnapshots } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { plaidClient } from "@/lib/plaid";
import { v4 as uuidv4 } from "uuid";

// Our schema only tracks chequing/savings/credit (the account types the
// spec's actual bank list — RBC, Tangerine, Scotiabank — ever produces).
// Anything else (loan, investment, CD, HSA, ...) is out of scope: Plaid
// sandbox test institutions expose account variety no real Canadian retail
// bank Item will. Returning null means "don't create a row for this" rather
// than silently mislabeling a mortgage or 401k as a chequing account.
function mapAccountType(plaidType: string, plaidSubtype: string | null): string | null {
  if (plaidSubtype === "checking") return "chequing";
  if (plaidSubtype === "savings") return "savings";
  if (plaidType === "credit") return "credit";
  return null;
}

function utcDayStart(unixSeconds: number): number {
  return unixSeconds - (unixSeconds % 86400);
}

export async function syncAccountsForConnection(
  connectionId: string,
  userId: string,
  accessToken: string,
  institutionName: string
): Promise<void> {
  const { data } = await plaidClient.accountsGet({ access_token: accessToken });
  const now = Math.floor(Date.now() / 1000);

  for (const acct of data.accounts) {
    const type = mapAccountType(acct.type, acct.subtype);
    if (type === null) {
      console.log(
        `Skipping out-of-scope account "${acct.name}" (type=${acct.type}, subtype=${acct.subtype}) — not chequing/savings/credit`
      );
      continue;
    }

    const existing = await db
      .select({ id: bankAccounts.id })
      .from(bankAccounts)
      .where(eq(bankAccounts.plaidAccountId, acct.account_id))
      .limit(1);

    const balances = {
      balanceAvailable: acct.balances.available ?? null,
      balanceCurrent: acct.balances.current ?? null,
      balanceLimit: acct.balances.limit ?? null,
      isoCurrencyCode: acct.balances.iso_currency_code ?? null,
    };
    const values = {
      name: acct.official_name ?? acct.name,
      type,
      mask: acct.mask,
      institution: institutionName,
      ...balances,
    };

    let accountId: string;
    if (existing.length === 0) {
      accountId = uuidv4();
      await db.insert(bankAccounts).values({
        id: accountId,
        userId,
        connectionId,
        plaidAccountId: acct.account_id,
        ...values,
      });
    } else {
      accountId = existing[0].id;
      await db.update(bankAccounts).set(values).where(eq(bankAccounts.id, accountId));
    }

    // Append-only history: at most one snapshot per account per UTC day,
    // regardless of how many intraday syncs run
    const [latest] = await db
      .select({ capturedAt: bankBalanceSnapshots.capturedAt })
      .from(bankBalanceSnapshots)
      .where(eq(bankBalanceSnapshots.accountId, accountId))
      .orderBy(desc(bankBalanceSnapshots.capturedAt))
      .limit(1);

    if (!latest || utcDayStart(latest.capturedAt) < utcDayStart(now)) {
      await db.insert(bankBalanceSnapshots).values({
        id: uuidv4(),
        accountId,
        userId,
        ...balances,
        capturedAt: now,
      });
    }
  }
}
