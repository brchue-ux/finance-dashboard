import { View, Text } from "react-native";
import { GlassCard } from "@/components/ui/GlassCard";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { COLORS } from "@/constants/theme";
import type { BudgetEnvelope } from "@/hooks/useBudget";

function fmt(n: number) {
  return `$${Math.abs(n).toFixed(0)}`;
}

interface EnvelopeCardProps {
  envelope: BudgetEnvelope;
}

export function EnvelopeCard({ envelope }: EnvelopeCardProps) {
  const progress = envelope.allocated > 0 ? envelope.spent / envelope.allocated : 0;

  return (
    <GlassCard style={{ marginBottom: 10 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 8 }}>
        <Text style={{ color: COLORS.textPrimary, fontWeight: "600", fontSize: 15 }}>
          {envelope.name}
        </Text>
        <Text
          style={{
            color: envelope.overBudget ? COLORS.danger : COLORS.textMuted,
            fontSize: 13,
          }}
        >
          {fmt(envelope.spent)} / {fmt(envelope.allocated)}
        </Text>
      </View>
      <ProgressBar progress={progress} overBudget={envelope.overBudget} />
      {envelope.overBudget && (
        <Text style={{ color: COLORS.danger, fontSize: 12, marginTop: 4 }}>
          Over by {fmt(envelope.spent - envelope.allocated)}
        </Text>
      )}
    </GlassCard>
  );
}
