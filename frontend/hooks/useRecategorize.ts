import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export interface RecategorizeResponse {
  ok: true;
  id: string;
  category: string;
  categorySource: "manual";
  previousCategory: string | null;
}

/**
 * Set one transaction's category by hand (build-reminders 6a).
 *
 * Invalidates the same four queries as a split, and for the same reason:
 * moving a transaction between envelopes changes budget totals and report
 * series, so a stale cache would show the row in its new envelope while the
 * envelope's spent figure still reflects the old one.
 */
export function useRecategorize() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ transactionId, category }: { transactionId: string; category: string }) =>
      api.patch<RecategorizeResponse>(`/api/transactions/${transactionId}`, { category }),
    onSuccess: (_data, { transactionId }) => {
      qc.invalidateQueries({ queryKey: ["budget"] });
      qc.invalidateQueries({ queryKey: ["reports"] });
      qc.invalidateQueries({ queryKey: ["account-transactions"] });
      qc.invalidateQueries({ queryKey: ["splits", transactionId] });
    },
  });
}
