import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Transaction } from "@/hooks/useBudget";

/**
 * One row from GET /api/banks. Mirrors the backend contract
 * (backend/app/api/banks/route.ts). Balances are raw — masking is a frontend
 * concern (spec §9 Banks). connectionStatus is "manual" for CSV/manual
 * accounts (no connection row) and "unknown" if a connection lacks a status.
 */
export interface BankAccount {
  id: string;
  name: string;
  type: string; // depository | credit | manual | …
  mask: string | null;
  institution: string;
  balanceCurrent: number | null;
  balanceAvailable: number | null;
  balanceLimit: number | null;
  isoCurrencyCode: string | null;
  connectionStatus: string;
  lastSyncedAt: number | null;
}

export function useBanks() {
  return useQuery({
    queryKey: ["banks"],
    queryFn: () => api.get<{ accounts: BankAccount[] }>("/api/banks"),
    refetchInterval: 15 * 60 * 1000,
    select: (data) => data.accounts,
  });
}

/**
 * Per-account transaction history (GET /api/banks/:id/transactions). Rows are
 * full transaction records; typed to the shared Transaction shape TransactionFeed
 * renders (the extra Plaid-enrichment columns are simply unused here).
 */
export interface AccountTransactionsResponse {
  accountId: string;
  accountName: string;
  transactions: Transaction[];
  limit: number;
  offset: number;
  hasMore: boolean;
}

export function useAccountTransactions(accountId: string, limit = 100, highlight?: string) {
  return useQuery({
    queryKey: ["account-transactions", accountId, limit, highlight ?? null],
    queryFn: () =>
      api.get<AccountTransactionsResponse>(
        `/api/banks/${accountId}/transactions?limit=${limit}` +
          // The server serves the page CONTAINING this row, however old it is.
          (highlight ? `&highlight=${encodeURIComponent(highlight)}` : "")
      ),
    enabled: !!accountId,
  });
}
