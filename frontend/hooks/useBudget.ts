import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export interface BudgetEnvelope {
  id: string;
  name: string;
  monthlyTarget: number;
  allocated: number;
  spent: number;
  remaining: number;
  overBudget: boolean;
  /** No monthly target set yet — distinct from "budgeted $0 and overspent". */
  unconfigured: boolean;
  categoryRules: string[];
  sortOrder: number;
}

export interface BudgetSummary {
  /** Spend that reached an envelope. Less than totalOutflow whenever
   *  categorization coverage is incomplete. */
  totalSpent: number;
  /** Spend that reached no envelope — uncategorized, or a category naming
   *  none. Invisible in the envelope grid, which is why it is surfaced. */
  unattributedSpent: number;
  /** Every dollar that left this month: totalSpent + unattributedSpent. */
  totalOutflow: number;
  totalAllocated: number;
  totalIncome: number;
  remaining: number;
  saved: number;
  configuredEnvelopes: number;
  totalEnvelopes: number;
}

/** One notable transaction — a single spend consuming >= 15% of its envelope. */
export interface NotableTransaction {
  id: string;
  accountId: string;
  date: string;
  description: string;
  merchantName: string | null;
  amount: number;
  shareOfAllocation: number;
}

/** Notable transactions grouped by envelope; backend caps at 3 per category. */
export interface NotableCategory {
  category: string;
  allocated: number;
  transactions: NotableTransaction[];
}

export interface BudgetResponse {
  year: number;
  month: number;
  envelopes: BudgetEnvelope[];
  transactions: Transaction[];
  notableTransactions: NotableCategory[];
  summary: BudgetSummary;
  bankConnections: { institution: string; status: string; lastSyncedAt: number | null }[];
}

export interface Transaction {
  id: string;
  date: string;
  description: string;
  merchantName: string | null;
  amount: number;
  category: string | null;
  pending: number;
  /** Present when the transaction is split — the categories its amount is
   *  divided across. Null/absent when it is a single ordinary transaction. */
  splitCategories?: string[] | null;
}

export function useBudget(year: number, month: number) {
  return useQuery({
    queryKey: ["budget", year, month],
    queryFn: () =>
      api.get<BudgetResponse>(`/api/budget?year=${year}&month=${month}`),
    refetchInterval: 15 * 60 * 1000, // 15 min polling
  });
}

export function useSyncBudget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post("/api/plaid/sync"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["budget"] }),
  });
}

export interface LLMCardsResponse {
  cards: LLMCard[];
  lastAnalyzedAt: number;
  cached: boolean;
  /** Server is regenerating behind this response; poll until it clears. */
  refreshing: boolean;
}

/**
 * The server answers from cache immediately and regenerates behind it, so this
 * only blocks on a true cold start. While `refreshing` is set we poll, then
 * stop as soon as fresh cards land — the user sees the old cards the whole
 * time rather than a spinner.
 */
export function useLLMCards(view: "budget" | "portfolio") {
  return useQuery({
    queryKey: ["llm-cards", view],
    queryFn: () => api.post<LLMCardsResponse>("/api/llm/analyze", { view }),
    staleTime: Infinity, // regeneration is decided server-side, not by staleTime
    refetchInterval: (query) => (query.state.data?.refreshing ? 5000 : false),
  });
}

export function useForceReanalyze(view: "budget" | "portfolio") {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<LLMCardsResponse>("/api/llm/analyze", { view, force: true }),
    // Seed the cache with the response so polling starts from the refreshing
    // flag this call just set, instead of racing an invalidate/refetch.
    onSuccess: (data) => qc.setQueryData(["llm-cards", view], data),
  });
}

export interface LLMCard {
  type: "insight" | "action";
  title: string;
  body: string;
  reasoning: string;
  envelope_from?: string;
  envelope_to?: string;
  amount?: number;
}

export interface ReallocationApplied {
  ok: true;
  year: number;
  month: number;
  amount: number;
  from: { envelopeId: string; name: string; before: number; after: number };
  to: { envelopeId: string; name: string; before: number; after: number };
}

/**
 * Applies an LLM action card's proposed envelope reallocation for one month.
 * The backend re-resolves the card's envelope names against real envelopes, so
 * a stale or hallucinated card fails with a message rather than writing.
 */
export function useApplyReallocation(year: number, month: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (card: LLMCard) =>
      api.post<ReallocationApplied>("/api/budget/allocations/reallocate", {
        year,
        month,
        envelope_from: card.envelope_from,
        envelope_to: card.envelope_to,
        amount: card.amount,
      }),
    // Allocations change every envelope's remaining/overBudget, so the whole
    // budget query is refetched rather than patched.
    onSuccess: () => qc.invalidateQueries({ queryKey: ["budget"] }),
  });
}
