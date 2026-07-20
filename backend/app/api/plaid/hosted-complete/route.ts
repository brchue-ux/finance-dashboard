/**
 * POST /api/plaid/hosted-complete
 * Completes a Hosted Link session: the frontend returns from the browser
 * handoff with only its link_token — the public_token lives server-side in the
 * session results (spec §5.1). Retrieves it, then does the same exchange +
 * account population as /api/plaid/exchange.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { plaidClient } from "@/lib/plaid";
import { db } from "@/db";
import { bankConnections } from "@/db/schema";
import { encrypt } from "@/lib/crypto";
import { syncAccountsForConnection } from "@/lib/plaid-accounts";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";

const bodySchema = z.object({
  link_token: z.string().min(1),
  institution_name: z.string().min(1),
});

/**
 * Hosted Link records the session's on_success (which holds the public_token)
 * asynchronously — it can lag a second or two behind the completion redirect
 * the client returns on, so a single immediate read often sees on_success: null.
 * Poll briefly and return as soon as it lands, rather than reporting the race
 * to the user as "not completed".
 */
async function pollForPublicToken(link_token: string): Promise<string | undefined> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const tokenRes = await plaidClient.linkTokenGet({ link_token });
    const publicToken = tokenRes.data.link_sessions
      ?.flatMap((s) => (s.on_success ? [s.on_success.public_token] : []))
      .at(-1);
    if (publicToken) return publicToken;
    if (attempt < 7) await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return undefined;
}

export async function POST(req: NextRequest) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const { link_token, institution_name } = parsed.data;

  const publicToken = await pollForPublicToken(link_token);
  if (!publicToken) {
    return NextResponse.json({ error: "Link session not completed" }, { status: 409 });
  }

  const exchangeRes = await plaidClient.itemPublicTokenExchange({ public_token: publicToken });
  const { access_token, item_id } = exchangeRes.data;

  const connectionId = uuidv4();
  await db.insert(bankConnections).values({
    id: connectionId,
    userId: session.user.id,
    institutionName: institution_name,
    plaidItemId: item_id,
    plaidAccessToken: encrypt(access_token),
    status: "active",
    createdAt: Math.floor(Date.now() / 1000),
  });

  await syncAccountsForConnection(connectionId, session.user.id, access_token, institution_name);

  return NextResponse.json({ ok: true });
}
