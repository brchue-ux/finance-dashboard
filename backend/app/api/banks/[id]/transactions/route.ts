/**
 * GET /api/banks/:id/transactions?limit=50&offset=0 — full transaction history
 * for ONE bank account (spec §9 / Ticket 011: per-account drill-down, reuses the
 * transaction feed filtered to a single accountId rather than month-blended like
 * /api/budget). Newest first, paginated.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { bankAccounts, transactions } from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: accountId } = await ctx.params;

  // Ownership check — never serve another user's account, and 404 an unknown id
  const [account] = await db
    .select({ id: bankAccounts.id, name: bankAccounts.name })
    .from(bankAccounts)
    .where(and(eq(bankAccounts.id, accountId), eq(bankAccounts.userId, session.user.id)))
    .limit(1);
  if (!account) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { searchParams } = new URL(req.url);
  const limit = Math.min(Math.max(parseInt(searchParams.get("limit") ?? String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT, 1), MAX_LIMIT);
  const offset = Math.max(parseInt(searchParams.get("offset") ?? "0", 10) || 0, 0);

  // Fetch one extra row to compute hasMore without a second COUNT query
  const rows = await db
    .select()
    .from(transactions)
    .where(and(eq(transactions.accountId, accountId), eq(transactions.userId, session.user.id)))
    .orderBy(desc(transactions.date), desc(transactions.createdAt))
    .limit(limit + 1)
    .offset(offset);

  const hasMore = rows.length > limit;
  return NextResponse.json({
    accountId,
    accountName: account.name,
    transactions: rows.slice(0, limit),
    limit,
    offset,
    hasMore,
  });
}
