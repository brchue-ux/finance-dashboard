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
  /** Opens the trending-vs-typical detail for this envelope (6d). */
  onPress?: () => void;
}

/**
 * Pace label for an in-progress month (6d): is spend ahead of or behind the
 * straight-line burn of the target so far? Under pace is the good direction, so
 * it reads green; over pace reads as caution, not failure — a month that ends
 * over its own-average target is normal, so the default framing is pace, not a
 * pass/fail verdict.
 */
function paceLabel(spent: number, expectedByNow: number): { text: string; color: string } {
  if (expectedByNow <= 0) return { text: "On pace", color: COLORS.textMuted };
  const ratio = spent / expectedByNow;
  if (ratio > 1.1) return { text: "Over pace", color: COLORS.warning };
  if (ratio < 0.9) return { text: "Under pace", color: COLORS.success };
  return { text: "On pace", color: COLORS.textMuted };
}

export function EnvelopeCard({ envelope, onSetTarget, onPress }: EnvelopeCardProps) {
  const progress = envelope.allocated > 0 ? envelope.spent / envelope.allocated : 0;
  // An in-progress month is where pace framing applies; a finished month
  // (fraction 1, or older navigation) falls back to plain spent-vs-target.
  const inProgress =
    envelope.monthFraction != null &&
    envelope.monthFraction < 1 &&
    envelope.expectedByNow != null &&
    // Pace against a straight-line burn only means something with a real target;
    // a deliberate $0 budget with spend is genuinely over, not "on pace".
    envelope.allocated > 0;

  // No target set: report the spend plainly and prompt for a budget. Showing a
  // progress bar or an "over by" figure here would be inventing a limit the
  // user never set.
  if (envelope.unconfigured) {
    return (
      <Wrap onPress={onPress}>
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
      </Wrap>
    );
  }

  const pace = inProgress ? paceLabel(envelope.spent, envelope.expectedByNow!) : null;

  return (
    <Wrap onPress={onPress}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <Text style={{ color: COLORS.textPrimary, fontWeight: "600", fontSize: 15 }}>
          {envelope.name}
        </Text>
        {pace ? (
          <Text style={{ color: pace.color, fontSize: 13, fontWeight: "600" }}>{pace.text}</Text>
        ) : (
          <Text style={{ color: envelope.overBudget ? COLORS.danger : COLORS.textMuted, fontSize: 13 }}>
            {fmt(envelope.spent)} / {fmt(envelope.allocated)}
          </Text>
        )}
      </View>
      {/* The marker is where spend should be by now; the fill is where it is. */}
      <ProgressBar
        progress={progress}
        overBudget={envelope.overBudget}
        marker={inProgress ? envelope.monthFraction : undefined}
      />
      {inProgress ? (
        <Text style={{ color: COLORS.textMuted, fontSize: 12, marginTop: 4 }}>
          {fmt(envelope.spent)} of {fmt(envelope.allocated)} · {fmt(envelope.expectedByNow!)} expected by now
        </Text>
      ) : (
        envelope.overBudget && (
          <Text style={{ color: COLORS.danger, fontSize: 12, marginTop: 4 }}>
            Over by {fmt(envelope.spent - envelope.allocated)}
          </Text>
        )
      )}
    </Wrap>
  );
}

/** Card body, made tappable only when there's somewhere to go. */
function Wrap({ onPress, children }: { onPress?: () => void; children: React.ReactNode }) {
  if (onPress) {
    return (
      <Pressable onPress={onPress}>
        <GlassCard style={{ marginBottom: 10 }}>{children}</GlassCard>
      </Pressable>
    );
  }
  return <GlassCard style={{ marginBottom: 10 }}>{children}</GlassCard>;
}
