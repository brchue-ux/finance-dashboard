/**
 * Envelope group grouping + roll-up for the budget tab's parent tiles.
 *
 * Mirrors the backend's group ordering (lib/budget/groups.ts) — the frontend
 * cannot import backend code, and this is only display ordering, so the small
 * duplication is deliberate. The roll-up here is pure UI math over the envelope
 * summaries the budget API already returns.
 */
import type { BudgetEnvelope } from "@/hooks/useBudget";

export const UNGROUPED = "Ungrouped";
export const GROUP_ORDER = ["Essentials", "Home & Health", "Lifestyle", "Family & Travel"];

/** GROUP_ORDER first, then A–Z, with Ungrouped always last. */
export function compareGroups(a: string, b: string): number {
  if (a === b) return 0;
  if (a === UNGROUPED) return 1;
  if (b === UNGROUPED) return -1;
  const ia = GROUP_ORDER.indexOf(a);
  const ib = GROUP_ORDER.indexOf(b);
  if (ia !== -1 && ib !== -1) return ia - ib;
  if (ia !== -1) return -1;
  if (ib !== -1) return 1;
  return a.localeCompare(b);
}

export interface GroupSummary {
  name: string;
  envelopes: BudgetEnvelope[];
  /** Sum of spend across the group's categories. */
  spent: number;
  /** Sum of budget across configured categories only. */
  allocated: number;
  /** Sum of straight-line spend expected by now (in-progress month). */
  expectedByNow: number;
  /** Fraction of the month elapsed (shared by all envelopes); null if unknown. */
  monthFraction: number | null;
  /** How many categories have a budget set. */
  configuredCount: number;
  /** How many are running over (over pace in-progress, over budget finished). */
  overCount: number;
}

/**
 * Buckets envelopes into their groups and rolls each group up. Groups are
 * returned in display order; empty groups don't appear.
 */
export function groupEnvelopes(envelopes: BudgetEnvelope[]): GroupSummary[] {
  const byGroup = new Map<string, BudgetEnvelope[]>();
  for (const env of envelopes) {
    const g = env.groupName || UNGROUPED;
    const list = byGroup.get(g);
    if (list) list.push(env);
    else byGroup.set(g, [env]);
  }

  const summaries: GroupSummary[] = [];
  for (const [name, envs] of byGroup) {
    let spent = 0;
    let allocated = 0;
    let expectedByNow = 0;
    let configuredCount = 0;
    let overCount = 0;
    let monthFraction: number | null = null;

    for (const e of envs) {
      spent += e.spent;
      if (e.monthFraction != null) monthFraction = e.monthFraction;
      if (e.unconfigured) continue;
      configuredCount += 1;
      allocated += e.allocated;
      if (e.expectedByNow != null) expectedByNow += e.expectedByNow;
      const over =
        e.expectedByNow != null && e.monthFraction != null && e.monthFraction < 1 && e.allocated > 0
          ? e.spent > e.expectedByNow * 1.1
          : e.overBudget;
      if (over) overCount += 1;
    }

    summaries.push({
      name,
      envelopes: envs,
      spent,
      allocated,
      expectedByNow,
      monthFraction,
      configuredCount,
      overCount,
    });
  }

  return summaries.sort((a, b) => compareGroups(a.name, b.name));
}
