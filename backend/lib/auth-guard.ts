/**
 * The single authentication seam for API routes.
 *
 * Every route used to inline `auth.api.getSession()` + a `!session` check.
 * That is not sufficient, because Better Auth's `cookieCache` (30 days, see
 * lib/auth.ts) resolves a session from a *signed cookie with no DB lookup* —
 * so a session stays valid for up to a month against a user row that no longer
 * exists. That happens for real in three ways:
 *
 *   1. the account is deleted,
 *   2. the database is restored from a backup taken before the user signed up,
 *   3. the server is pointed at a different database (the dev test.db swap).
 *
 * In all three the client is not logged out. It is logged in as a ghost: every
 * read returns empty and every write fails `FOREIGN KEY constraint failed`, so
 * the app presents blank screens and 500s instead of a login prompt. A 401 is
 * the only honest answer — the client already knows how to recover from it.
 *
 * The existence check costs one indexed primary-key lookup per request, which
 * is the price of `cookieCache` being an optimization rather than a source of
 * truth. Keep it: the failure it prevents is silent and data-shaped, and it is
 * not recoverable by the user without knowing to sign out and back in.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { user } from "@/db/schema";
import { eq } from "drizzle-orm";

export type AuthedUser = { userId: string };
export type AuthFailure = { response: NextResponse };

/**
 * Resolve the caller, or produce the 401 to return.
 *
 * Callers discriminate on `"response" in result` and return it directly:
 *
 *   const authed = await requireUser(req);
 *   if ("response" in authed) return authed.response;
 *   const userId = authed.userId;
 */
export async function requireUser(req: NextRequest): Promise<AuthedUser | AuthFailure> {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return { response: unauthorized("NO_SESSION") };

  const userId = session.user.id;

  // The check cookieCache skips. A signed cookie proves the session was issued
  // by this server and has not expired — not that its subject still exists.
  const [row] = await db.select({ id: user.id }).from(user).where(eq(user.id, userId));
  if (!row) return { response: unauthorized("USER_NOT_FOUND") };

  return { userId };
}

/** Machine-readable so the client can tell the two cases apart — see frontend/lib/api.ts. */
export type UnauthorizedCode = "NO_SESSION" | "USER_NOT_FOUND";

function unauthorized(code: UnauthorizedCode) {
  // The body keeps `error: "Unauthorized"` so existing clients keep matching on
  // it. `code` is additive: USER_NOT_FOUND is the one 401 the client cannot
  // diagnose for itself, because its cached session still looks perfectly valid.
  return NextResponse.json({ error: "Unauthorized", code }, { status: 401 });
}
