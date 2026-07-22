/**
 * Turning one manual correction into a proposed rule — the core of the
 * learning loop (build-reminders 6b).
 *
 * When a user re-files a transaction by hand (6a), the app can offer to make it
 * a standing rule so the next one lands right on its own. The hard part is not
 * saving the rule; it is choosing WHAT the rule should match, and that boundary
 * genuinely cannot be inferred:
 *
 *   "AMZN MKTP CA*A1B2C3"      one merchant, many orders — the whole string
 *                              minus the order id is the right pattern
 *   "Bill Payment - CITY OF WELLAND"   the "Bill Payment" prefix alone covers
 *                              nine unrelated payees; only the payee is the rule
 *   "TIM HORTONS WELLAND"      the town is incidental — the user may want every
 *                              Tim Hortons, or only this one
 *
 * So this module does not decide the boundary. It proposes the safest default —
 * the normalized description, which is narrow — and then reports, for any
 * candidate pattern the user widens or narrows to, exactly what it would catch
 * and where those rows currently sit. The count is the safety check the user
 * approves against; `byCurrentCategory` is what makes it a real one, because it
 * distinguishes "fills 9 uncategorized rows" from "pulls 3 rows out of
 * Restaurants where they already belong."
 *
 * Pure and corpus-driven: the caller supplies the user's transactions, so this
 * is testable without a database and shares its matching with `categorize` via
 * `ruleCatches` — the preview cannot promise a catch the real engine won't make.
 */
import { normalizeDescription, ruleCatches, UNCATEGORIZED } from "@/lib/categorization";

/** A user transaction, reduced to the two fields a preview needs. */
export interface CorpusRow {
  description: string;
  /** The envelope it currently sits in, or null/uncategorized if none. */
  category: string | null;
}

export interface PatternPreview {
  /** How many corpus rows this pattern matches. */
  catches: number;
  /**
   * Of the caught rows, how many sit in each current category. The key is the
   * envelope name, or UNCATEGORIZED for rows with no category. This is the
   * safety signal: a pattern whose catches are all UNCATEGORIZED only fills
   * gaps, while one that catches rows already in another envelope would move
   * them, which the user should see before approving.
   */
  byCurrentCategory: Record<string, number>;
  /**
   * Up to SAMPLE_LIMIT distinct raw descriptions the pattern catches, so the UI
   * can show what is actually being swept in rather than only a number.
   */
  samples: string[];
}

export interface RuleProposal extends PatternPreview {
  /** The pattern the user is invited to accept, widen, or narrow. */
  pattern: string;
}

const SAMPLE_LIMIT = 5;

/**
 * Report what `pattern` would catch across `corpus`. The one function both the
 * default proposal and any widen/narrow re-preview go through, so every count
 * the user sees is produced the same way.
 *
 * An empty or whitespace-only pattern catches nothing: `ruleCatches` already
 * refuses it, and returning a zero preview keeps a half-typed box from claiming
 * it would sweep the entire history.
 */
export function previewPattern(pattern: string, corpus: CorpusRow[]): PatternPreview {
  const byCurrentCategory: Record<string, number> = {};
  const samples: string[] = [];
  const seen = new Set<string>();
  let catches = 0;

  for (const row of corpus) {
    if (!ruleCatches(pattern, row.description)) continue;
    catches++;

    const current = row.category?.trim() ? row.category : UNCATEGORIZED;
    byCurrentCategory[current] = (byCurrentCategory[current] ?? 0) + 1;

    if (samples.length < SAMPLE_LIMIT && !seen.has(row.description)) {
      seen.add(row.description);
      samples.push(row.description);
    }
  }

  return { catches, byCurrentCategory, samples };
}

/**
 * Propose a rule from a just-corrected transaction. The default pattern is the
 * corrected row's normalized description — the same normalization the matcher
 * uses, so store codes and order ids are already gone, and deliberately narrow:
 * a pattern that is too tight catches only rows the user would have wanted
 * caught anyway, while one that is too loose quietly re-files unrelated
 * spending. Widening is a visible choice the user makes against the count;
 * over-broad is not a default we impose.
 *
 * The proposal always includes the correcting transaction's own description in
 * the corpus reflection, so `catches` is never zero for the row that triggered
 * it — a proposal that appeared to catch nothing would read as broken.
 */
export function proposeRule(correctedDescription: string, corpus: CorpusRow[]): RuleProposal {
  const pattern = normalizeDescription(correctedDescription);
  return { pattern, ...previewPattern(pattern, corpus) };
}
