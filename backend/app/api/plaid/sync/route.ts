/**
 * POST /api/plaid/sync
 * Syncs transactions for all active bank connections for the authenticated user.
 * Uses /transactions/sync (not deprecated /transactions/get).
 * Respects staleness: hard debounce of 2 minutes.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import {
  bankConnections,
  bankAccounts,
  transactions,
  budgetEnvelopes,
} from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { decrypt } from "@/lib/crypto";
import { plaidClient } from "@/lib/plaid";
import { categorize } from "@/lib/categorization";
import { syncAccountsForConnection } from "@/lib/plaid-accounts";
import { v4 as uuidv4 } from "uuid";

const DEBOUNCE_SECONDS = 120; // 2 minutes

export async function POST(req: NextRequest) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = session.user.id;
  const now = Math.floor(Date.now() / 1000);

  const connections = await db
    .select()
    .from(bankConnections)
    .where(and(eq(bankConnections.userId, userId), eq(bankConnections.status, "active")));

  const envelopes = await db
    .select({
      name: budgetEnvelopes.name,
      categoryRules: budgetEnvelopes.categoryRules,
      sortOrder: budgetEnvelopes.sortOrder,
    })
    .from(budgetEnvelopes)
    .where(and(eq(budgetEnvelopes.userId, userId), eq(budgetEnvelopes.active, 1)));

  const parsedEnvelopes = envelopes.map((e) => ({
    ...e,
    categoryRules: JSON.parse(e.categoryRules) as string[],
  }));

  let totalAdded = 0;

  for (const conn of connections) {
    // Hard debounce: skip if synced within last 2 minutes
    if (conn.lastSyncedAt && now - conn.lastSyncedAt < DEBOUNCE_SECONDS) {
      continue;
    }

    const accessToken = decrypt(conn.plaidAccessToken);

    // Keep account names/types current (handles renames and newly added
    // accounts on an existing Item) before processing transactions below.
    await syncAccountsForConnection(conn.id, userId, accessToken, conn.institutionName);

    let cursor: string | undefined;
    let hasMore = true;

    while (hasMore) {
      const syncRes = await plaidClient.transactionsSync({
        access_token: accessToken,
        cursor,
      });

      const { added, modified, removed, next_cursor, has_more } = syncRes.data;

      // Upsert added/modified transactions
      for (const txn of [...added, ...modified]) {
        // Account rows are populated by syncAccountsForConnection above, from
        // Plaid's real account metadata (name, mask, type) — not inferred
        // from transaction data. If this lookup ever misses, that's a real
        // bug (accountsGet and transactionsSync disagreeing on account_id
        // scope for this Item) worth surfacing, not papering over with a
        // placeholder row.
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

        const category = categorize(txn.name, parsedEnvelopes);

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
            pending: txn.pending ? 1 : 0,
            createdAt: now,
          })
          .onConflictDoUpdate({
            target: transactions.plaidTransactionId,
            set: {
              merchantName: txn.merchant_name ?? null,
              pending: txn.pending ? 1 : 0,
              category,
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

  return NextResponse.json({ ok: true, transactionsProcessed: totalAdded });
}
