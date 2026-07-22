import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export interface SavedTransferPattern {
  id: string;
  pattern: string;
  catchesAtCreation: number | null;
  currentMatches: number;
}

export interface TransferPatternSuggestion {
  pattern: string;
  why: string;
  /** Unmarked rows approval would mark right now. */
  wouldMark: number;
  /** Matching rows already marked (script or another pattern). */
  alreadyMarked: number;
}

export function useTransferPatterns() {
  return useQuery({
    queryKey: ["transfer-patterns"],
    queryFn: () =>
      api.get<{ patterns: SavedTransferPattern[]; suggestions: TransferPatternSuggestion[] }>(
        "/api/transfers/patterns"
      ),
  });
}

/** Saving retro-marks matching rows, so every money figure changes — refetch both. */
function invalidate(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ["transfer-patterns"] });
  qc.invalidateQueries({ queryKey: ["budget"] });
}

export function useSaveTransferPattern() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (pattern: string) =>
      api.post<{ ok: true; marked: number }>("/api/transfers/patterns", { pattern }),
    onSuccess: () => invalidate(qc),
  });
}

export function useDeleteTransferPattern() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.del<{ ok: true; unmarked: number }>(`/api/transfers/patterns/${id}`),
    onSuccess: () => invalidate(qc),
  });
}
