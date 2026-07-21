/**
 * Resolving a user-submitted category name to an envelope.
 *
 * `transactions.category` stores the envelope *name*, not its id (the same
 * choice that made the rename bug possible — see `4a5d345`). That makes the
 * exact string load-bearing: "groceries" and "Groceries" are different
 * categories to every budget query, so storing whatever the user typed would
 * silently fragment an envelope's totals in a way that looks like the money
 * disappeared.
 *
 * So a submitted name is untrusted input. It is matched case- and
 * whitespace-insensitively (the same rule `reallocate.ts` applies to
 * model-authored envelope names) and the envelope's *own* spelling is what
 * gets written.
 *
 * Pure and envelope-list-driven so it can be tested without a database, and so
 * the caller decides what "the user's envelopes" means — this only ever sees
 * the active ones.
 */
import { UNCATEGORIZED } from "@/lib/categorization";

export type CategoryAssignment =
  | { ok: true; category: string }
  | { ok: false; error: string };

/**
 * @param submitted raw value off the request body — any type
 * @param envelopes the user's ACTIVE envelopes; an inactive one must not be a
 *        valid target, or a user could file spend into an envelope that no
 *        longer appears in their budget
 */
export function resolveCategoryAssignment(
  submitted: unknown,
  envelopes: { name: string }[]
): CategoryAssignment {
  if (typeof submitted !== "string") {
    return { ok: false, error: "category must be a string" };
  }

  const trimmed = submitted.trim();
  if (trimmed === "") {
    return { ok: false, error: "category must not be empty" };
  }

  const key = trimmed.toLowerCase();

  const match = envelopes.find((e) => e.name.trim().toLowerCase() === key);
  if (match) return { ok: true, category: match.name };

  // Clearing an assignment is legitimate: a user who realises they mis-filed
  // something must be able to put it back in the review queue rather than
  // being forced to pick a wrong envelope. Checked after the envelope lookup
  // so an envelope actually named "Uncategorized" still wins its own name.
  if (key === UNCATEGORIZED) return { ok: true, category: UNCATEGORIZED };

  return {
    ok: false,
    error: `"${trimmed}" does not name one of your envelopes`,
  };
}
