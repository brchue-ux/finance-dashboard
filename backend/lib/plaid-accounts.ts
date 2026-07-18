/**
 * Fetches real account metadata (name, mask, type) from Plaid and upserts
 * bank_accounts rows. Called after exchange (initial population) and at the
 * start of every sync (keeps names/types current if the user renames an
 * account at their bank, or a new account is added to an existing Item).
 */
import { db } from "@/db";
import { bankAccounts } from "@/db/schema";
import { eq } from "drizzle-orm";
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

export async function syncAccountsForConnection(
  connectionId: string,
  userId: string,
  accessToken: string,
  institutionName: string
): Promise<void> {
  const { data } = await plaidClient.accountsGet({ access_token: accessToken });

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

    const values = {
      name: acct.official_name ?? acct.name,
      type,
      mask: acct.mask,
      institution: institutionName,
    };

    if (existing.length === 0) {
      await db.insert(bankAccounts).values({
        id: uuidv4(),
        userId,
        connectionId,
        plaidAccountId: acct.account_id,
        ...values,
      });
    } else {
      await db.update(bankAccounts).set(values).where(eq(bankAccounts.id, existing[0].id));
    }
  }
}
