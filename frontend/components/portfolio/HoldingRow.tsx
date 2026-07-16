import { View, Text, Pressable } from "react-native";
import { COLORS } from "@/constants/theme";
import type { Holding } from "@/hooks/usePortfolio";

interface HoldingRowProps {
  holding: Holding;
  onPress: () => void;
}

export function HoldingRow({ holding, onPress }: HoldingRowProps) {
  const costTotal = holding.costBasis * holding.quantity;
  const pnl = holding.marketValue - costTotal;
  const pnlPct = costTotal > 0 ? (pnl / costTotal) * 100 : 0;
  const isPositive = pnl >= 0;

  const accountBadgeColor: Record<string, string> = {
    tfsa: "#22C55E",
    rrsp: "#3B82F6",
    non_reg: "#F59E0B",
    crypto: "#8B5CF6",
  };

  return (
    <Pressable
      onPress={onPress}
      style={{
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        paddingVertical: 14,
        borderBottomWidth: 1,
        borderBottomColor: COLORS.glassBorder,
      }}
    >
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 2 }}>
          <Text style={{ color: COLORS.textPrimary, fontWeight: "700", fontSize: 15 }}>
            {holding.ticker}
          </Text>
          <View
            style={{
              backgroundColor: accountBadgeColor[holding.accountType] + "33",
              borderRadius: 4,
              paddingHorizontal: 6,
              paddingVertical: 1,
            }}
          >
            <Text style={{ color: accountBadgeColor[holding.accountType], fontSize: 10, fontWeight: "600" }}>
              {holding.accountType.toUpperCase()}
            </Text>
          </View>
        </View>
        <Text style={{ color: COLORS.textMuted, fontSize: 12 }} numberOfLines={1}>
          {holding.name} · {holding.quantity} shares
        </Text>
      </View>
      <View style={{ alignItems: "flex-end" }}>
        <Text style={{ color: COLORS.textPrimary, fontWeight: "600", fontSize: 15 }}>
          ${holding.marketValue.toFixed(2)}
        </Text>
        <Text style={{ color: isPositive ? COLORS.success : COLORS.danger, fontSize: 12 }}>
          {isPositive ? "+" : ""}${pnl.toFixed(2)} ({isPositive ? "+" : ""}{pnlPct.toFixed(1)}%)
        </Text>
      </View>
    </Pressable>
  );
}
