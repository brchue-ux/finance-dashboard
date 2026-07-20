import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export interface Split {
  id?: string;
  category: string;
  amount: number;
  note?: string | null;
}

export interface SplitsResponse {
  transactionAmount: number;
  splits: Split[];
}

export function useSplits(transactionId: string, enabled = true) {
  return useQuery({
    queryKey: ["splits", transactionId],
    queryFn: () => api.get<SplitsResponse>(`/api/transactions/${transactionId}/splits`),
    enabled: enabled && Boolean(transactionId),
  });
}

/** Splits change envelope attribution, so budget and reports must both refetch. */
function useSplitMutation<TArgs>(transactionId: string, fn: (a: TArgs) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["splits", transactionId] });
      qc.invalidateQueries({ queryKey: ["budget"] });
      qc.invalidateQueries({ queryKey: ["reports"] });
      qc.invalidateQueries({ queryKey: ["account-transactions"] });
    },
  });
}

/** Replaces the whole set — the sum invariant is only valid across all parts. */
export function useSaveSplits(transactionId: string) {
  return useSplitMutation(transactionId, (splits: Split[]) =>
    api.put(`/api/transactions/${transactionId}/splits`, { splits })
  );
}

export function useClearSplits(transactionId: string) {
  return useSplitMutation(transactionId, () =>
    api.del(`/api/transactions/${transactionId}/splits`)
  );
}
