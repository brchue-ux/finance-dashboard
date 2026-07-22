/**
 * Source-category analysis for imports (build-reminders item 7).
 *
 * A CSV that carries its own category column can import "cleanly" while most
 * rows land in categories that match no envelope — observed at 6 of 10
 * categories unmatched, so those rows contributed to no budget at all, behind
 * a 200 and a success message. Like the sign-inversion guard, the failure is
 * silent; unlike it, the rows aren't wrong, they're invisible.
 *
 * Two jobs live here, both pure so they can be tested without a database:
 *
 * - `analyzeSourceCategories` — what the preview endpoint reports BEFORE the
 *   commit: which of the file's categories resolve to an envelope, which
 *   don't (with row counts, biggest impact first), and a best-effort
 *   suggestion for each miss ("Dining" → Restaurants). Suggestions are
 *   proposals the user confirms, never silently applied — same principle as
 *   the 6b learning loop.
 *
 * - `resolveImportCategory` — the per-row decision at import time. A source
 *   category that matches an envelope modulo case/whitespace is stored under
 *   the envelope's OWN spelling ("groceries" verbatim would fragment
 *   Groceries' totals — the exact bug `resolveCategoryAssignment` exists to
 *   prevent, which the import path previously bypassed). A user-confirmed
 *   mapping wins over everything; an unmatched, unmapped category still
 *   imports verbatim, exactly as before — item 7 is a warning, not a gate.
 */
import { resolveCategoryAssignment } from "@/lib/budget/category-assignment";

export interface MatchedSourceCategory {
  source: string; // the file's spelling (first seen)
  envelope: string; // the envelope's own spelling it resolves to
  rows: number;
}

export interface UnmatchedSourceCategory {
  source: string;
  rows: number; // rows that would count toward no budget
  suggestion?: string; // an existing envelope's own name, if one looks close
}

export interface SourceCategoryAnalysis {
  matched: MatchedSourceCategory[];
  unmatched: UnmatchedSourceCategory[];
}

/**
 * Hand-picked near-misses that substring containment cannot see (no shared
 * text between "Dining" and "Restaurants"). Deliberately tiny: each entry is a
 * category name banks/budget apps actually export, mapped to a name in this
 * app's common envelope vocabulary. A synonym only fires when the user
 * actually HAS an envelope with the target name — this list proposes against
 * their set, it does not import a taxonomy.
 */
const SYNONYMS: Record<string, string> = {
  dining: "restaurants",
  "dining out": "restaurants",
  "food & drink": "restaurants",
  gas: "transport",
  fuel: "transport",
  auto: "transport",
  medical: "healthcare",
  food: "groceries",
};

const normalize = (s: string) => s.trim().toLowerCase();

/**
 * Best-effort envelope suggestion for a category no envelope matched.
 * Substring containment first ("Health" ⊂ "Healthcare", "Home & Hardware" ⊃
 * "Home"), then the synonym table. Both sides must be ≥ 3 chars for the
 * substring test — shorter strings contain by accident, not by meaning.
 */
export function suggestEnvelope(
  source: string,
  envelopes: { name: string }[]
): string | undefined {
  const key = normalize(source);

  if (key.length >= 3) {
    const contained = envelopes.find((e) => {
      const name = normalize(e.name);
      return name.length >= 3 && (name.includes(key) || key.includes(name));
    });
    if (contained) return contained.name;
  }

  const synonym = SYNONYMS[key];
  if (synonym) {
    const target = envelopes.find((e) => normalize(e.name) === synonym);
    if (target) return target.name;
  }

  return undefined;
}

/**
 * The preview: every distinct category in the file, split by whether it
 * resolves to an active envelope. Distinctness is case/whitespace-insensitive
 * (the same rule the resolver applies), keyed to the first spelling seen so
 * the report shows the user their own file's words. Unmatched come back
 * biggest-row-count first — the order the user should triage in.
 */
export function analyzeSourceCategories(
  rows: { category?: string }[],
  envelopes: { name: string }[]
): SourceCategoryAnalysis {
  const distinct = new Map<string, { source: string; rows: number }>();
  for (const row of rows) {
    if (!row.category) continue;
    const key = normalize(row.category);
    if (key === "") continue;
    const entry = distinct.get(key);
    if (entry) entry.rows++;
    else distinct.set(key, { source: row.category.trim(), rows: 1 });
  }

  const matched: MatchedSourceCategory[] = [];
  const unmatched: UnmatchedSourceCategory[] = [];
  for (const { source, rows: count } of distinct.values()) {
    const resolved = resolveCategoryAssignment(source, envelopes);
    if (resolved.ok) {
      matched.push({ source, envelope: resolved.category, rows: count });
    } else {
      const suggestion = suggestEnvelope(source, envelopes);
      unmatched.push({ source, rows: count, ...(suggestion ? { suggestion } : {}) });
    }
  }

  unmatched.sort((a, b) => b.rows - a.rows);
  return { matched, unmatched };
}

/**
 * The category one imported row gets when the file provided one.
 * Precedence: user-confirmed mapping → envelope resolution (stores the
 * envelope's own spelling) → verbatim (today's behaviour, now warned about).
 * `mapped` tells the caller to mark the row `category_source = "manual"` —
 * the mapping is the user's explicit choice and must survive a bulk
 * re-derive, same contract as a per-transaction correction.
 *
 * Mapping values are envelope names the ROUTE has already validated and
 * resolved to their own spelling; keys are matched normalized so the file's
 * casing can't dodge a mapping.
 */
export function resolveImportCategory(
  source: string,
  envelopes: { name: string }[],
  mappings: Record<string, string> = {}
): { category: string; mapped: boolean } {
  const mappedTo = mappings[normalize(source)];
  if (mappedTo !== undefined) return { category: mappedTo, mapped: true };

  const resolved = resolveCategoryAssignment(source, envelopes);
  if (resolved.ok) return { category: resolved.category, mapped: false };

  return { category: source.trim(), mapped: false };
}
