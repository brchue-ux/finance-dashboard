/**
 * GET /api/import/excel/start — begin the Microsoft (Excel/Graph) OAuth flow.
 * Redirects to Microsoft's consent screen; CSRF state stored in an httpOnly cookie.
 */
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { auth } from "@/lib/auth";
import { excelConsentUrl, excelConfigured } from "@/lib/import/excel";

export async function GET(req: NextRequest) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!excelConfigured()) {
    return NextResponse.json({ error: "Microsoft OAuth not configured" }, { status: 503 });
  }

  const state = randomUUID();
  const res = NextResponse.redirect(await excelConsentUrl(state));
  res.cookies.set("ms_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 600,
    path: "/",
  });
  return res;
}
