/**
 * Envelope proposal — build-reminders item 6c.
 *
 * The app must NOT ship a fixed taxonomy as everyone's starting point (that is
 * one household's life imposed on all users). Instead it derives a *proposal*
 * from the user's own spending: cluster their real merchants and offer the
 * categories actually present in their transactions, with real dollar amounts,
 * for them to keep / rename / skip. Defaults become an editable proposal.
 *
 * The seed rules (DEFAULT_RULES) are used ONLY as a clustering hint — a way to
 * recognise "these merchants tend to be Groceries" — not as the shipped answer.
 * The two things that make this a proposal rather than an imposition:
 *   1. Only categories the user actually has spending in are offered (a
 *      household with no transit spend never sees "Transport").
 *   2. Every merchant the seed rules could NOT place is surfaced explicitly with
 *      its amount, so the gap the shipped taxonomy would hide is visible.
 *
 * Pure and deterministic so it can be tested against real-data copies. Callers
 * pass already-filtered spendable rows (transfers and out-of-coverage removed);
 * this module does not know about those concepts.
 */
import {
  categorize,
  normalizeDescription,
  DEFAULT_RULES,
  UNCATEGORIZED,
  type Envelope,
} from "@/lib/categorization";

export interface ProposalTxn {
  description: string;
  /** Signed; only outflow (amount < 0) is clustered — income isn't a category. */
  amount: number;
  /** YYYY-MM-DD, used to average spend per month for a suggested target. */
  date: string;
}

/** A category the user's own spending fell into, offered as an envelope. */
export interface RecognizedCategory {
  name: string;
  /** Total outflow that clustered here, over the whole window. */
  totalSpent: number;
  /** totalSpent divided by the number of distinct months present — the figure
   *  that seeds a suggested monthly target. */
  monthlyAverage: number;
  transactionCount: number;
  merchantCount: number;
  /** The merchants driving this cluster, most frequent first — so the user can
   *  sanity-check the grouping before accepting it. */
  sampleMerchants: string[];
  /** The user already has an envelope with this name; offered for context, not
   *  for creation. */
  alreadyExists: boolean;
  /** The seed merchant rules for this category, so accepting creates an
   *  envelope that immediately auto-categorizes the same rows. */
  categoryRules: string[];
}

/** A merchant no seed rule could place — the gap a shipped taxonomy hides. */
export interface UnrecognizedMerchant {
  /** Normalized description; also the merchant rule if this becomes a category. */
  merchant: string;
  totalSpent: number;
  transactionCount: number;
}

export interface EnvelopeProposal {
  recognized: RecognizedCategory[];
  unrecognized: UnrecognizedMerchant[];
  /** Distinct YYYY-MM present in the spendable rows; the divisor behind every
   *  monthlyAverage, surfaced so the UI can say "averaged over N months". */
  monthsObserved: number;
}

/** How many merchant names to show per recognized cluster. */
const SAMPLE_MERCHANTS = 3;
/** Cap on surfaced unrecognized merchants — the biggest gaps, not a full dump. */
const UNRECOGNIZED_LIMIT = 20;

function seedEnvelopes(): Envelope[] {
  return Object.entries(DEFAULT_RULES).map(([name, categoryRules], i) => ({
    name,
    categoryRules,
    sortOrder: i,
  }));
}

/**
 * Clusters the user's spending into a proposed category set.
 *
 * @param txns spendable rows only (caller removes transfers / out-of-coverage)
 * @param existingEnvelopeNames names the user already has, matched case-insensitively
 */
export function proposeEnvelopes(
  txns: ProposalTxn[],
  existingEnvelopeNames: string[]
): EnvelopeProposal {
  const envelopes = seedEnvelopes();
  const taken = new Set(existingEnvelopeNames.map((n) => n.toLowerCase()));

  const months = new Set<string>();
  // category -> aggregate; merchant frequency kept to pick samples and count merchants.
  const clusters = new Map<
    string,
    { totalSpent: number; txnCount: number; merchantCounts: Map<string, number> }
  >();
  const unrecognized = new Map<string, { totalSpent: number; txnCount: number }>();

  for (const t of txns) {
    if (!(t.amount < 0)) continue; // outflow only; income and $0 rows aren't categories
    const spent = Math.abs(t.amount);
    months.add(t.date.slice(0, 7));

    const merchant = normalizeDescription(t.description);
    const category = categorize(t.description, envelopes);

    if (category === UNCATEGORIZED) {
      const u = unrecognized.get(merchant) ?? { totalSpent: 0, txnCount: 0 };
      u.totalSpent += spent;
      u.txnCount += 1;
      unrecognized.set(merchant, u);
      continue;
    }

    const c = clusters.get(category) ?? {
      totalSpent: 0,
      txnCount: 0,
      merchantCounts: new Map<string, number>(),
    };
    c.totalSpent += spent;
    c.txnCount += 1;
    c.merchantCounts.set(merchant, (c.merchantCounts.get(merchant) ?? 0) + 1);
    clusters.set(category, c);
  }

  const monthsObserved = Math.max(1, months.size);

  const recognized: RecognizedCategory[] = [...clusters.entries()]
    .map(([name, c]) => ({
      name,
      totalSpent: c.totalSpent,
      monthlyAverage: c.totalSpent / monthsObserved,
      transactionCount: c.txnCount,
      merchantCount: c.merchantCounts.size,
      sampleMerchants: [...c.merchantCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, SAMPLE_MERCHANTS)
        .map(([m]) => m),
      alreadyExists: taken.has(name.toLowerCase()),
      categoryRules: DEFAULT_RULES[name] ?? [],
    }))
    .sort((a, b) => b.totalSpent - a.totalSpent);

  const unrecognizedList: UnrecognizedMerchant[] = [...unrecognized.entries()]
    .map(([merchant, u]) => ({ merchant, totalSpent: u.totalSpent, txnCount: u.txnCount }))
    .sort((a, b) => b.totalSpent - a.totalSpent)
    .slice(0, UNRECOGNIZED_LIMIT)
    .map((u) => ({
      merchant: u.merchant,
      totalSpent: u.totalSpent,
      transactionCount: u.txnCount,
    }));

  return { recognized, unrecognized: unrecognizedList, monthsObserved };
}
