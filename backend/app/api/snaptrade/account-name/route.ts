/**
 * PATCH /api/snaptrade/account-name — set the user's display name for one
 * Wealthsimple account. SnapTrade does not carry WS's own nicknames (every
 * account arrives as "Wealthsimple Trade <TYPE>"), so the names live here,
 * as a JSON map on the connection row, applied at read time by /api/portfolio.
 *
 * Body: { accountId: string, name: string } — empty name clears the entry.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-guard";
import { db } from "@/db";
import { wealthsimpleConnections } from "@/db/schema";
import { eq } from "drizzle-orm";

const MAX_NAME_LENGTH = 40;

export async function PATCH(req: NextRequest) {
  const authed = await requireUser(req);
  if ("response" in authed) return authed.response;

  const body = (await req.json().catch(() => null)) as
    | { accountId?: unknown; name?: unknown }
    | null;
  const accountId = typeof body?.accountId === "string" ? body.accountId.trim() : "";
  const name = typeof body?.name === "string" ? body.name.trim() : null;
  if (!accountId || name === null) {
    return NextResponse.json({ error: "accountId and name are required" }, { status: 400 });
  }
  if (name.length > MAX_NAME_LENGTH) {
    return NextResponse.json(
      { error: `name must be ${MAX_NAME_LENGTH} characters or fewer` },
      { status: 400 }
    );
  }

  const [conn] = await db
    .select({ id: wealthsimpleConnections.id, accountNames: wealthsimpleConnections.accountNames })
    .from(wealthsimpleConnections)
    .where(eq(wealthsimpleConnections.userId, authed.userId))
    .limit(1);
  if (!conn) return NextResponse.json({ error: "No connection" }, { status: 404 });

  const names: Record<string, string> = conn.accountNames ? JSON.parse(conn.accountNames) : {};
  if (name === "") delete names[accountId];
  else names[accountId] = name;

  await db
    .update(wealthsimpleConnections)
    .set({ accountNames: JSON.stringify(names) })
    .where(eq(wealthsimpleConnections.id, conn.id));

  return NextResponse.json({ ok: true, accountId, name: name === "" ? null : name });
}
