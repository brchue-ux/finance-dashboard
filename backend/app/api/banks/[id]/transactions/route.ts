/**
 * GET /api/banks/:id/transactions?limit=50&offset=0 — full transaction history
 * for ONE bank account (spec §9 / Ticket 011: per-account drill-down, reuses the
 * transaction feed filtered to a single accountId rather than month-blended like
 * /api/budget). Newest first, paginated.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-guard";
import { db } from "@/db";
import { bankAccounts, budgetEnvelopes, transactions, transactionSplits } from "@/db/schema";
import { and, count, desc, eq, gt, inArray, or } from "drizzle-orm";
import { classifyRefunds } from "@/lib/budget/refunds";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const authed = await requireUser(req);
  if ("response" in authed) return authed.response;
  const { id: accountId } = await ctx.params;

  // Ownership check — never serve another user's account, and 404 an unknown id
  const [account] = await db
    .select({ id: bankAccounts.id, name: bankAccounts.name })
    .from(bankAccounts)
    .where(and(eq(bankAccounts.id, accountId), eq(bankAccounts.userId, authed.userId)))
    .limit(1);
  if (!account) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { searchParams } = new URL(req.url);
  const limit = Math.min(Math.max(parseInt(searchParams.get("limit") ?? String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT, 1), MAX_LIMIT);
  let offset = Math.max(parseInt(searchParams.get("offset") ?? "0", 10) || 0, 0);

  // A jump target ("View original purchase", notable cards) can be older than
  // any fixed page. When the caller names the row it needs, serve the page
  // CONTAINING it: rank = rows sorting before it under this route's own
  // ORDER BY, then center the page there. Beats client-side fetch-until-found
  // — one extra COUNT instead of N page round-trips.
  const highlight = searchParams.get("highlight");
  if (highlight && !searchParams.has("offset")) {
    const [target] = await db
      .select({ date: transactions.date, createdAt: transactions.createdAt })
      .from(transactions)
      .where(and(eq(transactions.id, highlight), eq(transactions.userId, authed.userId)))
      .limit(1);
    if (target) {
      const [{ rank }] = await db
        .select({ rank: count() })
        .from(transactions)
        .where(
          and(
            eq(transactions.accountId, accountId),
            eq(transactions.userId, authed.userId),
            or(
              gt(transactions.date, target.date),
              and(eq(transactions.date, target.date), gt(transactions.createdAt, target.createdAt))
            )
          )
        );
      offset = Math.max(0, rank - Math.floor(limit / 2));
    }
  }

  // Fetch one extra row to compute hasMore without a second COUNT query
  const rows = await db
    .select()
    .from(transactions)
    .where(and(eq(transactions.accountId, accountId), eq(transactions.userId, authed.userId)))
    .orderBy(desc(transactions.date), desc(transactions.createdAt))
    .limit(limit + 1)
    .offset(offset);

  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);

  // A split transaction keeps its own `category`, but its money is actually
  // divided across its splits — so the row would look unchanged after a split,
  // which read as "did that even work?". Attach the split categories so the feed
  // can show what it was divided into. One query for the whole page, not per row.
  const ids = page.map((r) => r.id);
  const splitRows = ids.length
    ? await db
        .select({ transactionId: transactionSplits.transactionId, category: transactionSplits.category })
        .from(transactionSplits)
        .where(and(eq(transactionSplits.userId, authed.userId), inArray(transactionSplits.transactionId, ids)))
    : [];
  const splitsByTxn = new Map<string, string[]>();
  for (const s of splitRows) {
    const arr = splitsByTxn.get(s.transactionId) ?? [];
    arr.push(s.category);
    splitsByTxn.set(s.transactionId, arr);
  }

  // Same refund annotation as /api/budget, or a refund row reads "Refund → Jun"
  // on one screen and as ordinary income on another. Classification needs the
  // user's FULL history (the matching purchase is usually on a different
  // account — card refund, chequing purchase — and always outside this page).
  const [allTxns, envelopes] = await Promise.all([
    db
      .select({
        id: transactions.id,
        accountId: transactions.accountId,
        date: transactions.date,
        description: transactions.description,
        amount: transactions.amount,
        category: transactions.category,
        transferSource: transactions.transferSource,
        coverage: transactions.coverage,
      })
      .from(transactions)
      .where(eq(transactions.userId, authed.userId)),
    db
      .select({ name: budgetEnvelopes.name })
      .from(budgetEnvelopes)
      .where(and(eq(budgetEnvelopes.userId, authed.userId), eq(budgetEnvelopes.active, 1))),
  ]);
  const refunds = classifyRefunds(allTxns, new Set(envelopes.map((e) => e.name)));
  const txnById = new Map(allTxns.map((t) => [t.id, t]));

  return NextResponse.json({
    accountId,
    accountName: account.name,
    transactions: page.map((r) => {
      const refund = refunds.get(r.id);
      const purchase = refund?.matchedTxnId ? txnById.get(refund.matchedTxnId) : undefined;
      return {
        ...r,
        splitCategories: splitsByTxn.get(r.id) ?? null,
        refundEffectiveMonth: refund?.effectiveMonth ?? null,
        refundMatchedTxnId: purchase?.id ?? null,
        refundMatchedAccountId: purchase?.accountId ?? null,
      };
    }),
    limit,
    offset,
    hasMore,
  });
}
