/**
 * Account-connection flows (spec §5). Both providers use the same no-native-SDK
 * pattern: the backend mints a hosted URL, we open it in an in-app browser via
 * expo-web-browser, and the provider redirects back to our custom scheme when
 * the user finishes. openAuthSessionAsync resolves on that redirect, after which
 * we tell the backend to finalize (exchange token / pull holdings).
 *
 * The redirect URIs here must match what the backend sets as the completion
 * targets (link/token/create -> plaid-hosted-link-complete; snaptrade/connect
 * -> snaptrade-complete) and the app scheme in app.config.ts ("finance-dashboard").
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as WebBrowser from "expo-web-browser";
import { api } from "@/lib/api";
import { setPendingPlaidLinkToken, takePendingPlaidLinkToken } from "@/lib/pending-connection";

const PLAID_REDIRECT = "finance-dashboard://plaid-hosted-link-complete";
const SNAPTRADE_REDIRECT = "finance-dashboard://snaptrade-complete";

/** "connected" = finalized on the backend; "cancelled" = user closed the browser. */
export type ConnectOutcome = "connected" | "cancelled";

export function useConnectBank() {
  const qc = useQueryClient();
  return useMutation<ConnectOutcome, Error, void>({
    mutationFn: async () => {
      const { link_token, hosted_link_url } = await api.post<{
        link_token: string;
        hosted_link_url: string | null;
      }>("/api/link/token/create", { platform: "native" });
      if (!hosted_link_url) throw new Error("Plaid did not return a hosted link URL.");

      // Stash the token so the deep-link completion route can finalize if the
      // redirect arrives as a route (finance-dashboard:///…) instead of resolving
      // inside openAuthSessionAsync — which is what Hosted Link actually does.
      setPendingPlaidLinkToken(link_token);
      const res = await WebBrowser.openAuthSessionAsync(hosted_link_url, PLAID_REDIRECT);
      if (res.type !== "success") {
        // Not a clean in-session return. If the deep-link route handled it, the
        // token is already taken; otherwise the user genuinely cancelled.
        return "cancelled";
      }

      // In-session return worked. Claim the token (so the route won't also
      // finalize) and exchange. Hosted Link keeps the public_token server-side;
      // the backend retrieves it from the link_token. Real account names come
      // from the sync it runs, so a generic label is fine for a first connection.
      const token = takePendingPlaidLinkToken();
      if (!token) return "connected"; // route already finalized it
      await api.post("/api/plaid/hosted-complete", {
        link_token: token,
        institution_name: "Bank",
      });
      return "connected";
    },
    onSuccess: (outcome) => {
      if (outcome === "connected") {
        qc.invalidateQueries({ queryKey: ["banks"] });
        qc.invalidateQueries({ queryKey: ["reports"] });
      }
    },
  });
}

export function useConnectBrokerage() {
  const qc = useQueryClient();
  return useMutation<ConnectOutcome, Error, void>({
    mutationFn: async () => {
      const { redirectUri } = await api.post<{ redirectUri?: string }>(
        "/api/snaptrade/connect",
        { platform: "native" }
      );
      if (!redirectUri) throw new Error("SnapTrade did not return a connection URL.");

      const res = await WebBrowser.openAuthSessionAsync(redirectUri, SNAPTRADE_REDIRECT);
      if (res.type !== "success") return "cancelled";

      await api.post("/api/snaptrade/sync", {});
      return "connected";
    },
    onSuccess: (outcome) => {
      if (outcome === "connected") {
        qc.invalidateQueries({ queryKey: ["portfolio"] });
        qc.invalidateQueries({ queryKey: ["reports"] });
      }
    },
  });
}
