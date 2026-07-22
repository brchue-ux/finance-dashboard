/**
 * Envelope groups — the parent tiles the budget tab collapses to.
 *
 * Sixteen flat category cards is too much to scan. Categories roll up into a
 * few parent groups shown as tiles (a high-level summary each); tapping a tile
 * zooms into that group's categories. Group membership is a plain label on the
 * envelope (schema `group_name`), so it is fully user-editable — this map is
 * only the PROPOSED starting assignment, in keeping with propose-don't-impose.
 */

/** Fallback tile for any category with no group set. */
export const UNGROUPED = "Ungrouped";

/**
 * Display order for the tiles. Groups not listed here (a user's own) sort after
 * these alphabetically; UNGROUPED always sorts last.
 */
export const GROUP_ORDER = ["Essentials", "Home & Health", "Lifestyle", "Family & Travel"];

/**
 * Proposed group for each default category. Applied when seeding default
 * envelopes and offered as the starting grouping for the existing set; the user
 * reassigns freely afterward.
 */
export const DEFAULT_ENVELOPE_GROUPS: Record<string, string> = {
  Groceries: "Essentials",
  Utilities: "Essentials",
  Transport: "Essentials",
  Insurance: "Essentials",
  "Home Services": "Essentials",
  "Fees & Interest": "Essentials",

  "Home & Hardware": "Home & Health",
  Healthcare: "Home & Health",
  "Personal Care": "Home & Health",

  Restaurants: "Lifestyle",
  Entertainment: "Lifestyle",
  Shopping: "Lifestyle",
  Cannabis: "Lifestyle",

  "Kids & Activities": "Family & Travel",
  "Fitness & Recreation": "Family & Travel",
  Travel: "Family & Travel",
};

/** Sort comparator for group names: GROUP_ORDER first, then A–Z, UNGROUPED last. */
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
