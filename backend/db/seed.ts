/**
 * Seed script — runs as a Railway deploy hook on first deploy.
 * Creates the initial user account from SEED_EMAIL / SEED_PASSWORD env vars.
 * Skips silently if the user already exists.
 *
 * Usage: tsx db/seed.ts
 */
import { eq } from "drizzle-orm";
import { db } from "./index";
import { user as userTable } from "./schema";

async function main() {
  const email = process.env.SEED_EMAIL;
  const password = process.env.SEED_PASSWORD;
  const name = process.env.SEED_NAME ?? "Admin";

  if (!email || !password) {
    console.error("SEED_EMAIL and SEED_PASSWORD must be set");
    process.exit(1);
  }

  const existing = await db
    .select({ id: userTable.id })
    .from(userTable)
    .where(eq(userTable.email, email))
    .limit(1);

  if (existing.length > 0) {
    console.log(`User ${email} already exists — skipping seed.`);
    process.exit(0);
  }

  // Better Auth's HTTP sign-up route is gated by PUBLIC_SIGNUP_ENABLED (off at
  // launch). This script runs once at deploy time in a trusted context, so it
  // overrides the gate for its own process only — the running server's env is
  // untouched — then creates the user through Better Auth's real signUpEmail
  // path so the `user` and `account` (password hash) rows are created exactly
  // as they would be for any real sign-up.
  process.env.PUBLIC_SIGNUP_ENABLED = "true";
  const { auth } = await import("../lib/auth");

  await auth.api.signUpEmail({ body: { name, email, password } });

  console.log(`Seeded user: ${email}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
