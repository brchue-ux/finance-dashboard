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

export interface PortfolioResponse {
  connection: { status: string; lastSyncedAt: number | null } | null;
  latestSnapshot: {
    totalValue: number;
    cashValue: number;
    accounts: { tfsa: number; rrsp: number; non_reg: number; crypto: number };
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

export function useOHLCV(ticker: string, range: string) {
  return useQuery({
    queryKey: ["ohlcv", ticker, range],
    queryFn: () =>
      api.get<{ bars: OHLCVBar[]; unavailable?: boolean; stale?: boolean }>(
        `/api/market/ohlcv?ticker=${ticker}&range=${range}`
      ),
    staleTime: 24 * 60 * 60 * 1000, // 24 hours
  });
}

export interface OHLCVBar {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}
