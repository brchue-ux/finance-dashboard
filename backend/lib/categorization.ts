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
 * Returns the envelope name that matches, or "uncategorized".
 */
export function categorize(
  description: string,
  envelopes: Envelope[]
): string {
  const normalized = normalizeDescription(description);

  const sorted = [...envelopes].sort((a, b) => a.sortOrder - b.sortOrder);

  for (const envelope of sorted) {
    for (const rule of envelope.categoryRules) {
      if (normalized.includes(rule.toUpperCase())) {
        return envelope.name;
      }
    }
  }

  return "uncategorized";
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
    "CINEPLEX", "AMC", "STEAMCMD", "STEAM ", "PLAYSTATION",
    "XBOX", "NINTENDO", "TICKETMASTER", "EVENTBRITE",
  ],
};
