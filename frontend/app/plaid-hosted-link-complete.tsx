/**
 * Plaid Hosted Link completion (spec §5.1). Plaid redirects here via the app's
 * custom scheme (finance-dashboard:///plaid-hosted-link-complete) after the user
 * finishes linking — Expo Router receives it as this route rather than resolving
 * inside openAuthSessionAsync. Finalize with the link_token stashed at flow start,
 * refresh Banks, and return the user there.
 */
import { useEffect, useRef, useState } from "react";
import { View, Text, ActivityIndicator, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import * as WebBrowser from "expo-web-browser";
import { COLORS } from "@/constants/theme";
import { api } from "@/lib/api";
import { takePendingPlaidLinkToken } from "@/lib/pending-connection";

export default function PlaidHostedLinkComplete() {
  const router = useRouter();
  const qc = useQueryClient();
  const ran = useRef(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    (async () => {
      try {
        await WebBrowser.dismissBrowser();
      } catch {
        // no in-app browser to dismiss — fine
      }
      const token = takePendingPlaidLinkToken();
      if (!token) {
        // useConnect already finalized in-session, or there's nothing to do.
        router.replace("/(tabs)/banks" as never);
        return;
      }
      try {
        await api.post("/api/plaid/hosted-complete", { link_token: token, institution_name: "Bank" });
        qc.invalidateQueries({ queryKey: ["banks"] });
        qc.invalidateQueries({ queryKey: ["reports"] });
        router.replace("/(tabs)/banks" as never);
      } catch {
        setFailed(true);
      }
    })();
  }, [router, qc]);

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.background, alignItems: "center", justifyContent: "center", padding: 24 }}>
      {failed ? (
        <>
          <Text style={{ color: COLORS.textPrimary, fontSize: 16, fontWeight: "700", textAlign: "center" }}>
            Couldn’t finish connecting
          </Text>
          <Text style={{ color: COLORS.textMuted, fontSize: 13, marginTop: 6, textAlign: "center" }}>
            The bank link didn’t complete. You can try adding it again.
          </Text>
          <Pressable
            onPress={() => router.replace("/(tabs)/banks" as never)}
            style={{ marginTop: 20, backgroundColor: COLORS.brandPurple, borderRadius: 10, paddingVertical: 12, paddingHorizontal: 24 }}
          >
            <Text style={{ color: "#fff", fontWeight: "700" }}>Back to Banks</Text>
          </Pressable>
        </>
      ) : (
        <>
          <ActivityIndicator color={COLORS.brandPurple} />
          <Text style={{ color: COLORS.textMuted, fontSize: 14, marginTop: 12 }}>Finishing up…</Text>
        </>
      )}
    </View>
  );
}
