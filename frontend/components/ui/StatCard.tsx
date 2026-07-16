import { View, Text } from "react-native";
import { GlassCard } from "./GlassCard";
import { COLORS } from "@/constants/theme";

interface StatCardProps {
  label: string;
  value: string;
  valueColor?: string;
}

export function StatCard({ label, value, valueColor }: StatCardProps) {
  return (
    <GlassCard style={{ flex: 1, alignItems: "center", paddingVertical: 12 }}>
      <Text style={{ color: COLORS.textMuted, fontSize: 12, marginBottom: 4 }}>
        {label}
      </Text>
      <Text
        style={{
          color: valueColor ?? COLORS.textPrimary,
          fontSize: 18,
          fontWeight: "700",
        }}
      >
        {value}
      </Text>
    </GlassCard>
  );
}
