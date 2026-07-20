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
  budgetEnvelopes,
  bankBalanceSnapshots,
} from "./schema";
import { DEFAULT_RULES, categorize } from "../lib/categorization";
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

/** Monthly targets chosen only so the UI has plausible numbers to render. */
const ENVELOPE_TARGETS: Record<string, number> = {
  Groceries: 900,
  Restaurants: 300,
  Transport: 250,
  Utilities: 400,
  Shopping: 200,
  Healthcare: 150,
  Entertainment: 120,
};

/**
 * Merchants that exercise the real categorization rules, including the spacing
 * cases that were live bugs (A & W, UBEREATS) so a regression shows up here.
 */
const MERCHANTS: { desc: string; envelope: string; min: number; max: number }[] = [
  { desc: "NO FRILLS #3021", envelope: "Groceries", min: 40, max: 160 },
  { desc: "LOBLAWS WELLAND", envelope: "Groceries", min: 55, max: 190 },
  { desc: "TIM HORTONS #3625", envelope: "Restaurants", min: 4, max: 18 },
  { desc: "A & W #4910", envelope: "Restaurants", min: 9, max: 26 },
  { desc: "UBER CANADA/UBEREATS", envelope: "Restaurants", min: 22, max: 58 },
  { desc: "TACO BELL WELLAND", envelope: "Restaurants", min: 8, max: 24 },
  { desc: "PETRO-CANADA 05100", envelope: "Transport", min: 35, max: 95 },
  { desc: "UBER* TRIP", envelope: "Transport", min: 12, max: 40 },
  { desc: "BELL CANADA", envelope: "Utilities", min: 85, max: 95 },
  { desc: "NETFLIX.COM", envelope: "Utilities", min: 21, max: 21 },
  { desc: "AMAZON.CA", envelope: "Shopping", min: 15, max: 120 },
  { desc: "SHOPPERS DRUG MART", envelope: "Healthcare", min: 12, max: 70 },
  { desc: "CINEPLEX 7206", envelope: "Entertainment", min: 14, max: 46 },
  { desc: "STEAMGAMES.COM", envelope: "Entertainment", min: 10, max: 60 },
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

  const email = process.env.SEED_EMAIL ?? "demo@test.local";
  const password = process.env.SEED_PASSWORD ?? "test-only-not-a-real-credential";
  const name = process.env.SEED_NAME ?? "Demo (TEST DATA)";

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
  await db.delete(transactions).where(eq(transactions.userId, userId));
  await db.delete(bankBalanceSnapshots).where(eq(bankBalanceSnapshots.userId, userId));
  await db.delete(bankAccounts).where(eq(bankAccounts.userId, userId));
  await db.delete(bankConnections).where(eq(bankConnections.userId, userId));
  await db.delete(budgetEnvelopes).where(eq(budgetEnvelopes.userId, userId));

  const now = Date.now();
  const rng = makeRng(20260720);

  // ── envelopes ──────────────────────────────────────────────────────────
  const envelopeRows = Object.entries(DEFAULT_RULES).map(([envName, rules], i) => ({
    id: randomUUID(),
    userId,
    name: envName,
    monthlyTarget: ENVELOPE_TARGETS[envName] ?? 100,
    categoryRules: JSON.stringify(rules),
    active: 1,
    sortOrder: i,
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

  const txns: (typeof transactions.$inferInsert)[] = [];
  const today = new Date();

  for (let monthsBack = 3; monthsBack >= 0; monthsBack--) {
    const base = new Date(today.getFullYear(), today.getMonth() - monthsBack, 1);
    const year = base.getFullYear();
    const month = base.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const lastDay = monthsBack === 0 ? today.getDate() : daysInMonth;

    // Income, so the Budget tab's inflow/outflow split has something to show.
    txns.push({
      id: randomUUID(),
      userId,
      accountId: chequingId,
      plaidTransactionId: null,
      date: `${year}-${String(month + 1).padStart(2, "0")}-01`,
      description: `${TEST_TAG} PAYROLL DEPOSIT`,
      merchantName: `${TEST_TAG} Demo Employer`,
      amount: 3400,
      category: null,
      pending: 0,
      createdAt: now,
      isoCurrencyCode: "CAD",
    });

    for (const m of MERCHANTS) {
      const count = 2 + Math.floor(rng() * 4);
      for (let i = 0; i < count; i++) {
        const day = 1 + Math.floor(rng() * lastDay);
        const amount = -(m.min + rng() * (m.max - m.min));
        txns.push({
          id: randomUUID(),
          userId,
          accountId: rng() > 0.4 ? cardId : chequingId,
          plaidTransactionId: null,
          date: `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
          description: `${TEST_TAG} ${m.desc}`,
          merchantName: `${TEST_TAG} ${m.desc}`,
          amount: Math.round(amount * 100) / 100,
          category: categoryFor(`${TEST_TAG} ${m.desc}`),
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
      description: `${TEST_TAG} AMAZON.CA`,
      merchantName: `${TEST_TAG} AMAZON.CA`,
      amount: -(ENVELOPE_TARGETS.Shopping * 0.45),
      category: categoryFor(`${TEST_TAG} AMAZON.CA`),
      pending: 0,
      createdAt: now,
      isoCurrencyCode: "CAD",
    });
  }

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

  console.log(`Seeded TEST data into ${process.env.DATABASE_URL}`);
  console.log(`  user         ${email}`);
  console.log(`  envelopes    ${envelopeRows.length} (targets set)`);
  console.log(`  accounts     ${accounts.length}`);
  const uncat = txns.filter((t) => t.category === "uncategorized").length;
  console.log(`  transactions ${txns.length} (${uncat} uncategorized — expect only payroll)`);
  console.log(`  snapshots    ${snaps.length}`);
  console.log(`\nAll generated rows carry the ${TEST_TAG} marker.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
