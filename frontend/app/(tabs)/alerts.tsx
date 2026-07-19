/**
 * Alerts tab — spec §9 Alerts Screen. Renders the unified feed (native fires +
 * TradingView events, normalized at /api/alerts). Card tap → Holding Detail
 * with alert context; "Analyze with Claude" → conversation sheet. Interacting
 * with an unread item marks it read.
 */
import { useState } from "react";
import { ScrollView, View, Text, Pressable, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { GradientText } from "@/components/ui/GradientText";
import { AlertCard } from "@/components/alerts/AlertCard";
import { ConversationSheet } from "@/components/llm/ConversationSheet";
import { COLORS } from "@/constants/theme";
import { useAlerts, useMarkAlertRead, type UnifiedAlert } from "@/hooks/useAlerts";

export default function AlertsScreen() {
  const { data, isLoading } = useAlerts();
  const markRead = useMarkAlertRead();
  const router = useRouter();
  const [chatOpen, setChatOpen] = useState(false);
  const [activeAlert, setActiveAlert] = useState<UnifiedAlert | null>(null);

  if (isLoading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.background, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator color={COLORS.brandPurple} />
      </SafeAreaView>
    );
  }

  const unread = data?.alerts.filter((a) => a.unread) ?? [];
  const read = data?.alerts.filter((a) => !a.unread) ?? [];

  function markIfUnread(alert: UnifiedAlert) {
    if (alert.unread) markRead.mutate({ id: alert.id, source: alert.source });
  }

  // Card body tap → Holding Detail for the ticker, carrying alert context so
  // that screen can surface the condition and pre-arm "Analyze with Claude".
  function openHolding(alert: UnifiedAlert) {
    markIfUnread(alert);
    router.push({
      pathname: "/holding/[ticker]",
      params: {
        ticker: alert.ticker,
        alertCondition: alert.conditionLabel,
        alertPrice: alert.price != null ? String(alert.price) : "",
      },
    } as any); // route file lands with the Holding Detail screen (task #4)
  }

  function openAnalysis(alert: UnifiedAlert) {
    markIfUnread(alert);
    setActiveAlert(alert);
    setChatOpen(true);
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.background }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
        {/* Header: title + unread badge + Manage alerts entry */}
        <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 20 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flex: 1 }}>
            <GradientText style={{ fontSize: 28, fontWeight: "800" }}>Alerts</GradientText>
            {(data?.unreadCount ?? 0) > 0 && (
              <View
                style={{
                  backgroundColor: COLORS.danger,
                  borderRadius: 12,
                  paddingHorizontal: 8,
                  paddingVertical: 3,
                }}
              >
                <Text style={{ color: "#fff", fontWeight: "700", fontSize: 13 }}>
                  {data!.unreadCount}
                </Text>
              </View>
            )}
          </View>
          <Pressable onPress={() => router.push("/manage-alerts")} hitSlop={8}>
            <Text style={{ color: COLORS.brandPurple, fontSize: 14, fontWeight: "600" }}>
              Manage alerts
            </Text>
          </Pressable>
        </View>

        {unread.length > 0 && (
          <>
            <Text style={{ color: COLORS.textMuted, fontSize: 12, fontWeight: "600", marginBottom: 8, letterSpacing: 1 }}>
              UNREAD
            </Text>
            {unread.map((alert) => (
              <AlertCard
                key={alert.id}
                alert={alert}
                onPress={() => openHolding(alert)}
                onAnalyze={() => openAnalysis(alert)}
              />
            ))}
          </>
        )}

        {read.length > 0 && (
          <>
            <Text style={{ color: COLORS.textMuted, fontSize: 12, fontWeight: "600", marginBottom: 8, marginTop: 16, letterSpacing: 1, opacity: 0.7 }}>
              EARLIER
            </Text>
            {read.map((alert) => (
              <AlertCard
                key={alert.id}
                alert={alert}
                onPress={() => openHolding(alert)}
                onAnalyze={() => openAnalysis(alert)}
              />
            ))}
          </>
        )}

        {data?.alerts.length === 0 && (
          <View style={{ alignItems: "center", marginTop: 64 }}>
            <Text style={{ color: COLORS.textMuted, fontSize: 40, marginBottom: 12 }}>🔔</Text>
            <Text style={{ color: COLORS.textMuted, fontSize: 15 }}>No alerts yet</Text>
            <Text style={{ color: COLORS.textMuted, fontSize: 13, marginTop: 6, textAlign: "center" }}>
              Create a price alert from “Manage alerts”, or point a TradingView
              alert at your webhook URL.
            </Text>
          </View>
        )}
      </ScrollView>

      <ConversationSheet
        visible={chatOpen}
        onClose={() => {
          setChatOpen(false);
          setActiveAlert(null);
        }}
        view="portfolio"
        alertContext={
          activeAlert
            ? JSON.stringify({
                ticker: activeAlert.ticker,
                condition: activeAlert.conditionLabel,
                price: activeAlert.price,
                source: activeAlert.source,
              })
            : undefined
        }
      />
    </SafeAreaView>
  );
}
