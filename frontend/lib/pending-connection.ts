/**
 * Bridges the account-connection browser handoff to the deep-link route that
 * finalizes it. Plaid Hosted Link redirects back to our custom scheme, which
 * Expo Router receives as a deep-link route (finance-dashboard:///plaid-hosted-
 * link-complete) rather than always resolving inside openAuthSessionAsync — so
 * the completing route needs the link_token minted when the flow began.
 *
 * Held in module memory: during the in-app browser the app is backgrounded, not
 * killed, so the value survives. take* clears it so exactly one path (either the
 * openAuthSessionAsync return in useConnect OR the deep-link route) finalizes.
 */
let pendingPlaidLinkToken: string | null = null;

export function setPendingPlaidLinkToken(token: string): void {
  pendingPlaidLinkToken = token;
}

export function takePendingPlaidLinkToken(): string | null {
  const token = pendingPlaidLinkToken;
  pendingPlaidLinkToken = null;
  return token;
}
