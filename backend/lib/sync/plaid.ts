/**
 * Plaid transaction sync for one user — shared by POST /api/plaid/sync and the
 * nightly 2am job (spec §7). Records itself in job_runs.
 */
import { db } from "@/db";
import { bankConnections, bankAccounts, transactions } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { decrypt } from "@/lib/crypto";
import { plaidClient } from "@/lib/plaid";
import { categorize, rulesForRow } from "@/lib/categorization";
import { loadCategorizationContext } from "@/lib/budget/categorization-context";
import { matchesTransferPattern } from "@/lib/budget/transfers";
import { syncAccountsForConnection } from "@/lib/plaid-accounts";
import { startJobRun, finishJobRun } from "@/lib/jobs/job-runs";
import { v4 as uuidv4 } from "uuid";

const DEBOUNCE_SECONDS = 120; // 2 minutes

export async function syncPlaidForUser(
  userId: string
): Promise<{ connections: number; transactionsProcessed: number }> {
  const now = Math.floor(Date.now() / 1000);

  const connections = await db
    .select()
    .from(bankConnections)
    .where(and(eq(bankConnections.userId, userId), eq(bankConnections.status, "active")));

  const { envelopes: parsedEnvelopes, learnedRules, transferPatterns } =
    await loadCategorizationContext(userId);

  let totalAdded = 0;
  const jobId = await startJobRun("plaid_sync", userId);

  try {
    for (const conn of connections) {
      // Hard debounce: skip if synced within last 2 minutes
      if (conn.lastSyncedAt && now - conn.lastSyncedAt < DEBOUNCE_SECONDS) {
        continue;
      }

      const accessToken = decrypt(conn.plaidAccessToken);

      // Keep account names/types/balances current (also appends the daily
      // bank_balance_snapshots row) before processing transactions below.
      await syncAccountsForConnection(conn.id, userId, accessToken, conn.institutionName);

      let cursor: string | undefined;
      let hasMore = true;

      while (hasMore) {
        const syncRes = await plaidClient.transactionsSync({
          access_token: accessToken,
          cursor,
        });

        const { added, modified, next_cursor, has_more } = syncRes.data;

        for (const txn of [...added, ...modified]) {
          // Account rows are populated by syncAccountsForConnection above, from
          // Plaid's real account metadata. If this lookup misses, that's a real
          // bug (accountsGet and transactionsSync disagreeing on account_id
          // scope for this Item) worth surfacing, not papering over.
          const existingAcct = await db
            .select({ id: bankAccounts.id })
            .from(bankAccounts)
            .where(eq(bankAccounts.plaidAccountId, txn.account_id))
            .limit(1);

          if (existingAcct.length === 0) {
            console.error(
              `Skipping transaction ${txn.transaction_id}: no bank_accounts row for Plaid account_id ${txn.account_id} (connection ${conn.id})`
            );
            continue;
          }
          const accountId = existingAcct[0].id;

          // Learned rules are scoped (account / effective-from) — filter per row.
          const category = categorize(
            txn.name,
            parsedEnvelopes,
            rulesForRow(learnedRules, { accountId, date: txn.date })
          );
          // Approved transfer patterns mark at write time (see pipeline.ts).
          const transferSource = matchesTransferPattern(txn.name, transferPatterns) ? "rule" : null;

          // Free enrichment fields already in the /transactions/sync response —
          // captured per the capture-now rule (spec §4 transactions)
          const enrichment = {
            authorizedDate: txn.authorized_date ?? null,
            merchantLogoUrl: txn.logo_url ?? null,
            merchantWebsite: txn.website ?? null,
            isoCurrencyCode: txn.iso_currency_code ?? null,
            pfCategoryPrimary: txn.personal_finance_category?.primary ?? null,
            pfCategoryDetailed: txn.personal_finance_category?.detailed ?? null,
            paymentChannel: txn.payment_channel ?? null,
            location: txn.location ? JSON.stringify(txn.location) : null,
          };

          await db
            .insert(transactions)
            .values({
              id: uuidv4(),
              userId,
              accountId,
              plaidTransactionId: txn.transaction_id,
              date: txn.date,
              description: txn.name,
              merchantName: txn.merchant_name ?? null,
              amount: -(txn.amount), // Plaid: positive = debit; we: negative = debit
              category,
              transferSource,
              pending: txn.pending ? 1 : 0,
              createdAt: now,
              ...enrichment,
            })
            .onConflictDoUpdate({
              target: transactions.plaidTransactionId,
              set: {
                merchantName: txn.merchant_name ?? null,
                pending: txn.pending ? 1 : 0,
                category,
                ...enrichment,
              },
            });
          totalAdded++;
        }

        cursor = next_cursor;
        hasMore = has_more;
      }

      await db
        .update(bankConnections)
        .set({ lastSyncedAt: now })
        .where(eq(bankConnections.id, conn.id));
    }
  } catch (err) {
    await finishJobRun(jobId, {
      status: "failed",
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }

  await finishJobRun(jobId, {
    status: "complete",
    metadata: { connections: connections.length, transactionsProcessed: totalAdded },
  });
  return { connections: connections.length, transactionsProcessed: totalAdded };
}
