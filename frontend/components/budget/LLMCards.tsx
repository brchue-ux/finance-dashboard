import { View, Text, Pressable, ActivityIndicator } from "react-native";
import { COLORS } from "@/constants/theme";
import type { LLMCard } from "@/hooks/useBudget";

interface LLMCardsProps {
  cards: LLMCard[];
  lastAnalyzedAt: number | null;
  isLoading: boolean;
  onReanalyze: () => void;
  onApproveAction?: (card: LLMCard) => void;
  onDismissAction?: (card: LLMCard) => void;
}

function timeAgo(ts: number): string {
  const diff = Math.floor((Date.now() / 1000) - ts);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function LLMCards({
  cards,
  lastAnalyzedAt,
  isLoading,
  onReanalyze,
  onApproveAction,
  onDismissAction,
}: LLMCardsProps) {
  return (
    <View>
      {/* LLM bar */}
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <Text style={{ color: COLORS.textMuted, fontSize: 13 }}>
          {isLoading ? "Analyzing..." : lastAnalyzedAt ? `✦ Analyzed ${timeAgo(lastAnalyzedAt)}` : "✦ Not yet analyzed"}
        </Text>
        <Pressable onPress={onReanalyze} disabled={isLoading}>
          {isLoading ? (
            <ActivityIndicator size="small" color={COLORS.brandPurple} />
          ) : (
            <Text style={{ color: COLORS.brandPurple, fontSize: 13, fontWeight: "600" }}>Re-analyze</Text>
          )}
        </Pressable>
      </View>

      {/* Cards */}
      {cards.map((card, i) => (
        <LLMCardView
          key={i}
          card={card}
          onApprove={() => onApproveAction?.(card)}
          onDismiss={() => onDismissAction?.(card)}
        />
      ))}
    </View>
  );
}

function LLMCardView({
  card,
  onApprove,
  onDismiss,
}: {
  card: LLMCard;
  onApprove: () => void;
  onDismiss: () => void;
}) {
  const isAction = card.type === "action";
  const bgColor = isAction ? COLORS.actionBg : COLORS.insightBg;
  const borderColor = isAction ? COLORS.actionBorder : COLORS.insightBorder;

  return (
    <View
      style={{
        backgroundColor: bgColor,
        borderWidth: 1,
        borderColor,
        borderRadius: 12,
        padding: 14,
        marginBottom: 10,
      }}
    >
      <Text style={{ color: COLORS.textPrimary, fontWeight: "700", fontSize: 15, marginBottom: 4 }}>
        {card.title}
      </Text>
      <Text style={{ color: COLORS.textMuted, fontSize: 13, lineHeight: 20, marginBottom: 8 }}>
        {card.body}
      </Text>
      <Text style={{ color: COLORS.textMuted, fontSize: 11, fontStyle: "italic", marginBottom: isAction ? 10 : 0 }}>
        {card.reasoning}
      </Text>

      {isAction && (
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Pressable
            onPress={onApprove}
            style={{
              flex: 1,
              backgroundColor: COLORS.brandBlue,
              borderRadius: 8,
              paddingVertical: 8,
              alignItems: "center",
            }}
          >
            <Text style={{ color: "#fff", fontWeight: "600", fontSize: 13 }}>Approve</Text>
          </Pressable>
          <Pressable
            onPress={onDismiss}
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
      )}
    </View>
  );
}
