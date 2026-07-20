import { View, Text, Pressable } from "react-native";
import { GlassCard } from "@/components/ui/GlassCard";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { COLORS } from "@/constants/theme";
import type { BudgetEnvelope } from "@/hooks/useBudget";

function fmt(n: number) {
  return `$${Math.abs(n).toFixed(0)}`;
}

interface EnvelopeCardProps {
  envelope: BudgetEnvelope;
  /** Opens envelope management; shown as the CTA when no target is set. */
  onSetTarget?: () => void;
}

export function EnvelopeCard({ envelope, onSetTarget }: EnvelopeCardProps) {
  const progress = envelope.allocated > 0 ? envelope.spent / envelope.allocated : 0;

  // No target set: report the spend plainly and prompt for a budget. Showing a
  // progress bar or an "over by" figure here would be inventing a limit the
  // user never set.
  if (envelope.unconfigured) {
    return (
      <GlassCard style={{ marginBottom: 10 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: COLORS.textPrimary, fontWeight: "600", fontSize: 15 }}>
              {envelope.name}
            </Text>
            <Text style={{ color: COLORS.textMuted, fontSize: 12, marginTop: 2 }}>
              {fmt(envelope.spent)} spent · no budget set
            </Text>
          </View>
          {onSetTarget && (
            <Pressable onPress={onSetTarget} hitSlop={8}>
              <Text style={{ color: COLORS.brandPurple, fontSize: 13, fontWeight: "600" }}>
                Set budget
              </Text>
            </Pressable>
          )}
        </View>
      </GlassCard>
    );
  }

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
