/**
 * GET /api/reports?months=12
 * Deterministic financial reports (spec §9 Reports screen — no LLM):
 *  - netWorth: daily series of bank balances (deposits − credit owed) + portfolio value
 *  - categoryTrends: per-category monthly spend
 *  - incomeVsExpenses: monthly inflows vs outflows
 * The monthly spending drill-down reuses GET /api/budget for that month.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-guard";
import { db } from "@/db";
import { bankAccounts, bankBalanceSnapshots, budgetEnvelopes, portfolioSnapshots, transactions, transactionSplits } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { attributeSpend } from "@/lib/budget/summarize";
import { budgetRows } from "@/lib/budget/transfers";
import { classifyRefunds, effectiveMonth } from "@/lib/budget/refunds";
import { excludeWealthsimpleMirrors } from "@/lib/reports/net-worth-sources";

export async function GET(req: NextRequest) {
  const authed = await requireUser(req);
  if ("response" in authed) return authed.response;
  const userId = authed.userId;

  const { searchParams } = new URL(req.url);
  const months = Math.min(parseInt(searchParams.get("months") ?? "12", 10) || 12, 60);

  const [accounts, balanceSnaps, portfolioSnaps, txns, splits, envelopes] = await Promise.all([
    db
      .select({ id: bankAccounts.id, name: bankAccounts.name, type: bankAccounts.type })
      .from(bankAccounts)
      .where(eq(bankAccounts.userId, userId)),
    db
      .select()
      .from(bankBalanceSnapshots)
      .where(eq(bankBalanceSnapshots.userId, userId)),
    db
      .select({ snapshotAt: portfolioSnapshots.snapshotAt, totalValue: portfolioSnapshots.totalValue })
      .from(portfolioSnapshots)
      .where(eq(portfolioSnapshots.userId, userId)),
    db
      .select({
        id: transactions.id,
        date: transactions.date,
        // For refund classification's merchant matching, not display.
        description: transactions.description,
        amount: transactions.amount,
        category: transactions.category,
        transferSource: transactions.transferSource,
        coverage: transactions.coverage,
      })
      .from(transactions)
      .where(eq(transactions.userId, userId)),
    db
      .select({
        transactionId: transactionSplits.transactionId,
        category: transactionSplits.category,
        amount: transactionSplits.amount,
      })
      .from(transactionSplits)
      .where(eq(transactionSplits.userId, userId)),
    // Active envelope names gate refund classification: a positive row only
    // nets against a budget that exists.
    db
      .select({ name: budgetEnvelopes.name })
      .from(budgetEnvelopes)
      .where(and(eq(budgetEnvelopes.userId, userId), eq(budgetEnvelopes.active, 1))),
  ]);

  // ── Net worth: daily buckets with carry-forward of each account's last-known
  // balance. Credit balances are amounts owed → liabilities. History starts the
  // day capture started (cannot be backfilled — spec §9).
  // Portfolio snapshots are authoritative for Wealthsimple (cash included) —
  // bank-side WS mirror accounts must not also contribute balances, or WS
  // cash counts twice. See lib/reports/net-worth-sources.ts.
  const bankSideAccounts = excludeWealthsimpleMirrors(accounts, portfolioSnaps.length > 0);
  const bankSideIds = new Set(bankSideAccounts.map((a) => a.id));
  const bankSnaps = balanceSnaps.filter((s) => bankSideIds.has(s.accountId));

  const creditAccounts = new Set(accounts.filter((a) => a.type === "credit").map((a) => a.id));
  const day = (unix: number) => new Date(unix * 1000).toISOString().split("T")[0];

  const allDays = new Set<string>();
  for (const s of bankSnaps) allDays.add(day(s.capturedAt));
  for (const s of portfolioSnaps) allDays.add(day(s.snapshotAt));
  const sortedDays = [...allDays].sort();

  const snapsByAccount = new Map<string, { day: string; balance: number }[]>();
  for (const s of bankSnaps) {
    const list = snapsByAccount.get(s.accountId) ?? [];
    list.push({ day: day(s.capturedAt), balance: s.balanceCurrent ?? 0 });
    snapsByAccount.set(s.accountId, list);
  }
  for (const list of snapsByAccount.values()) list.sort((a, b) => a.day.localeCompare(b.day));
  const portfolioByDay = [...portfolioSnaps]
    .sort((a, b) => a.snapshotAt - b.snapshotAt)
    .map((s) => ({ day: day(s.snapshotAt), value: s.totalValue }));

  const lastAtOrBefore = <T extends { day: string }>(list: T[], d: string): T | undefined => {
    let found: T | undefined;
    for (const item of list) {
      if (item.day > d) break;
      found = item;
    }
    return found;
  };

  const netWorth = sortedDays.map((d) => {
    let bankTotal = 0;
    for (const [accountId, list] of snapsByAccount) {
      const snap = lastAtOrBefore(list, d);
      if (!snap) continue;
      bankTotal += creditAccounts.has(accountId) ? -snap.balance : snap.balance;
    }
    const portfolio = lastAtOrBefore(portfolioByDay, d)?.value ?? 0;
    return { date: d, bank: bankTotal, portfolio, total: bankTotal + portfolio };
  });

  // ── Monthly buckets over the requested window
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - months);
  const cutoffMonth = cutoff.toISOString().slice(0, 7); // YYYY-MM
  const monthOf = (date: string) => date.slice(0, 7);

  // Money moving between the user's own accounts is neither income nor an
  // expense. Excluded here as well as in lib/budget/summarize.ts — this route
  // computes its own cash-flow figures, so it would otherwise keep reporting
  // credit-card payments as income while the Budget screen no longer did, and
  // the two screens would disagree about the same month.
  const txnsForFlow = budgetRows(txns);

  // Same refund treatment as /api/budget, or the two screens disagree about
  // the same month: a refund is negative spending in its purchase's month
  // (when matched), never income. Full history is already loaded here.
  const envelopeNames = new Set(envelopes.map((e) => e.name));
  const refunds = classifyRefunds(txns, envelopeNames);

  const trendMap = new Map<string, Map<string, number>>(); // month → category → spend
  const flowMap = new Map<string, { income: number; expenses: number }>();
  // Income vs expenses is a cash-flow view, so it stays on the parent amount —
  // splitting a purchase across envelopes doesn't change what left the account.
  for (const t of txnsForFlow) {
    const isRefund = refunds.has(t.id);
    const m = isRefund ? effectiveMonth(t, refunds) : monthOf(t.date);
    if (m < cutoffMonth) continue;
    const flow = flowMap.get(m) ?? { income: 0, expenses: 0 };
    if (isRefund) flow.expenses -= t.amount;
    else if (t.amount > 0) flow.income += t.amount;
    else flow.expenses += Math.abs(t.amount);
    flowMap.set(m, flow);
  }

  // Category trends are per-envelope, so they follow the splits.
  for (const a of attributeSpend(txnsForFlow, splits)) {
    const isRefund = refunds.has(a.transaction.id);
    const m = isRefund ? effectiveMonth(a.transaction, refunds) : monthOf(a.transaction.date);
    if (m < cutoffMonth) continue;
    if (a.amount >= 0 && !isRefund) continue;
    const cat = a.category ?? "uncategorized";
    const catMap = trendMap.get(m) ?? new Map<string, number>();
    catMap.set(cat, (catMap.get(cat) ?? 0) - a.amount);
    trendMap.set(m, catMap);
  }

  const monthsSorted = [...new Set([...trendMap.keys(), ...flowMap.keys()])].sort();
  const categoryTrends = monthsSorted.map((m) => ({
    month: m,
    categories: Object.fromEntries(trendMap.get(m) ?? []),
  }));
  const incomeVsExpenses = monthsSorted.map((m) => {
    const flow = flowMap.get(m) ?? { income: 0, expenses: 0 };
    return { month: m, ...flow, net: flow.income - flow.expenses };
  });

  return NextResponse.json({ netWorth, categoryTrends, incomeVsExpenses });
}
