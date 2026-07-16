/**
 * Seed script — runs as a Railway deploy hook on first deploy.
 * Creates the initial user account from SEED_EMAIL / SEED_PASSWORD env vars.
 * Skips silently if the user already exists.
 *
 * Usage: tsx db/seed.ts
 */
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { eq } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { createHash } from "crypto";
import { users } from "./schema";

async function main() {
  const email = process.env.SEED_EMAIL;
  const password = process.env.SEED_PASSWORD;

  if (!email || !password) {
    console.error("SEED_EMAIL and SEED_PASSWORD must be set");
    process.exit(1);
  }

  const client = createClient({
    url: process.env.DATABASE_URL!,
    authToken: process.env.DATABASE_AUTH_TOKEN,
  });
  const db = drizzle(client, { schema: { users } });

  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (existing.length > 0) {
    console.log(`User ${email} already exists — skipping seed.`);
    process.exit(0);
  }

  // Better Auth will manage password hashing in its own tables.
  // This seed creates the users row; Better Auth's own seed/register
  // path should be used for the credential row. For convenience we
  // create the base user row here so the FK is satisfied.
  await db.insert(users).values({
    id: uuidv4(),
    email,
    createdAt: Math.floor(Date.now() / 1000),
  });

  console.log(`Seeded user: ${email}`);
  console.log(
    "Next: use the /api/auth/sign-up endpoint or Better Auth admin to set the password."
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
