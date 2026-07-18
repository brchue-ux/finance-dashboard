/**
 * Per-user webhook secrets (spec §3/§5.4). The secret identifies the user for
 * unauthenticated inbound webhooks — TradingView sends it in the request body,
 * we store only its hash. SHA-256 suffices: secrets are 32 random bytes, not
 * low-entropy passwords, so brute-force resistance comes from the keyspace.
 */
import { createHash, randomBytes } from "node:crypto";
import { db } from "@/db";
import { webhookCredentials } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";

export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

/**
 * Create (or rotate) a user's secret for a service. Returns the plaintext —
 * the only time it ever exists outside the caller's hands.
 */
export async function issueWebhookSecret(userId: string, service: "tradingview"): Promise<string> {
  const secret = randomBytes(32).toString("base64url");
  const now = Math.floor(Date.now() / 1000);

  await db
    .delete(webhookCredentials)
    .where(and(eq(webhookCredentials.userId, userId), eq(webhookCredentials.service, service)));
  await db.insert(webhookCredentials).values({
    id: uuidv4(),
    userId,
    service,
    secretHash: hashSecret(secret),
    createdAt: now,
  });

  return secret;
}

/** Resolve an inbound plaintext secret to its owning user. NULL = reject. */
export async function resolveWebhookUser(
  secret: string,
  service: "tradingview"
): Promise<string | null> {
  const [row] = await db
    .select()
    .from(webhookCredentials)
    .where(
      and(
        eq(webhookCredentials.secretHash, hashSecret(secret)),
        eq(webhookCredentials.service, service)
      )
    )
    .limit(1);
  if (!row) return null;

  await db
    .update(webhookCredentials)
    .set({ lastUsedAt: Math.floor(Date.now() / 1000) })
    .where(eq(webhookCredentials.id, row.id));
  return row.userId;
}
