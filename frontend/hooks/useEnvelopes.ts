import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export interface Envelope {
  id: string;
  name: string;
  monthlyTarget: number;
  categoryRules: string[];
  active: boolean;
  sortOrder: number;
  /** Parent group tile; null = Ungrouped. */
  groupName?: string | null;
  createdAt: number;
}

export function useEnvelopes() {
  return useQuery({
    queryKey: ["envelopes"],
    queryFn: () => api.get<{ envelopes: Envelope[] }>("/api/budget/envelopes"),
  });
}

/** Budget totals are derived from envelopes, so both caches must drop together. */
function useEnvelopeMutation<TArgs>(fn: (args: TArgs) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["envelopes"] });
      qc.invalidateQueries({ queryKey: ["budget"] });
    },
  });
}

export function useCreateEnvelope() {
  return useEnvelopeMutation((body: {
    name: string;
    monthlyTarget: number;
    categoryRules: string[];
  }) => api.post("/api/budget/envelopes", body));
}

export function useUpdateEnvelope() {
  return useEnvelopeMutation(
    ({ id, ...body }: { id: string } & Partial<Omit<Envelope, "id" | "createdAt">>) =>
      api.patch(`/api/budget/envelopes/${id}`, body)
  );
}

export function useDeleteEnvelope() {
  return useEnvelopeMutation((id: string) => api.del(`/api/budget/envelopes/${id}`));
}

export function useSeedDefaultEnvelopes() {
  return useEnvelopeMutation(() => api.post("/api/budget/envelopes/defaults"));
}

/**
 * Re-derives categories for stored transactions. Needed after editing rules,
 * since categorization otherwise only runs when a transaction is written.
 */
export function useRecategorize() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (onlyUncategorized: boolean) =>
      api.post<{ scanned: number; updated: number; byCategory: Record<string, number> }>(
        "/api/budget/recategorize",
        { onlyUncategorized }
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["budget"] }),
  });
}
