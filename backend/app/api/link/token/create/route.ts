/**
 * POST /api/link/token/create
 * Creates a Plaid Link token for the authenticated user.
 * Frontend uses this to initialize the Plaid Link widget.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { plaidClient } from "@/lib/plaid";
import { CountryCode, Products } from "plaid";

export async function POST(req: NextRequest) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const backendUrl = process.env.BETTER_AUTH_URL ?? "http://localhost:3001";

  const response = await plaidClient.linkTokenCreate({
    user: { client_user_id: session.user.id },
    client_name: "Finance Dashboard",
    products: [Products.Transactions],
    country_codes: [CountryCode.Ca],
    language: "en",
    // Required for RBC OAuth redirect flow
    redirect_uri: `${backendUrl}/api/plaid/oauth-redirect`,
  });

  return NextResponse.json({ link_token: response.data.link_token });
}
