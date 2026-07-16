/**
 * Settings tab — spec §9 Settings Screen.
 */
import { View, Text, ScrollView, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { GradientText } from "@/components/ui/GradientText";
import { GlassCard } from "@/components/ui/GlassCard";
import { COLORS } from "@/constants/theme";
import { usePortfolio } from "@/hooks/usePortfolio";
import { useBudget } from "@/hooks/useBudget";
import { signOut } from "@/lib/auth";

function timeAgo(ts: number | null | undefined): string {
  if (!ts) return "Never";
  const diff = Math.floor(Date.now() / 1000 - ts);
  if (diff < 60) return "Just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export default function SettingsScreen() {
  const router = useRouter();
  const portfolioQuery = usePortfolio();
  const now = new Date();
  const budgetQuery = useBudget(now.getFullYear(), now.getMonth() + 1);

  const bankConnections = budgetQuery.data?.bankConnections ?? [];
  const wsConn = portfolioQuery.data?.connection;

  async function handleSignOut() {
    await signOut();
    router.replace("/(auth)/login");
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.background }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>
        <GradientText style={{ fontSize: 28, fontWeight: "800", marginBottom: 24 }}>
          Settings
        </GradientText>

        {/* Connected Accounts */}
        <Text style={{ color: COLORS.textMuted, fontSize: 12, fontWeight: "600", letterSpacing: 1, marginBottom: 10 }}>
          CONNECTED ACCOUNTS
        </Text>
        <GlassCard style={{ marginBottom: 20, gap: 0 }}>
          {bankConnections.map((conn, i) => (
            <View
              key={conn.institution}
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "center",
                paddingVertical: 14,
                borderBottomWidth: i < bankConnections.length - 1 ? 1 : 0,
                borderBottomColor: COLORS.glassBorder,
              }}
            >
              <View>
                <Text style={{ color: COLORS.textPrimary, fontWeight: "600", fontSize: 15 }}>
                  {conn.institution}
                </Text>
                <Text style={{ color: COLORS.textMuted, fontSize: 12 }}>
                  Last synced {timeAgo(conn.lastSyncedAt)}
                </Text>
              </View>
              {conn.status === "relink_required" ? (
                <Pressable
                  style={{
                    backgroundColor: COLORS.warning + "33",
                    borderRadius: 8,
                    paddingHorizontal: 10,
                    paddingVertical: 5,
                  }}
                >
                  <Text style={{ color: COLORS.warning, fontWeight: "600", fontSize: 13 }}>⚠ Relink</Text>
                </Pressable>
              ) : (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                  <View style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: COLORS.success }} />
                  <Text style={{ color: COLORS.success, fontSize: 13 }}>Live</Text>
                </View>
              )}
            </View>
          ))}

          {/* Wealthsimple */}
          <View
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "center",
              paddingVertical: 14,
              borderTopWidth: bankConnections.length > 0 ? 1 : 0,
              borderTopColor: COLORS.glassBorder,
            }}
          >
            <View>
              <Text style={{ color: COLORS.textPrimary, fontWeight: "600", fontSize: 15 }}>Wealthsimple</Text>
              <Text style={{ color: COLORS.textMuted, fontSize: 12 }}>
                Last synced {timeAgo(wsConn?.lastSyncedAt)}
              </Text>
            </View>
            {wsConn?.status === "reconnect_required" ? (
              <Pressable
                style={{
                  backgroundColor: COLORS.warning + "33",
                  borderRadius: 8,
                  paddingHorizontal: 10,
                  paddingVertical: 5,
                }}
              >
                <Text style={{ color: COLORS.warning, fontWeight: "600", fontSize: 13 }}>⚠ Reconnect</Text>
              </Pressable>
            ) : (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                <View
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: 3.5,
                    backgroundColor: wsConn ? COLORS.success : COLORS.textMuted,
                  }}
                />
                <Text style={{ color: wsConn ? COLORS.success : COLORS.textMuted, fontSize: 13 }}>
                  {wsConn ? "Live" : "Not connected"}
                </Text>
              </View>
            )}
          </View>
        </GlassCard>

        {/* Data */}
        <Text style={{ color: COLORS.textMuted, fontSize: 12, fontWeight: "600", letterSpacing: 1, marginBottom: 10 }}>
          DATA
        </Text>
        <GlassCard style={{ marginBottom: 20 }}>
          <Pressable style={{ paddingVertical: 10 }}>
            <Text style={{ color: COLORS.textPrimary, fontSize: 15 }}>Import historical data</Text>
            <Text style={{ color: COLORS.textMuted, fontSize: 12, marginTop: 2 }}>
              Google Sheets or CSV
            </Text>
          </Pressable>
        </GlassCard>

        {/* Account */}
        <Text style={{ color: COLORS.textMuted, fontSize: 12, fontWeight: "600", letterSpacing: 1, marginBottom: 10 }}>
          ACCOUNT
        </Text>
        <GlassCard>
          <Pressable onPress={handleSignOut} style={{ paddingVertical: 10 }}>
            <Text style={{ color: COLORS.danger, fontSize: 15, fontWeight: "600" }}>Sign Out</Text>
          </Pressable>
        </GlassCard>
      </ScrollView>
    </SafeAreaView>
  );
}
