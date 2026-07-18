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

  // Required only for RBC's OAuth-based Link flow, and only once registered
  // in the Plaid dashboard (Team Settings -> API -> Allowed redirect URIs).
  // Plaid rejects the ENTIRE linkTokenCreate call (all institutions, not
  // just OAuth ones) if redirect_uri is set but not registered — so this
  // must stay unset in local/sandbox dev until that registration exists.
  // Must point to a page in the FRONTEND app (it re-invokes Plaid Link
  // client-side after the OAuth redirect), never a backend API route.
  const redirectUri = process.env.PLAID_REDIRECT_URI;

  const response = await plaidClient.linkTokenCreate({
    user: { client_user_id: session.user.id },
    client_name: "Finance Dashboard",
    products: [Products.Transactions],
    country_codes: [CountryCode.Ca],
    language: "en",
    ...(redirectUri ? { redirect_uri: redirectUri } : {}),
  });

  return NextResponse.json({ link_token: response.data.link_token });
}
