/**
 * Envelope detail — the deeper dig behind a budget card (6d).
 *
 * The default budget view frames spend as PACE against the month. Tapping a
 * card opens this: TRENDING vs the user's own TYPICAL month for the category —
 * hotter or cooler than their normal, measured from real history rather than a
 * set limit. A target that is itself an average makes "over budget" the normal
 * state, so this answers the more useful question: unusual, or just this month?
 *
 * Content-sized root (no flex:1) so it fills correctly inside the caller's
 * content-height bottom sheet — a flex:1 root collapses to zero there.
 */
import { View, Text, Pressable } from "react-native";
import { COLORS } from "@/constants/theme";
import { ProgressBar } from "@/components/ui/ProgressBar";
import type { BudgetEnvelope } from "@/hooks/useBudget";
import { formatMoney } from "@/lib/money";

const money = (n: number) => formatMoney(n, { abs: true });

interface EnvelopeDetailSheetProps {
  envelope: BudgetEnvelope;
  onClose: () => void;
}

export function EnvelopeDetailSheet({ envelope, onClose }: EnvelopeDetailSheetProps) {
  const inProgress =
    envelope.monthFraction != null && envelope.monthFraction < 1 && envelope.monthFraction > 0;

  // For an in-progress month, compare the projected month-end total to typical
  // (comparing a partial month to a full-month average would always read cool);
  // for a finished month, compare the actual total.
  const projected = inProgress ? envelope.spent / envelope.monthFraction! : envelope.spent;
  const typical = envelope.typicalMonthly ?? null;

  const trend = typical != null && typical > 0 ? trendVerdict(projected / typical) : null;

  return (
    <View style={{ padding: 20 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <Text style={{ color: COLORS.textPrimary, fontSize: 18, fontWeight: "700" }}>{envelope.name}</Text>
        <Pressable onPress={onClose} hitSlop={10}>
          <Text style={{ color: COLORS.textMuted, fontSize: 15 }}>Done</Text>
        </Pressable>
      </View>

      {/* This month */}
      <Row label="Spent this month" value={money(envelope.spent)} />
      {envelope.allocated > 0 && <Row label="Budget" value={money(envelope.allocated)} />}
      {inProgress && (
        <Row
          label="On track to spend"
          value={money(projected)}
          hint={`at this pace, by month end`}
        />
      )}

      <View style={{ height: 1, backgroundColor: COLORS.glassBorder, marginVertical: 16 }} />

      {/* Trending vs typical */}
      {typical == null ? (
        <Text style={{ color: COLORS.textMuted, fontSize: 13, lineHeight: 19 }}>
          Not enough history yet to compare this month to your usual. After a few
          months of data, this will show whether you’re running hotter or cooler
          than normal here.
        </Text>
      ) : (
        <>
          <Text style={{ color: trend!.color, fontSize: 16, fontWeight: "700", marginBottom: 6 }}>
            {trend!.headline}
          </Text>
          <Text style={{ color: COLORS.textMuted, fontSize: 13, lineHeight: 19, marginBottom: 14 }}>
            You usually spend about {money(typical)}/mo here (over{" "}
            {envelope.typicalMonths ?? 0} months).{" "}
            {inProgress ? "You’re on track for " : "This month was "}
            {money(projected)}
            {trend!.deltaText}.
          </Text>
          {/* Bar of this-month-vs-typical: fill is projected/typical, the tick
              marks "typical" (1.0) so hotter overshoots it, cooler falls short. */}
          <ProgressBar progress={projected / (typical * 1.5)} marker={1 / 1.5} />
          <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 6 }}>
            <Text style={{ color: COLORS.textMuted, fontSize: 11 }}>This month {money(projected)}</Text>
            <Text style={{ color: COLORS.textMuted, fontSize: 11 }}>Typical {money(typical)}</Text>
          </View>
        </>
      )}
    </View>
  );
}

function trendVerdict(ratio: number): { headline: string; color: string; deltaText: string } {
  const pct = Math.round(Math.abs(ratio - 1) * 100);
  if (ratio > 1.15)
    return { headline: "Running hotter than usual", color: COLORS.warning, deltaText: ` — about ${pct}% more than typical` };
  if (ratio < 0.85)
    return { headline: "Cooler than usual", color: COLORS.success, deltaText: ` — about ${pct}% less than typical` };
  return { headline: "About typical", color: COLORS.textPrimary, deltaText: ", right around your normal" };
}

function Row({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 6 }}>
      <View>
        <Text style={{ color: COLORS.textPrimary, fontSize: 14 }}>{label}</Text>
        {hint && <Text style={{ color: COLORS.textMuted, fontSize: 11, marginTop: 1 }}>{hint}</Text>}
      </View>
      <Text style={{ color: COLORS.textPrimary, fontSize: 15, fontWeight: "600" }}>{value}</Text>
    </View>
  );
}
