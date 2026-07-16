/**
 * Alerts tab — spec §9 Alerts Screen.
 */
import { useState } from "react";
import { ScrollView, View, Text, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { GradientText } from "@/components/ui/GradientText";
import { AlertCard } from "@/components/alerts/AlertCard";
import { ConversationSheet } from "@/components/llm/ConversationSheet";
import { COLORS } from "@/constants/theme";
import { useAlerts, type TradingViewAlert } from "@/hooks/useAlerts";

export default function AlertsScreen() {
  const { data, isLoading } = useAlerts();
  const [chatOpen, setChatOpen] = useState(false);
  const [activeAlert, setActiveAlert] = useState<TradingViewAlert | null>(null);

  if (isLoading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.background, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator color={COLORS.brandPurple} />
      </SafeAreaView>
    );
  }

  const unread = data?.alerts.filter((a) => a.unread) ?? [];
  const read = data?.alerts.filter((a) => !a.unread) ?? [];

  function openAnalysis(alert: TradingViewAlert) {
    setActiveAlert(alert);
    setChatOpen(true);
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.background }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
        {/* Header */}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 20 }}>
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

        {unread.length > 0 && (
          <>
            <Text style={{ color: COLORS.textMuted, fontSize: 12, fontWeight: "600", marginBottom: 8, letterSpacing: 1 }}>
              UNREAD
            </Text>
            {unread.map((alert) => (
              <AlertCard
                key={alert.id}
                alert={alert}
                onPress={() => openAnalysis(alert)}
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
                onPress={() => openAnalysis(alert)}
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
              Set up TradingView alerts pointing to your Railway webhook URL
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
                condition: activeAlert.conditionText,
                price: activeAlert.price,
                interval: activeAlert.interval,
              })
            : undefined
        }
      />
    </SafeAreaView>
  );
}
