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

  // Plaid caches its Returning-User / Layer state against the exact client_user_id
  // string. In production we want a STABLE per-user id so returning-user and
  // update-mode flows work. But in sandbox, reusing one stable id makes every
  // retry look like a returning user, so Plaid hijacks the Hosted Link session
  // with Layer — which finishes with no on_success and thus no public_token
  // (the 409 we were hitting). A fresh id per session forces the standard
  // institution-picker + login that actually records on_success.public_token.
  const clientUserId =
    (process.env.PLAID_ENV ?? "sandbox") === "sandbox"
      ? `${session.user.id}-${crypto.randomUUID()}`
      : session.user.id;

  const response = await plaidClient.linkTokenCreate({
    user: { client_user_id: clientUserId },
    client_name: "Finance Dashboard",
    products: [Products.Transactions],
    country_codes: [CountryCode.Ca],
    language: "en",
    ...(redirectUri ? { redirect_uri: redirectUri } : {}),
    hosted_link: {
      ...(body.platform === "native"
        ? {
            completion_redirect_uri: "finance-dashboard://plaid-hosted-link-complete",
            // NOTE: hosted_link.is_mobile_app cannot be used here — Plaid rejects
            // linkTokenCreate with INVALID_FIELD unless a top-level redirect_uri is
            // ALSO set, and ours stays unset in sandbox (an unregistered redirect_uri
            // breaks every institution). Steering away from Layer must be done in the
            // Plaid Dashboard (disable Returning User / Layer), not via this flag.
          }
        : {}),
    },
  });

  return NextResponse.json({
    link_token: response.data.link_token,
    hosted_link_url: response.data.hosted_link_url,
  });
}
