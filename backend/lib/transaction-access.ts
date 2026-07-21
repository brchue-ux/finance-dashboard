/**
 * Authenticate the caller and load one of *their* transactions.
 *
 * Ownership is enforced in the same query that fetches the row, not as a
 * follow-up check — so there is no path where the row is read first and
 * compared afterwards, and a transaction belonging to someone else is
 * indistinguishable from one that does not exist (404, never 403: confirming
 * an id exists is itself a leak).
 *
 * Shared by every /api/transactions/:id route so the ownership rule has one
 * definition. It was previously inlined in the splits route, which is fine
 * until the second route disagrees with it by accident.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-guard";
import { db } from "@/db";
import { transactions } from "@/db/schema";
import { and, eq } from "drizzle-orm";

export type OwnedTransaction = {
  row: {
    id: string;
    amount: number;
    category: string | null;
    categorySource: string | null;
  };
  userId: string;
};

export async function ownedTransaction(
  req: NextRequest,
  id: string
): Promise<OwnedTransaction | { response: NextResponse }> {
  const authed = await requireUser(req);
  if ("response" in authed) return authed;

  const [row] = await db
    .select({
      id: transactions.id,
      amount: transactions.amount,
      category: transactions.category,
      categorySource: transactions.categorySource,
    })
    .from(transactions)
    .where(and(eq(transactions.id, id), eq(transactions.userId, authed.userId)));

  if (!row) return { response: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  return { row, userId: authed.userId };
}
