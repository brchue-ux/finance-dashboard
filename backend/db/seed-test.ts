/**
 * TEST-DATA SEED — synthetic only, never run against the real database.
 *
 * Purpose: make every screen render in a realistic state without using real
 * financial data, so the app can be built and evaluated end to end before any
 * real budget is configured.
 *
 * Usage (note BOTH env files — .env.local supplies shared secrets, .env.test
 * overrides the database target):
 *
 *   node --env-file=.env.local --env-file=.env.test \
 *        ../node_modules/.bin/tsx db/seed-test.ts
 *
 * Safety: refuses to run unless DATABASE_URL points at a *test* database, so a
 * missing --env-file can't silently write demo rows into local.db (which holds
 * 1,700+ real transactions). Every generated row is also self-identifying —
 * see TEST_TAG — so test data is obvious anywhere it surfaces.
 */
import { randomUUID } from "crypto";
import { db } from "./index";
import {
  user as userTable,
  bankConnections,
  bankAccounts,
  transactions,
  transactionSplits,
  budgetEnvelopes,
  envelopeAllocations,
  bankBalanceSnapshots,
  portfolioSnapshots,
  holdings,
} from "./schema";
import { categorize } from "../lib/categorization";
import { DEFAULT_ENVELOPE_GROUPS } from "../lib/budget/groups";
import { eq } from "drizzle-orm";

/** Marker embedded in generated rows so test data is identifiable at a glance. */
const TEST_TAG = "[TEST]";

function assertTestDatabase() {
  const url = process.env.DATABASE_URL ?? "";
  if (!/test/i.test(url)) {
    console.error(
      `Refusing to seed: DATABASE_URL is "${url}", which is not a test database.\n` +
        `This script writes synthetic data and must never touch real financial data.\n` +
        `Re-run with --env-file=.env.test`
    );
    process.exit(1);
  }
}

/**
 * The envelope set and monthly targets this fixture builds.
 *
 * These mirror a real household's taxonomy — sixteen envelopes clustered from
 * that household's actual merchants. The point is that the fixture is *accurate
 * user data the build works around*, not data shaped so tests pass. The previous
 * version seeded seven envelopes from DEFAULT_RULES, which meant test.db and
 * real data came from different worlds: a US-merchant CSV imported during device
 * testing left 41 of 50 rows uncategorized and nothing in the fixture would ever
 * have shown it.
 *
 * The realism that matters here is *shape*: real merchant strings, the real
 * envelope set, real amount ranges and frequencies. Targets are set coherently
 * against the merchants THIS fixture generates rather than copied from the real
 * household's, because that household's $35 Utilities and $25 Healthcare
 * targets describe their spending, not this merchant mix — copying them
 * verbatim put five envelopes spuriously over budget. Entertainment and
 * Insurance are left marginally over on purpose, so the over-budget states
 * still render.
 *
 * This deliberately lives HERE and not in lib/categorization.ts. Shipping this
 * list as DEFAULT_RULES would encode one Ontario household's life as every
 * user's starting point — see build-reminders item 6c. It is a fixture, not a
 * default.
 */
