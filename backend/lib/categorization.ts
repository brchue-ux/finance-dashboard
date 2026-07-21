/**
 * Transaction categorization engine.
 *
 * On each transaction write:
 * 1. Normalize the raw description (uppercase, strip branch codes/suffixes).
 * 2. Test against each active envelope's category_rules in sort_order.
 * 3. First match wins → return the envelope name.
 * 4. No match → return "uncategorized".
 *
 * Accuracy is paramount — false positives (over-categorized) are preferred
 * over false negatives (uncategorized) because uncategorized txns degrade
 * LLM budget advice quality.
 */

/**
 * The category a transaction carries when no envelope claims it. Exported
 * because it is a value other modules must agree on exactly — a manual
 * assignment can clear a category back to it, and the budget totals treat it
 * as unattributed spend rather than as an envelope.
 */
export const UNCATEGORIZED = "uncategorized";

export interface Envelope {
  name: string;
  categoryRules: string[]; // array of keyword/merchant strings
  sortOrder: number;
}

/**
 * Normalizes raw bank description for matching.
 * Strips trailing branch codes (e.g. "#1234"), common suffixes, and lowercases.
 */
export function normalizeDescription(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/#\d+/g, "")         // strip branch/location codes
    .replace(/\s{2,}/g, " ")      // collapse whitespace
    .trim();
}

/**
 * Reduces a string to space-separated alphanumeric tokens, so punctuation
 * differences can't defeat a match: "A & W" and "A&W" both become "A W".
 */
function tokenize(s: string): string {
  return s
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

/**
 * True if `rule` matches `description`. Two passes, because banks render the
 * same merchant inconsistently and each pass fixes a different failure:
 *
 *  1. Token match — the rule's tokens appear as whole tokens in the
 *     description. This is punctuation-insensitive ("A&W" vs "A & W") while
 *     still respecting word boundaries, so "BELL" does NOT match "BELLIES".
 *  2. Concatenated match — only for multi-word rules of reasonable length,
 *     covering merchants written without the space ("UBER EATS" vs "UBEREATS").
 *     Gated on length because a short collapsed rule ("A&W" -> "AW") would
 *     match inside unrelated words.
 */
const MIN_CONCAT_LEN = 5;

function ruleMatches(rule: string, tokenizedDescription: string): boolean {
  const core = tokenize(rule);
  if (!core) return false;

  if ((" " + tokenizedDescription + " ").includes(" " + core + " ")) return true;

  const collapsed = core.replace(/ /g, "");
  if (core.includes(" ") && collapsed.length >= MIN_CONCAT_LEN) {
    return tokenizedDescription.replace(/ /g, "").includes(collapsed);
  }
  return false;
}

/**
 * Returns the envelope name that matches, or "uncategorized".
 *
 * The most SPECIFIC rule wins, measured as the length of the rule's normalized
 * core — not the first rule found by envelope sort order.
 *
 * Why: a merchant that matches two envelopes is almost always a general rule
 * and a more precise one describing a subset of it, and the precise one is the
 * right answer regardless of which envelope happens to sort first. Two of these
 * are live in real data:
 *
 *   "UBER CANADA/UBEREATS TORONTO"  Restaurants "UBER EATS" vs Transport "UBER"
 *   "CANADIAN TIRE #118 WELLAND"    Home & Hardware "CANADIAN TIRE"
 *                                   vs Transport "CANADIAN TIRE GAS"
 *
 * Under first-match-wins both resolved correctly only because Restaurants and
 * Transport happened to sort where they did. Reordering envelopes in the UI —
 * an ordinary thing to do, sortOrder is user-editable — would silently have
 * filed every Uber Eats order under Transport. Nothing would have surfaced it;
 * the transactions would just have been in the wrong envelope.
 *
 * Sort order still decides genuine ties, so equally-specific rules behave
 * exactly as before. This also retires the positional workaround that kept
 * "TACO BELL" ahead of Utilities' "BELL " — token matching already prevents
 * that collision, and specificity now covers the ordering concern too.
 */
export function categorize(
  description: string,
  envelopes: Envelope[]
): string {
  const haystack = tokenize(normalizeDescription(description));

  const sorted = [...envelopes].sort((a, b) => a.sortOrder - b.sortOrder);

  let best: { name: string; specificity: number } | null = null;

  for (const envelope of sorted) {
    for (const rule of envelope.categoryRules) {
      if (!ruleMatches(rule, haystack)) continue;

      // Length of the normalized core, so "UBER EATS" (9) beats "UBER" (4).
      // Measured post-tokenize so punctuation and spacing in the authored rule
      // do not inflate it — "A&W" and "A & W" are equally specific.
      const specificity = tokenize(rule).length;

      // Strictly greater: the first envelope in sort order wins a tie, which
      // preserves the previous behaviour exactly for equally-specific rules.
      if (!best || specificity > best.specificity) {
        best = { name: envelope.name, specificity };
      }
    }
  }

  return best?.name ?? UNCATEGORIZED;
}

/**
 * Default Canadian merchant rules shipped at launch.
 * These seed the budget_envelopes.category_rules column.
 */
export const DEFAULT_RULES: Record<string, string[]> = {
  Groceries: [
    "LOBLAWS", "METRO", "SOBEYS", "FRESHCO", "NOFRILLS", "NO FRILLS",
    "FOOD BASICS", "WALMART GROCERY", "COSTCO", "FARM BOY", "WHOLE FOODS",
    "SUPERSTORE", "REAL CANADIAN", "MAXI", "IGA", "PROVIGO",
  ],
  Restaurants: [
    "TIM HORTONS", "TIMS", "STARBUCKS", "SECOND CUP",
    "MCDONALD", "BURGER KING", "WENDY", "SUBWAY", "A&W",
    "PIZZA PIZZA", "DOMINO", "HARVEYS", "SWISS CHALET",
    // Ahead of Utilities' "BELL" rule, which otherwise claims it on sort order.
    "TACO BELL",
    "DOORDASH", "UBER EATS", "SKIP THE DISHES", "SKIPTHEDISHES",
  ],
  Transport: [
    "TTC", "PRESTO", "OC TRANSPO", "TRANSLINK", "STM",
    "UBER", "LYFT", "TAXI", "CAB",
    "PETRO-CANADA", "PETROCAN", "ESSO", "SHELL", "SUNOCO",
    "CANADIAN TIRE GAS", "PARKING",
  ],
  Utilities: [
    "HYDRO", "ENBRIDGE", "ROGERS", "BELL ", "TELUS",
    "FIDO", "KOODO", "VIRGIN MOBILE", "LUCKY MOBILE",
    "INTERNET", "NETFLIX", "SPOTIFY", "APPLE.COM",
  ],
  Shopping: [
    "AMAZON", "AMAZON.CA", "SHOPIFY", "BEST BUY",
    "THE BAY", "HUDSON BAY", "WINNERS", "MARSHALLS",
    "H&M", "ZARA", "ARITZIA", "UNIQLO",
  ],
  Healthcare: [
    "SHOPPERS DRUG", "REXALL", "LONDON DRUGS", "PHARMACY",
    "DENTAL", "OPTOM", "PHYSIOTHERAPY", "WALK-IN",
  ],
  Entertainment: [
    "CINEPLEX", "AMC", "STEAMCMD", "STEAM ", "STEAMGAMES", "PLAYSTATION",
    "XBOX", "NINTENDO", "TICKETMASTER", "EVENTBRITE",
  ],
};
