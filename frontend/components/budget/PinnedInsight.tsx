/**
 * The one Claude card pinned to the top of the budget tab. It shows the most
 * important pending card — a ready-to-apply "trim" if there is one, so it can be
 * approved right here — with a link into the full Insights screen for the rest.
 * This is what un-buries the analyses without handing the tab back to a wall of
 * cards.
 */
import { View, Text, Pressable, ActivityIndicator } from "react-native";
import { COLORS } from "@/constants/theme";
import type { LLMCard } from "@/hooks/useBudget";

interface PinnedInsightProps {
  card: LLMCard;
  /** How many cards remain behind this one; drives the "N more" link. */
  moreCount: number;
  busy: boolean;
  error?: string;
  flash?: string | null;
  onApprove: () => void;
  onDismiss: () => void;
  onOpenAll: () => void;
}

export function PinnedInsight({
  card,
  moreCount,
  busy,
  error,
  flash,
  onApprove,
  onDismiss,
  onOpenAll,
}: PinnedInsightProps) {
  // Same gate the full card list uses: an "action" card is only actionable when
  // it carries a resolvable move, otherwise it reads as an insight.
  const isTrim =
    card.type === "action" &&
    !!card.envelope_from &&
    !!card.envelope_to &&
    Number.isFinite(card.amount) &&
    (card.amount ?? 0) > 0;

  return (
    <View
      style={{
        backgroundColor: isTrim ? COLORS.actionBg : COLORS.insightBg,
        borderWidth: 1,
        borderColor: isTrim ? COLORS.actionBorder : COLORS.insightBorder,
        borderRadius: 14,
        padding: 14,
        marginBottom: 16,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 }}>
        <Text style={{ fontSize: 13 }}>💡</Text>
        <Text style={{ color: COLORS.textMuted, fontSize: 11, fontWeight: "700", letterSpacing: 0.4 }}>
          {isTrim ? "SUGGESTED TRIM" : "INSIGHT"}
        </Text>
      </View>

      {flash ? (
        <Text style={{ color: COLORS.success, fontSize: 13, marginBottom: 6 }}>{flash}</Text>
      ) : null}

      <Text style={{ color: COLORS.textPrimary, fontWeight: "700", fontSize: 15, marginBottom: 4 }}>
        {card.title}
      </Text>
      <Text style={{ color: COLORS.textMuted, fontSize: 13, lineHeight: 20 }} numberOfLines={3}>
        {card.body}
      </Text>

      {isTrim && (
        <>
          <Text style={{ color: COLORS.textPrimary, fontSize: 12, marginTop: 8 }}>
            Moves ${(card.amount ?? 0).toFixed(2)} from {card.envelope_from} to {card.envelope_to} this month.
          </Text>
          {error ? (
            <Text style={{ color: COLORS.danger, fontSize: 12, marginTop: 6 }}>{error}</Text>
          ) : null}
          <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
            <Pressable
              onPress={onApprove}
              disabled={busy}
              style={{
                flex: 1,
                backgroundColor: COLORS.brandBlue,
                opacity: busy ? 0.6 : 1,
                borderRadius: 8,
                paddingVertical: 8,
                alignItems: "center",
              }}
            >
              {busy ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={{ color: "#fff", fontWeight: "600", fontSize: 13 }}>Apply</Text>
              )}
            </Pressable>
            <Pressable
              onPress={onDismiss}
              disabled={busy}
              style={{
                flex: 1,
                backgroundColor: COLORS.glassBg,
                borderWidth: 1,
                borderColor: COLORS.glassBorder,
                borderRadius: 8,
                paddingVertical: 8,
                alignItems: "center",
              }}
            >
              <Text style={{ color: COLORS.textMuted, fontSize: 13 }}>Dismiss</Text>
            </Pressable>
          </View>
        </>
      )}

      <Pressable
        onPress={onOpenAll}
        hitSlop={6}
        style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 12 }}
      >
        <Text style={{ color: COLORS.brandPurple, fontSize: 13, fontWeight: "600" }}>
          {moreCount > 0 ? `${moreCount} more insight${moreCount === 1 ? "" : "s"}` : "See all insights"}
        </Text>
        <Text style={{ color: COLORS.brandPurple, fontSize: 16 }}>›</Text>
      </Pressable>
    </View>
  );
}