const TEST_ENVELOPES: { name: string; target: number; rules: string[] }[] = [
  { name: "Groceries", target: 1350, rules: ["WAL-MART", "WALMART", "LOBLAWS", "NO FRILLS", "NOFRILLS", "FOOD BASICS", "SOBEYS", "FRESHCO", "COSTCO", "ZEHRS"] },
  { name: "Restaurants", target: 750, rules: ["TIM HORTONS", "A&W", "SWISS CHALET", "TACO BELL", "UBER EATS", "M.T. BELLIES", "BELLIES", "PIZZA", "MCDONALD", "SUBWAY"] },
  { name: "Transport", target: 450, rules: ["PETRO-CANADA", "PETROCAN", "ESSO", "SHELL", "CANADIAN TIRE GAS", "UBER", "PRESTO", "PARKING"] },
  { name: "Home & Hardware", target: 550, rules: ["CANADIAN TIRE", "RONA", "HOME DEPOT", "HOME HARDWARE", "IKEA"] },
  { name: "Utilities", target: 120, rules: ["HYDRO", "ENBRIDGE", "ROGERS", "BELL ", "TELUS", "NETFLIX", "SPOTIFY"] },
  { name: "Insurance", target: 200, rules: ["BCM INSURANCE", "INSURANCE", "INTACT"] },
  { name: "Personal Care", target: 300, rules: ["PALAZZO SALON", "SALON", "SEPHORA", "BARBER"] },
  { name: "Fitness & Recreation", target: 60, rules: ["YMCA", "SPORT CHEK", "GOODLIFE", "GOLF"] },
  { name: "Kids & Activities", target: 175, rules: ["STEM CAMP", "SOCCER", "DSB ", "DAYCARE"] },
  { name: "Cannabis", target: 125, rules: ["INSALATA CANNABIS", "CANNABIS", "OCS.CA"] },
  { name: "Travel", target: 65, rules: ["BEST WESTERN", "MARRIOTT", "AIRBNB", "AIR CANADA", "ONTARIO PARKS"] },
  { name: "Home Services", target: 55, rules: ["BUSY MOMS", "CLEANING", "LAWN", "SNOW REMOVAL"] },
  { name: "Healthcare", target: 150, rules: ["SHOPPERS DRUG", "REXALL", "PHARMACY", "DENTAL", "PHYSIO"] },
  { name: "Entertainment", target: 150, rules: ["CINEPLEX", "STEAMGAMES", "STEAM ", "PLAYSTATION", "TICKETMASTER"] },
  { name: "Shopping", target: 1200, rules: ["AMAZON", "AMZN", "DOLLARAMA", "WINNERS", "GIANT TIGER", "BEST BUY"] },
  { name: "Fees & Interest", target: 25, rules: ["PURCHASE INTEREST", "INTEREST", "ANNUAL FEE", "NSF"] },
];

/**
 * Real transaction descriptions, copied verbatim from actual bank data.
 *
 * Verbatim matters. These carry the branch codes, store numbers, spacing and
 * punctuation that real descriptions have, and several exist specifically
 * because they were live bugs or are live ordering hazards:
 *
 *   UBEREATS vs UBERTRIP  — the same "UBER CANADA/" prefix resolving to two
 *                           different envelopes; today this works only because
 *                           Restaurants sorts ahead of Transport
 *   CANADIAN TIRE         — must reach Home & Hardware, not Transport's
 *                           "CANADIAN TIRE GAS"
 *   M.T. BELLIES          — must NOT match Utilities' "BELL "
 *   A & W / UBEREATS      — spacing cases that were real defects
 *
 * The `expect` field records where each one must land, so seeding reports a
 * mismatch instead of silently producing miscategorised demo data.
 */
