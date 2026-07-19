import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

/**
 * Deterministic reports (GET /api/reports). Mirrors the backend contract
 * (backend/app/api/reports/route.ts). All series are computed from local data
 * — no LLM, no external feed. History cannot be backfilled (net worth starts
 * the day capture began).
 */
export interface NetWorthPoint {
  date: string; // YYYY-MM-DD
  bank: number; // deposits − credit owed
  portfolio: number;
  total: number;
}

export interface CategoryTrendMonth {
  month: string; // YYYY-MM
  categories: Record<string, number>; // category → spend (positive dollars)
}

export interface IncomeExpenseMonth {
  month: string; // YYYY-MM
  income: number;
  expenses: number;
  net: number;
}

export interface ReportsResponse {
  netWorth: NetWorthPoint[];
  categoryTrends: CategoryTrendMonth[];
  incomeVsExpenses: IncomeExpenseMonth[];
}

export function useReports(months = 12) {
  return useQuery({
    queryKey: ["reports", months],
    queryFn: () => api.get<ReportsResponse>(`/api/reports?months=${months}`),
    staleTime: 5 * 60 * 1000,
  });
}
