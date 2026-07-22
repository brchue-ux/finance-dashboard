import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export interface Holding {
  id: string;
  ticker: string;
  name: string;
  quantity: number;
  costBasis: number;
  marketValue: number;
  accountType: "tfsa" | "rrsp" | "non_reg" | "crypto";
}

export interface PortfolioSnapshot {
  snapshotAt: number;
  totalValue: number;
}

/** One account-type rollup from the sync (post-2026-07-22 snapshots). */
export interface AccountGroup {
  type: string;
  total: number;
  cash: number;
  positionsValue: number;
  accountCount: number;
  /** Value with no itemized positions — run by Wealthsimple's robo. */
  managed: boolean;
  /** Individual accounts behind the rollup (drill-down). Absent on snapshots
   *  taken before the field existed. `name` is the user's own in-app label —
   *  SnapTrade exposes no Wealthsimple nicknames, so we keep our own. */
  accounts?: { id: string; last4: string; total: number; cash: number; name?: string | null }[];
}

export interface PortfolioResponse {
  connection: { status: string; lastSyncedAt: number | null } | null;
  latestSnapshot: {
    totalValue: number;
    cashValue: number;
    /** Array of groups on new snapshots; legacy snapshots carry the old
     *  fixed-bucket object — render code must Array.isArray-guard. */
    accounts: AccountGroup[] | Record<string, number>;
  } | null;
  holdings: Holding[];
  snapshotHistory: PortfolioSnapshot[];
  recentTransactions: unknown[];
}

export function usePortfolio() {
  return useQuery({
    queryKey: ["portfolio"],
    queryFn: () => api.get<PortfolioResponse>("/api/portfolio"),
    refetchInterval: 15 * 60 * 1000,
  });
}

export function useSyncPortfolio() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post("/api/snaptrade/sync"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["portfolio"] }),
  });
}

/** Name one Wealthsimple account in-app (empty name clears it). */
export function useRenameAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { accountId: string; name: string }) =>
      api.patch("/api/snaptrade/account-name", vars),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["portfolio"] }),
  });
}

export function useOHLCV(ticker: string, range: string) {
  const intraday = range === "1d" || range === "5d";
  return useQuery({
    queryKey: ["ohlcv", ticker, range],
    queryFn: () =>
      api.get<{ bars: OHLCVBar[]; unavailable?: boolean; stale?: boolean }>(
        `/api/market/ohlcv?ticker=${ticker}&range=${range}`
      ),
    // Intraday bars move within the day (server caches 15 min); history doesn't.
    staleTime: intraday ? 15 * 60 * 1000 : 24 * 60 * 60 * 1000,
  });
}

export interface OHLCVBar {
  time: string | number; // ISO date for daily/weekly, unix seconds for intraday
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}