const MERCHANTS: {
  desc: string;
  expect: string;
  min: number;
  max: number;
  /**
   * Times per month. Recurring bills fire exactly once; everything else varies.
   * Without this every merchant fired 2-5 times a month, so a monthly insurance
   * premium was charged five times and Insurance showed $1,016 against a $200
   * target. The targets come from real monthly averages, so a generator that
   * ignores frequency contradicts them — the fixture then shows five envelopes
   * spuriously over budget, which is the exact picture the over-budget framing
   * work (build-reminders 6d) has to be designed against.
   */
  perMonth?: number;
}[] = [
  { desc: "WAL-MART SUPERCENTER#3110 WE", expect: "Groceries", min: 40, max: 220 },
  { desc: "NO FRILLS #3021 WELLAND", expect: "Groceries", min: 40, max: 160 },
  { desc: "LOBLAWS WELLAND", expect: "Groceries", min: 55, max: 190 },
  { desc: "TIM HORTONS WELLAND", expect: "Restaurants", min: 4, max: 18 },
  { desc: "A & W #4910 NIAGARA ST WELLA", expect: "Restaurants", min: 9, max: 26 },
  { desc: "UBER CANADA/UBEREATS TORONTO", expect: "Restaurants", min: 22, max: 58 },
  { desc: "TACO BELL WELLAND WELLAND, ON", expect: "Restaurants", min: 8, max: 24 },
  { desc: "M.T. BELLIES TAP & GRILLH WELLAND", expect: "Restaurants", min: 25, max: 90 },
  { desc: "SWISS CHALET 1917 WELLAND", expect: "Restaurants", min: 20, max: 65 },
  { desc: "UBER CANADA/UBERTRIP TORONTO", expect: "Transport", min: 12, max: 40 },
  { desc: "PETRO-CANADA 05100 WELLAND", expect: "Transport", min: 35, max: 95 },
  { desc: "SHELL C22517 WELLAND", expect: "Transport", min: 30, max: 85 },
  { desc: "CANADIAN TIRE #118 WELLAND", expect: "Home & Hardware", min: 15, max: 180 },
  { perMonth: 1, desc: "BELL CANADA MONTREAL", expect: "Utilities", min: 85, max: 95 },
  { perMonth: 1, desc: "NETFLIX.COM 844-5052993", expect: "Utilities", min: 21, max: 21 },
  { perMonth: 1, desc: "BCM INSURANCE COMPANY WELLAND", expect: "Insurance", min: 180, max: 220 },
  { desc: "PALAZZO SALON & SPA WELLAND", expect: "Personal Care", min: 45, max: 130 },
  { perMonth: 1, desc: "YMCA OF NIAGARA ST CATHARINES", expect: "Fitness & Recreation", min: 40, max: 60 },
  { desc: "INSALATA CANNABIS MARKET WELLAND", expect: "Cannabis", min: 25, max: 90 },
  { desc: "SHOPPERS DRUG MART #1234 WELLAND", expect: "Healthcare", min: 12, max: 70 },
  { desc: "CINEPLEX 7206 QPS WELLAND", expect: "Entertainment", min: 14, max: 46 },
  { desc: "STEAMGAMES.COM 4259522985 912-1844160", expect: "Entertainment", min: 10, max: 60 },
  { desc: "AMZN Mktp CA WWW.AMAZON.CA", expect: "Shopping", min: 15, max: 120 },
  { desc: "DOLLARAMA #573 WELLAND", expect: "Shopping", min: 8, max: 45 },
];

/**
 * Real descriptions that legitimately match no rule.
 *
 * Every real dataset has these — independent merchants, one-off services. The
 * fixture needs them because uncategorized spend is not a rendering edge case:
 * it feeds `unattributedSpent`, it is what the "not in any envelope" notice
 * exists to surface, and it is the thing per-transaction recategorisation will
 * act on. A fixture where everything categorises cleanly cannot exercise any
 * of that. WWW.BELLAS is here for a second reason: it is the regression guard
 * proving Utilities' "BELL " rule does not over-match.
 */
const UNCATEGORIZED_MERCHANTS: {
  desc: string;
  min: number;
  max: number;
  perMonth?: number;
}[] = [
  { desc: "WWW.BELLAS* BELLASANDB WELLAND", min: 20, max: 75 },
  { desc: "TST-Taco N Tequila - N Niagara Falls", min: 30, max: 95 },
  { desc: "GRAND OAK CULINARY MARKET VINELAND STAT", min: 25, max: 80 },
  { desc: "LANDMARK WEB TICKETING 403-262-4255", min: 15, max: 50 },
];

/** Deterministic PRNG so re-seeding produces the same dataset. */
function makeRng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

