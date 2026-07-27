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
import {
  connectionNeedsAction,
  connectionStatusColor,
  connectionStatusLabel,
} from "@/lib/connection-status";

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
              {connectionNeedsAction(conn.status) ? (
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
                  <View
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: 3.5,
                      backgroundColor: connectionStatusColor(conn.status),
                    }}
                  />
                  <Text style={{ color: connectionStatusColor(conn.status), fontSize: 13 }}>
                    {connectionStatusLabel(conn.status)}
                  </Text>
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
            {connectionNeedsAction(wsConn?.status) ? (
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
                    backgroundColor: wsConn ? connectionStatusColor(wsConn.status) : COLORS.textMuted,
                  }}
                />
                <Text
                  style={{
                    color: wsConn ? connectionStatusColor(wsConn.status) : COLORS.textMuted,
                    fontSize: 13,
                  }}
                >
                  {wsConn ? connectionStatusLabel(wsConn.status) : "Not connected"}
                </Text>
              </View>
            )}
          </View>
        </GlassCard>

        {/* Alerts */}
        <Text style={{ color: COLORS.textMuted, fontSize: 12, fontWeight: "600", letterSpacing: 1, marginBottom: 10 }}>
          ALERTS
        </Text>
        <GlassCard style={{ marginBottom: 20 }}>
          <Pressable onPress={() => router.push("/manage-alerts")} style={{ paddingVertical: 10 }}>
            <Text style={{ color: COLORS.textPrimary, fontSize: 15 }}>Manage price alerts</Text>
            <Text style={{ color: COLORS.textMuted, fontSize: 12, marginTop: 2 }}>
              Native alerts — no third-party plan needed
            </Text>
          </Pressable>
          <View style={{ height: 1, backgroundColor: COLORS.glassBorder }} />
          <Pressable onPress={() => router.push("/tradingview-alerts")} style={{ paddingVertical: 10 }}>
            <Text style={{ color: COLORS.textPrimary, fontSize: 15 }}>TradingView webhooks</Text>
            <Text style={{ color: COLORS.textMuted, fontSize: 12, marginTop: 2 }}>
              Optional · requires a paid TradingView plan
            </Text>
          </Pressable>
        </GlassCard>

        {/* Data */}
        <Text style={{ color: COLORS.textMuted, fontSize: 12, fontWeight: "600", letterSpacing: 1, marginBottom: 10 }}>
          DATA
        </Text>
        <GlassCard style={{ marginBottom: 20 }}>
          <Pressable onPress={() => router.push("/import")} style={{ paddingVertical: 10 }}>
            <Text style={{ color: COLORS.textPrimary, fontSize: 15 }}>Import transactions</Text>
            <Text style={{ color: COLORS.textMuted, fontSize: 12, marginTop: 2 }}>
              CSV upload, Google Sheets or Excel
            </Text>
          </Pressable>
          <Pressable onPress={() => router.push("/manage-transfer-patterns")} style={{ paddingVertical: 10 }}>
            <Text style={{ color: COLORS.textPrimary, fontSize: 15 }}>Transfer patterns</Text>
            <Text style={{ color: COLORS.textMuted, fontSize: 12, marginTop: 2 }}>
              Which descriptions mean money moving between your own accounts
            </Text>
          </Pressable>
        </GlassCard>

        {/* System */}
        <Text style={{ color: COLORS.textMuted, fontSize: 12, fontWeight: "600", letterSpacing: 1, marginBottom: 10 }}>
          SYSTEM
        </Text>
        <GlassCard style={{ marginBottom: 20 }}>
          <Pressable onPress={() => router.push("/system-status")} style={{ paddingVertical: 10 }}>
            <Text style={{ color: COLORS.textPrimary, fontSize: 15 }}>System status</Text>
            <Text style={{ color: COLORS.textMuted, fontSize: 12, marginTop: 2 }}>
              Sync health, background jobs, import history
            </Text>
          </Pressable>
          <View style={{ height: 1, backgroundColor: COLORS.glassBorder }} />
          <Pressable onPress={() => router.push("/developer")} style={{ paddingVertical: 10 }}>
            <Text style={{ color: COLORS.textPrimary, fontSize: 15 }}>Developer</Text>
            <Text style={{ color: COLORS.textMuted, fontSize: 12, marginTop: 2 }}>
              Raw job run logs
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
