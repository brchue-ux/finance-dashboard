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

  // Hosted Link (spec §5.1) — the current sanctioned no-native-SDK path.
  // completion_redirect_uri is Hosted Link's own "session done" signal back
  // into the app (custom scheme on native). Distinct from redirect_uri above,
  // which is RBC's OAuth handoff only. Web sessions omit it and detect
  // completion via the hosted-complete endpoint after the popup closes.
  const body = (await req.json().catch(() => ({}))) as { platform?: "native" | "web" };

  const response = await plaidClient.linkTokenCreate({
    user: { client_user_id: session.user.id },
    client_name: "Finance Dashboard",
    products: [Products.Transactions],
    country_codes: [CountryCode.Ca],
    language: "en",
    ...(redirectUri ? { redirect_uri: redirectUri } : {}),
    hosted_link: {
      ...(body.platform === "native"
        ? { completion_redirect_uri: "finance-dashboard://plaid-hosted-link-complete" }
        : {}),
    },
  });

  return NextResponse.json({
    link_token: response.data.link_token,
    hosted_link_url: response.data.hosted_link_url,
  });
}