async function main() {
  assertTestDatabase();

  // TEST_-prefixed on purpose. This script is run with BOTH --env-file=.env.local
  // (for ENCRYPTION_KEY / BETTER_AUTH_SECRET) and --env-file=.env.test, and
  // .env.local sets SEED_EMAIL and SEED_PASSWORD for the *real* dev user — so
  // reading those here would silently seed test.db with the real account's
  // identity and credentials.
  const email = process.env.TEST_SEED_EMAIL ?? "demo@test.local";
  // Deliberately short and trivial: it is typed by hand on a phone during
  // device-test sessions and only ever guards synthetic data in test.db.
  // Never reuse it anywhere that holds real data.
  const password = process.env.TEST_SEED_PASSWORD ?? "test1234";
  const name = process.env.TEST_SEED_NAME ?? "Demo (TEST DATA)";

  // Better Auth owns password hashing, so create the user through its real
  // sign-up path rather than inserting rows by hand.
  let [existing] = await db
    .select({ id: userTable.id })
    .from(userTable)
    .where(eq(userTable.email, email))
    .limit(1);

  if (!existing) {
    process.env.PUBLIC_SIGNUP_ENABLED = "true";
    const { auth } = await import("../lib/auth");
    await auth.api.signUpEmail({ body: { name, email, password } });
    [existing] = await db
      .select({ id: userTable.id })
      .from(userTable)
      .where(eq(userTable.email, email))
      .limit(1);
  }
  const userId = existing.id;

  // Idempotent: clear this user's generated rows so re-runs don't stack.
  //
  // Child rows first, in FK dependency order. transaction_splits references
  // transactions and envelope_allocations references budget_envelopes; neither
  // was deleted here, because neither had a write path when this was written.
  // Both do now, so once the device session created real splits and allocations
  // in test.db, re-seeding failed outright with FOREIGN KEY constraint failed.
  // Any table that gains a writer has to be added here too.
  await db.delete(transactionSplits).where(eq(transactionSplits.userId, userId));
  await db.delete(envelopeAllocations).where(eq(envelopeAllocations.userId, userId));
  await db.delete(holdings).where(eq(holdings.userId, userId));
  await db.delete(portfolioSnapshots).where(eq(portfolioSnapshots.userId, userId));
  await db.delete(transactions).where(eq(transactions.userId, userId));
  await db.delete(bankBalanceSnapshots).where(eq(bankBalanceSnapshots.userId, userId));
  await db.delete(bankAccounts).where(eq(bankAccounts.userId, userId));
  await db.delete(bankConnections).where(eq(bankConnections.userId, userId));
  await db.delete(budgetEnvelopes).where(eq(budgetEnvelopes.userId, userId));

  const now = Date.now();
  const rng = makeRng(20260720);

  // ── envelopes ──────────────────────────────────────────────────────────
  const envelopeRows = TEST_ENVELOPES.map((e, i) => ({
    id: randomUUID(),
    userId,
    name: e.name,
    monthlyTarget: e.target,
    categoryRules: JSON.stringify(e.rules),
    active: 1,
    sortOrder: i,
    groupName: DEFAULT_ENVELOPE_GROUPS[e.name] ?? null,
    createdAt: now,
  }));
  await db.insert(budgetEnvelopes).values(envelopeRows);

  // ── connection + accounts ──────────────────────────────────────────────
  const connectionId = randomUUID();
  await db.insert(bankConnections).values({
    id: connectionId,
    userId,
    institutionName: `${TEST_TAG} Demo Bank`,
    plaidItemId: `test-item-${connectionId}`,
    plaidAccessToken: "test-not-a-real-token",
    status: "active",
    lastSyncedAt: Math.floor(now / 1000),
    createdAt: now,
  });

  const chequingId = randomUUID();
  const cardId = randomUUID();
  const accounts = [
    {
      id: chequingId,
      userId,
      connectionId,
      plaidAccountId: `test-acct-${chequingId}`,
      name: `${TEST_TAG} Everyday Chequing`,
      type: "depository",
      mask: "1234",
      institution: `${TEST_TAG} Demo Bank`,
      balanceAvailable: 4820.55,
      balanceCurrent: 4820.55,
      balanceLimit: null,
      isoCurrencyCode: "CAD",
    },
    {
      id: cardId,
      userId,
      connectionId,
      plaidAccountId: `test-acct-${cardId}`,
      name: `${TEST_TAG} Rewards Credit Card`,
      type: "credit",
      mask: "5678",
      institution: `${TEST_TAG} Demo Bank`,
      balanceAvailable: 3150.0,
      balanceCurrent: -1849.32,
      balanceLimit: 5000.0,
      isoCurrencyCode: "CAD",
    },
  ];
  await db.insert(bankAccounts).values(accounts);

  // ── transactions: 4 months, categorizable, with deliberate notables ─────
  // Categories are assigned by the real engine at insert time, mirroring what
  // the import pipeline and Plaid sync do. Hardcoding them would hide rule
  // regressions; this way a broken rule shows up as uncategorized demo data.
  const parsedEnvelopes = envelopeRows.map((e) => ({
    name: e.name,
    categoryRules: JSON.parse(e.categoryRules) as string[],
    sortOrder: e.sortOrder,
  }));
  const categoryFor = (desc: string) => categorize(desc, parsedEnvelopes);

  // Every merchant's landing place is asserted once, before any rows are
  // written. Categorisation runs through the real engine here exactly as the
  // import pipeline and Plaid sync do, so a rules regression must surface as a
  // failed seed — not as demo data that looks fine until someone reads it. The
  // ordering hazards are the reason: UBEREATS vs UBERTRIP and CANADIAN TIRE vs
  // CANADIAN TIRE GAS both resolve correctly only by envelope sort order, so a
  // reordering would silently move real money into the wrong envelope.
  const wrong: string[] = [];
  for (const m of MERCHANTS) {
    const got = categoryFor(m.desc);
    if (got !== m.expect) wrong.push(`  "${m.desc}"\n    expected ${m.expect}, got ${got}`);
  }
  for (const m of UNCATEGORIZED_MERCHANTS) {
    const got = categoryFor(m.desc);
    if (got !== "uncategorized") {
      wrong.push(`  "${m.desc}"\n    expected uncategorized, got ${got}`);
    }
  }
  if (wrong.length > 0) {
    console.error(
      `Refusing to seed: ${wrong.length} merchant(s) categorise differently than this ` +
        `fixture asserts.\n\n${wrong.join("\n")}\n\n` +
        `Either the categorisation rules regressed, or TEST_ENVELOPES and the\n` +
        `expectations above have drifted apart. Fix one of them — do not seed\n` +
        `data that contradicts what the fixture claims.`
    );
    process.exit(1);
  }

  // Drives the guaranteed-notable purchase below, which must clear 15% of its
  // envelope's allocation for the notable-transaction cards to have anything
  // to render.
  const shoppingTarget = TEST_ENVELOPES.find((e) => e.name === "Shopping")!.target;

  const txns: (typeof transactions.$inferInsert)[] = [];
  const today = new Date();

  for (let monthsBack = 3; monthsBack >= 0; monthsBack--) {
    const base = new Date(today.getFullYear(), today.getMonth() - monthsBack, 1);
    const year = base.getFullYear();
    const month = base.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const lastDay = monthsBack === 0 ? today.getDate() : daysInMonth;

    // Biweekly payroll, landing on the 1st and 15th. A single monthly deposit
    // of 3400 sat below this fixture's ~5400 of outflow, so every month was
    // negative and the positive-`saved` path — the green net-position card —
    // never rendered at all. Two deposits put the month slightly in surplus,
    // and the guaranteed oversized purchase below still pushes some months
    // negative, so both states occur.
    for (const day of ["01", "15"]) {
      txns.push({
        id: randomUUID(),
        userId,
        accountId: chequingId,
        plaidTransactionId: null,
        date: `${year}-${String(month + 1).padStart(2, "0")}-${day}`,
        description: `${TEST_TAG} PAYROLL DEPOSIT`,
        merchantName: `${TEST_TAG} Demo Employer`,
        amount: 2900,
        category: null,
        pending: 0,
        createdAt: now,
        isoCurrencyCode: "CAD",
      });
    }

    // The description is the REAL string, untagged. It is what categorize()
    // reads (both the import pipeline and Plaid sync pass row.description), so
    // prefixing it with "[TEST] " fed the matcher an input production never
    // sends — the fixture would have been exercising a different string than
    // the code path it exists to cover. Identifiability moves to merchantName
    // and the account/institution names, which nothing categorises, and the
    // /test/i DATABASE_URL guard is what actually keeps this out of local.db.
    for (const m of [...MERCHANTS, ...UNCATEGORIZED_MERCHANTS]) {
      const count = m.perMonth ?? 2 + Math.floor(rng() * 4);
      for (let i = 0; i < count; i++) {
        const day = 1 + Math.floor(rng() * lastDay);
        const amount = -(m.min + rng() * (m.max - m.min));
        txns.push({
          id: randomUUID(),
          userId,
          accountId: rng() > 0.4 ? cardId : chequingId,
          plaidTransactionId: null,
          date: `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
          description: m.desc,
          merchantName: `${TEST_TAG} ${m.desc}`,
          amount: Math.round(amount * 100) / 100,
          category: categoryFor(m.desc),
          pending: 0,
          createdAt: now,
          isoCurrencyCode: "CAD",
        });
      }
    }

    // One oversized buy per month, guaranteed >= 15% of its envelope, so the
    // notable-transactions cards always have something to render.
    txns.push({
      id: randomUUID(),
      userId,
      accountId: cardId,
      plaidTransactionId: null,
      date: `${year}-${String(month + 1).padStart(2, "0")}-${String(Math.min(18, lastDay)).padStart(2, "0")}`,
      description: "AMZN Mktp CA WWW.AMAZON.CA",
      merchantName: `${TEST_TAG} AMZN Mktp CA`,
      amount: -(shoppingTarget * 0.45),
      category: categoryFor("AMZN Mktp CA WWW.AMAZON.CA"),
      pending: 0,
      createdAt: now,
      isoCurrencyCode: "CAD",
    });
  }

  // ── refund fixtures: both classifications, deterministically visible ─────
  // A matched cross-month refund (last month's purchase paid back this month →
  // the feed row reads "Refund → <last month>" and LAST month's Shopping nets
  // down), and an "Interest received" row that a keyword rule files under
  // Fees & Interest but which has no outflow history — so it must count as
  // plain income, not shrink that envelope.
  const lastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 12);
  const refundBase = {
    userId,
    accountId: cardId,
    plaidTransactionId: null,
    pending: 0,
    createdAt: now,
    isoCurrencyCode: "CAD" as const,
  };
  txns.push(
    {
      ...refundBase,
      id: randomUUID(),
      date: `${lastMonth.getFullYear()}-${String(lastMonth.getMonth() + 1).padStart(2, "0")}-12`,
      description: "AMZN Mktp CA WWW.AMAZON.CA",
      merchantName: `${TEST_TAG} AMZN Mktp CA (refunded later)`,
      amount: -87.43,
      category: categoryFor("AMZN Mktp CA WWW.AMAZON.CA"),
    },
    {
      ...refundBase,
      id: randomUUID(),
      date: `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(Math.min(today.getDate(), 5)).padStart(2, "0")}`,
      description: "AMZN Mktp CA WWW.AMAZON.CA",
      merchantName: `${TEST_TAG} AMZN Mktp CA (refund)`,
      amount: 87.43,
      category: categoryFor("AMZN Mktp CA WWW.AMAZON.CA"),
    },
    {
      ...refundBase,
      id: randomUUID(),
      accountId: chequingId,
      date: `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-01`,
      description: "Interest received (Chequing)",
      merchantName: `${TEST_TAG} Interest received`,
      amount: 12.34,
      category: categoryFor("Interest received (Chequing)"),
    }
  );

  // ── transfers: the app's biggest money-math feature, previously unexercised
  // by test data (item 10). A credit-card payment is one event seen twice —
  // positive on the card, negative on chequing — and counting either side
  // made $90k of phantom income on real data. Descriptions are the REAL bank
  // strings; transfer_source='rule' mirrors how the real rows are marked
  // (there is no live auto-marking pipeline — patterns are propose-only).
  for (let monthsBack = 3; monthsBack >= 0; monthsBack--) {
    const base = new Date(today.getFullYear(), today.getMonth() - monthsBack, 1);
    const year = base.getFullYear();
    const month = base.getMonth();
    const day = monthsBack === 0 ? Math.min(today.getDate(), 3) : 21;
    const payment = 1200 + Math.round(rng() * 900);
    const date = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const transferBase = {
      userId,
      plaidTransactionId: null,
      category: "uncategorized",
      pending: 0,
      createdAt: now,
      isoCurrencyCode: "CAD" as const,
      transferSource: "rule" as const,
    };
    txns.push(
      {
        ...transferBase,
        id: randomUUID(),
        accountId: chequingId,
        date,
        description: "Bill Payment - ROYAL BANK VISA-V",
        merchantName: `${TEST_TAG} CC payment (chequing side)`,
        amount: -payment,
      },
      {
        ...transferBase,
        id: randomUUID(),
        accountId: cardId,
        date,
        description: "PAYMENT - THANK YOU / PAI EMENT - MERCI",
        merchantName: `${TEST_TAG} CC payment (card side)`,
        amount: payment,
      }
    );
  }

  // ── out-of-coverage rows: real, categorized, visible per-account, but held
  // out of every month total (the period predates data from other accounts).
  // Value string matches the real DB's convention.
  const coverageMonth = new Date(today.getFullYear(), today.getMonth() - 6, 15);
  const covDate = `${coverageMonth.getFullYear()}-${String(coverageMonth.getMonth() + 1).padStart(2, "0")}-15`;
  txns.push({
    id: randomUUID(),
    userId,
    accountId: chequingId,
    plaidTransactionId: null,
    date: covDate,
    description: "AMZN Mktp CA WWW.AMAZON.CA",
    merchantName: `${TEST_TAG} pre-coverage purchase`,
    amount: -64.99,
    category: categoryFor("AMZN Mktp CA WWW.AMAZON.CA"),
    pending: 0,
    createdAt: now,
    isoCurrencyCode: "CAD",
    coverage: "before_bank_data",
  });

  await db.insert(transactions).values(txns);

  // ── balance snapshots, so Reports' net-worth trend has a series ─────────
  const snaps: (typeof bankBalanceSnapshots.$inferInsert)[] = [];
  for (let monthsBack = 3; monthsBack >= 0; monthsBack--) {
    const capturedAt = Math.floor(
      new Date(today.getFullYear(), today.getMonth() - monthsBack, 1).getTime() / 1000
    );
    snaps.push({
      id: randomUUID(),
      accountId: chequingId,
      userId,
      balanceAvailable: 4200 + monthsBack * -180,
      balanceCurrent: 4200 + monthsBack * -180,
      balanceLimit: null,
      isoCurrencyCode: "CAD",
      capturedAt,
    });
    snaps.push({
      id: randomUUID(),
      accountId: cardId,
      userId,
      balanceAvailable: 3150,
      balanceCurrent: -(1500 + monthsBack * 90),
      balanceLimit: 5000,
      isoCurrencyCode: "CAD",
      capturedAt,
    });
  }
  await db.insert(bankBalanceSnapshots).values(snaps);

  // ── portfolio: mirrors the REAL Wealthsimple structure the first live
  // connect revealed (item 10: fixtures follow reality, reality doesn't bend
  // to fixtures) — a managed RESP group that itemizes NO positions, cash
  // buckets with no tickers, and a TFSA whose only itemized holding is a
  // fractional VEQT.TO. This is exactly the shape that made positions-only
  // valuation report $5.18 for a ~$78k relationship on real data; with it
  // seeded, that bug class is visible in test mode. No wealthsimple_connections
  // row on purpose: the sync endpoint skips cleanly ("no_connection") instead
  // of calling SnapTrade with fake credentials.
  const mkAccount = (idSuffix: string, last4: string, total: number, cash: number) => ({
    id: `test-ws-${idSuffix}`,
    last4,
    total,
    cash,
  });
  const portfolioDays = 30;
  const portSnaps: (typeof portfolioSnapshots.$inferInsert)[] = [];
  let latestPortfolioId = "";
  for (let daysBack = portfolioDays - 1; daysBack >= 0; daysBack--) {
    const at = Math.floor(Date.now() / 1000) - daysBack * 86400;
    // Deterministic drift: managed value wanders, cash steps down mid-month.
    const drift = Math.sin(daysBack / 5) * 220 + (portfolioDays - daysBack) * 8;
    const respTotal = 21500 + drift;
    const cashA = 6200 - (daysBack < 12 ? 400 : 0);
    const cashB = 1850;
    const tfsaCash = 900;
    const veqt = 5.18 + (portfolioDays - daysBack) * 0.01;
    const groups = [
      {
        type: "resp",
        total: respTotal,
        cash: 61.5,
        positionsValue: 0,
        accountCount: 1,
        managed: true, // value with no itemized positions — the robo shape
        accounts: [mkAccount("resp", "r3sp", respTotal, 61.5)],
      },
      {
        type: "cash",
        total: cashA + cashB,
        cash: cashA + cashB,
        positionsValue: 0,
        accountCount: 2,
        managed: false,
        accounts: [mkAccount("cash-a", "chq1", cashA, cashA), mkAccount("cash-b", "sav2", cashB, cashB)],
      },
      {
        type: "tfsa",
        total: tfsaCash + veqt,
        cash: tfsaCash,
        positionsValue: veqt,
        accountCount: 1,
        managed: false,
        accounts: [mkAccount("tfsa", "tf5a", tfsaCash + veqt, tfsaCash)],
      },
    ];
    const snapId = randomUUID();
    latestPortfolioId = snapId;
    portSnaps.push({
      id: snapId,
      userId,
      snapshotAt: at,
      totalValue: groups.reduce((s, g) => s + g.total, 0),
      cashValue: groups.reduce((s, g) => s + g.cash, 0),
      accounts: JSON.stringify(groups),
      createdAt: at,
    });
  }
  await db.insert(portfolioSnapshots).values(portSnaps);
  await db.insert(holdings).values({
    id: randomUUID(),
    userId,
    snapshotId: latestPortfolioId,
    ticker: "VEQT.TO", // Yahoo-suffixed, exactly as SnapTrade returns it live
    name: `${TEST_TAG} Vanguard All-Equity ETF Portfolio`,
    quantity: 0.0848,
    costBasis: 38.7,
    marketValue: 5.18 + portfolioDays * 0.01,
    openPnl: 1.9,
    accountType: "tfsa",
    createdAt: Math.floor(Date.now() / 1000),
  });

  console.log(`Seeded TEST data into ${process.env.DATABASE_URL}`);
  console.log(`  user         ${email}`);
  console.log(`  envelopes    ${envelopeRows.length} (targets set)`);
  console.log(`  accounts     ${accounts.length}`);
  const uncat = txns.filter((t) => t.category === "uncategorized").length;
  const uncatSpend = txns
    .filter((t) => t.category === "uncategorized" && (t.amount ?? 0) < 0)
    .reduce((s, t) => s + Math.abs(t.amount ?? 0), 0);
  console.log(`  transactions ${txns.length}`);
  console.log(
    `  uncategorized ${uncat} ($${uncatSpend.toFixed(2)}) — deliberate: ` +
      `${UNCATEGORIZED_MERCHANTS.length} merchants that match no rule, so the` +
      `\n                "not in any envelope" path has something to show`
  );
  console.log(`  snapshots    ${snaps.length}`);
  const transferCount = txns.filter((t) => t.transferSource).length;
  console.log(`  transfers    ${transferCount} rows (${transferCount / 2} CC-payment pairs, both sides)`);
  console.log(`  coverage     ${txns.filter((t) => t.coverage).length} out-of-coverage row(s)`);
  console.log(`  portfolio    ${portSnaps.length} snapshots (managed RESP + cash + TFSA w/ VEQT.TO)`);
  console.log(
    `\nEvery merchant categorised as this fixture asserts.` +
      `\nGenerated rows carry the ${TEST_TAG} marker on merchantName and account names;` +
      `\ndescriptions are real strings on purpose — they are what the matcher reads.`
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
