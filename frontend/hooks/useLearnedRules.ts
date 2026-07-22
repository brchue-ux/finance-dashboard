import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

/**
 * The learning loop's client side (build-reminders 6b).
 *
 * A learned rule is a correction the user promotes to a standing rule. Preview
 * is the read side — what would this pattern catch, and where do those rows sit
 * now — and save is the write side, which also re-files matching history. Both
 * shapes mirror the server's exactly.
 */
export interface RulePreview {
  pattern: string;
  catches: number;
  /** Envelope name (or "uncategorized") → how many caught rows sit there now. */
  byCurrentCategory: Record<string, number>;
  samples: string[];
}

export interface SaveLearnedRuleResponse extends RulePreview {
  ok: true;
  id: string;
  category: string;
  /** How many rows actually changed — manual and split rows are left alone. */
  refiled: number;
}

/** One saved learned rule, as the management list shows it. */
export interface LearnedRule {
  id: string;
  pattern: string;
  category: string;
  learnedFromTransactionId: string | null;
  catchesAtCreation: number | null;
  createdAt: number;
}

/** The user's saved rules, newest first. */
export function useLearnedRulesList() {
  return useQuery({
    queryKey: ["learned-rules"],
    queryFn: () => api.get<{ rules: LearnedRule[] }>("/api/budget/learned-rules"),
  });
}

/**
 * Delete a learned rule. Undoing is not just forgetting the rule: the server
 * re-derives the rows it had captured without it, so budget/report/feed caches
 * move exactly as they did on save.
 */
export function useDeleteLearnedRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.del<{ ok: true; deleted: string; refiled: number }>(`/api/budget/learned-rules/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["budget"] });
      qc.invalidateQueries({ queryKey: ["reports"] });
      qc.invalidateQueries({ queryKey: ["account-transactions"] });
      qc.invalidateQueries({ queryKey: ["learned-rules"] });
    },
  });
}

/**
 * Preview a rule. Pass `{ transactionId }` for the default proposal off a
 * just-corrected row, or `{ pattern }` while the user widens or narrows it.
 * A mutation, not a query, because it is driven by typing rather than by a key.
 */
export function useLearnedRulePreview() {
  return useMutation({
    mutationFn: (body: { transactionId: string } | { pattern: string }) =>
      api.post<RulePreview>("/api/budget/learned-rules/preview", body),
  });
}

/**
 * Save a learned rule. Invalidates the same queries a recategorize does: saving
 * re-files matching rows, so budget totals, report series and account feeds all
 * move, and a stale cache would show a row in its new envelope while the
 * envelope's spent figure still reflects the old one.
 */
export function useSaveLearnedRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      pattern: string;
      category: string;
      learnedFromTransactionId?: string;
    }) => api.post<SaveLearnedRuleResponse>("/api/budget/learned-rules", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["budget"] });
      qc.invalidateQueries({ queryKey: ["reports"] });
      qc.invalidateQueries({ queryKey: ["account-transactions"] });
      qc.invalidateQueries({ queryKey: ["learned-rules"] });
    },
  });
}
