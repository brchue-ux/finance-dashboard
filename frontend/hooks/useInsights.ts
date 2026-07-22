import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useLLMCards,
  useForceReanalyze,
  useApplyReallocation,
  type LLMCard,
} from "@/hooks/useBudget";

const RESOLVED_KEY = (view: string) => ["resolved-cards", view];

/**
 * Everything the Claude cards need, in one place — so the budget tab's pinned
 * card and the full Insights screen behave identically and, crucially, agree on
 * which cards are still open.
 *
 * The "already acted on" set lives in the react-query cache (not component
 * state) so it is shared across routes: dismiss a card on the Insights screen
 * and it stops being pinned on the budget tab, and vice versa. It is
 * session-scoped and never persisted — a re-analysis clears it.
 */
export function useInsights(view: "budget" | "portfolio", year: number, month: number) {
  const qc = useQueryClient();
  const llmQuery = useLLMCards(view);
  const reanalyze = useForceReanalyze(view);
  const applyReallocation = useApplyReallocation(year, month);

  const { data: resolved = [] } = useQuery<string[]>({
    queryKey: RESOLVED_KEY(view),
    queryFn: () => [],
    staleTime: Infinity,
    initialData: [],
  });
  const resolve = (title: string) =>
    qc.setQueryData<string[]>(RESOLVED_KEY(view), (prev = []) =>
      prev.includes(title) ? prev : [...prev, title]
    );
  const resetResolved = () => qc.setQueryData<string[]>(RESOLVED_KEY(view), []);

  const [cardErrors, setCardErrors] = useState<Record<string, string>>({});
  const [flash, setFlash] = useState<string | null>(null);

  const visibleCards = (llmQuery.data?.cards ?? []).filter((c) => !resolved.includes(c.title));

  async function onApprove(card: LLMCard) {
    setCardErrors((e) => ({ ...e, [card.title]: "" }));
    try {
      const res = await applyReallocation.mutateAsync(card);
      // Only hide the card once the write succeeded — hiding on tap would make a
      // rejected reallocation look applied. The mutation invalidates the budget
      // query on success, so no manual refetch is needed here.
      resolve(card.title);
      setFlash(
        `Moved $${res.amount.toFixed(2)} from ${res.from.name} ($${res.from.after.toFixed(0)} left budgeted) to ${res.to.name} ($${res.to.after.toFixed(0)}).`
      );
    } catch (err) {
      setCardErrors((e) => ({
        ...e,
        [card.title]: err instanceof Error ? err.message : "Couldn't apply that change.",
      }));
    }
  }

  function onDismiss(card: LLMCard) {
    resolve(card.title);
  }

  function onReanalyze() {
    // A fresh analysis supersedes every prior verdict.
    resetResolved();
    setCardErrors({});
    setFlash(null);
    reanalyze.mutate();
  }

  return {
    llmQuery,
    reanalyze,
    visibleCards,
    cardErrors,
    flash,
    busyTitle: applyReallocation.isPending ? applyReallocation.variables?.title ?? null : null,
    onApprove,
    onDismiss,
    onReanalyze,
  };
}

/**
 * The single card to pin on the budget tab: a ready-to-apply reallocation
 * ("trim") if one is pending — it is actionable and worth surfacing first —
 * otherwise the top card in the backend's own order.
 */
export function topCard(cards: LLMCard[]): LLMCard | null {
  const trim = cards.find(
    (c) =>
      c.type === "action" &&
      !!c.envelope_from &&
      !!c.envelope_to &&
      Number.isFinite(c.amount) &&
      (c.amount ?? 0) > 0
  );
  return trim ?? cards[0] ?? null;
}
