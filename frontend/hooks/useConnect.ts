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

      const res = await WebBrowser.openAuthSessionAsync(hosted_link_url, PLAID_REDIRECT);
      if (res.type !== "success") return "cancelled";

      // Hosted Link keeps the public_token server-side; we hand back only the
      // link_token and let the backend retrieve + exchange it. Real account
      // names/types are filled by the sync the backend runs on completion, so a
      // generic institution label here is fine for a first connection.
      await api.post("/api/plaid/hosted-complete", {
        link_token,
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
