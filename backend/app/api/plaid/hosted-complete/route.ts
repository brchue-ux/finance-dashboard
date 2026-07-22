/**
 * POST /api/plaid/hosted-complete
 * Completes a Hosted Link session: the frontend returns from the browser
 * handoff with only its link_token — the public_token lives server-side in the
 * session results (spec §5.1). Retrieves it, then does the same exchange +
 * account population the raw-Link exchange path used to do (that route was
 * removed — Hosted Link is the locked mechanism).
 */
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-guard";
import { plaidClient } from "@/lib/plaid";
import { db } from "@/db";
import { bankConnections } from "@/db/schema";
import { eq } from "drizzle-orm";
import { encrypt } from "@/lib/crypto";
import { syncAccountsForConnection } from "@/lib/plaid-accounts";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";

const bodySchema = z.object({
  link_token: z.string().min(1),
  institution_name: z.string().min(1),
});

/**
 * Retrieves the Item-add result for a completed Hosted Link session. The
 * public_token lives in link_sessions[].results.item_add_results[] — NOT in the
 * deprecated on_success field, which Plaid no longer populates for Hosted Link
 * (reading it there returned empty even on sessions that finished "connected").
 *
 * Results are recorded asynchronously and can lag a second or two behind the
 * completion redirect the client returns on, so poll briefly and return as soon
 * as the Item-add lands rather than reporting the race as "not completed".
 */
async function pollForItemAddResult(
  link_token: string
): Promise<{ publicToken: string; institutionName?: string; institutionId?: string } | undefined> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const tokenRes = await plaidClient.linkTokenGet({ link_token });
    const sessions = tokenRes.data.link_sessions ?? [];
    const result = sessions
      .flatMap((s) => s.results?.item_add_results ?? [])
      .find((r) => r.public_token);
    if (result) {
      return {
        publicToken: result.public_token,
        institutionName: result.institution?.name ?? undefined,
        institutionId: result.institution?.institution_id ?? undefined,
      };
    }
    if (attempt < 7) await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return undefined;
}

export async function POST(req: NextRequest) {
  const authed = await requireUser(req);
  if ("response" in authed) return authed.response;

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const { link_token, institution_name } = parsed.data;

  const result = await pollForItemAddResult(link_token);
  if (!result) {
    return NextResponse.json({ error: "Link session not completed" }, { status: 409 });
  }

  // Prefer the institution name Plaid recorded for the session over the client's
  // placeholder, so Banks shows e.g. "Tangerine - Personal" rather than "Bank".
  const resolvedInstitutionName = result.institutionName ?? institution_name;

  // Same-institution dedup guard: relinking a bank creates a NEW Plaid item,
  // so item_id can't dedupe — the institution can. A second live connection to
  // the same institution would import every account twice (and hide the
  // transfers between the copies). Legacy rows predate plaidInstitutionId, so
  // the name is the fallback identity.
  const existing = await db
    .select({
      id: bankConnections.id,
      status: bankConnections.status,
      plaidInstitutionId: bankConnections.plaidInstitutionId,
      institutionName: bankConnections.institutionName,
    })
    .from(bankConnections)
    .where(eq(bankConnections.userId, authed.userId));
  const duplicate = existing.find(
    (c) =>
      c.status === "active" &&
      (result.institutionId
        ? c.plaidInstitutionId === result.institutionId
        : c.institutionName.toLowerCase() === resolvedInstitutionName.toLowerCase())
  );
  if (duplicate) {
    return NextResponse.json(
      {
        error: `${resolvedInstitutionName} is already connected. To fix a broken connection, relink it from the Banks tab instead of adding it again.`,
      },
      { status: 409 }
    );
  }

  const exchangeRes = await plaidClient.itemPublicTokenExchange({
    public_token: result.publicToken,
  });
  const { access_token, item_id } = exchangeRes.data;

  const connectionId = uuidv4();
  await db.insert(bankConnections).values({
    id: connectionId,
    userId: authed.userId,
    institutionName: resolvedInstitutionName,
    plaidInstitutionId: result.institutionId ?? null,
    plaidItemId: item_id,
    plaidAccessToken: encrypt(access_token),
    status: "active",
    createdAt: Math.floor(Date.now() / 1000),
  });

  await syncAccountsForConnection(
    connectionId,
    authed.userId,
    access_token,
    resolvedInstitutionName
  );

  return NextResponse.json({ ok: true });
}
