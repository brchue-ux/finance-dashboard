import { View, Text, Pressable } from "react-native";
import { COLORS } from "@/constants/theme";
import type { UnifiedAlert } from "@/hooks/useAlerts";

interface AlertCardProps {
  alert: UnifiedAlert;
  onPress: () => void;
  onAnalyze: () => void;
}

const SEVERITY_COLORS: Record<UnifiedAlert["severity"], string> = {
  red: "#EF4444",
  yellow: "#F59E0B",
  green: "#22C55E",
};

const SOURCE_LABEL: Record<UnifiedAlert["source"], string> = {
  native: "Price alert",
  tradingview: "TradingView",
};

function timeAgo(ts: number): string {
  const diff = Math.floor(Date.now() / 1000 - ts);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function AlertCard({ alert, onPress, onAnalyze }: AlertCardProps) {
  const dotColor = SEVERITY_COLORS[alert.severity];

  return (
    <Pressable
      onPress={onPress}
      style={{
        backgroundColor: alert.unread ? COLORS.glassBg : "transparent",
        borderWidth: 1,
        borderColor: alert.unread ? COLORS.glassBorder : "transparent",
        borderRadius: 12,
        padding: 14,
        marginBottom: 10,
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 12,
      }}
    >
      {/* Severity dot */}
      <View
        style={{
          width: 8,
          height: 8,
          borderRadius: 4,
          backgroundColor: dotColor,
          marginTop: 5,
        }}
      />
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 2 }}>
          <Text style={{ color: COLORS.textPrimary, fontWeight: "700", fontSize: 15 }}>
            {alert.ticker}
          </Text>
          <Text style={{ color: COLORS.textMuted, fontSize: 12 }}>{timeAgo(alert.timestamp)}</Text>
        </View>
        <Text style={{ color: COLORS.textMuted, fontSize: 13, marginBottom: 6 }}>
          {alert.conditionLabel}
          {alert.price != null ? ` · $${alert.price.toFixed(2)}` : ""}
          {` · ${SOURCE_LABEL[alert.source]}`}
        </Text>
        <Pressable onPress={onAnalyze} hitSlop={8}>
          <Text style={{ color: COLORS.brandPurple, fontSize: 13, fontWeight: "600" }}>
            Analyze with Claude →
          </Text>
        </Pressable>
      </View>
    </Pressable>
  );
}
