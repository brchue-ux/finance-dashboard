/**
 * Net worth draws from two independent sources: bank-side balance snapshots
 * and portfolio snapshots. Since 2026-07-22 the portfolio snapshot carries the
 * WHOLE Wealthsimple relationship — cash included — while the bank side also
 * holds WS accounts (manual transaction imports: Chequing, TFSA, RESP…).
 *
 * Today those bank-side WS accounts have no balance snapshots, so nothing
 * double-counts. But the first balance source that appears for them (a future
 * import, an aggregator) would silently count WS cash twice. This guard makes
 * the boundary structural instead of accidental: when a portfolio snapshot
 * exists, it is AUTHORITATIVE for Wealthsimple, and bank-side WS accounts are
 * excluded from the bank total.
 */
export function excludeWealthsimpleMirrors<T extends { id: string; name: string | null }>(
  accounts: T[],
  hasPortfolioSnapshot: boolean
): T[] {
  if (!hasPortfolioSnapshot) return accounts;
  return accounts.filter((a) => !/wealthsimple/i.test(a.name ?? ""));
}
