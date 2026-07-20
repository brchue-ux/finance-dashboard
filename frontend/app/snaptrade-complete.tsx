/**
 * SnapTrade connection completion (spec §5.2). SnapTrade's hosted portal
 * redirects here via the app's custom scheme (finance-dashboard:///snaptrade-
 * complete) after the brokerage OAuth. No token to carry — the connection is
 * already stored server-side under the user — so we just pull holdings and
 * return the user to their portfolio. Sync is debounced server-side, so it's
 * safe if useConnect's in-session return also fired one.
 */
import { useEffect, useRef, useState } from "react";
import { View, Text, ActivityIndicator, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import * as WebBrowser from "expo-web-browser";
import { COLORS } from "@/constants/theme";
import { api } from "@/lib/api";

export default function SnapTradeComplete() {
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
      try {
        await api.post("/api/snaptrade/sync", {});
        qc.invalidateQueries({ queryKey: ["portfolio"] });
        qc.invalidateQueries({ queryKey: ["reports"] });
        router.replace("/(tabs)/portfolio" as never);
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
            The brokerage link didn’t complete. You can try again.
          </Text>
          <Pressable
            onPress={() => router.replace("/(tabs)/portfolio" as never)}
            style={{ marginTop: 20, backgroundColor: COLORS.brandPurple, borderRadius: 10, paddingVertical: 12, paddingHorizontal: 24 }}
          >
            <Text style={{ color: "#fff", fontWeight: "700" }}>Back to Portfolio</Text>
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
