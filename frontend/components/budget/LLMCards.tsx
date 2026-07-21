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
  /** Title of the card whose reallocation is currently being applied. */
  busyTitle?: string | null;
  /** Per-card failure text, keyed by card title — e.g. a hallucinated envelope. */
  errors?: Record<string, string>;
  /** Confirmation of the last applied reallocation, shown above the cards. */
  flash?: string | null;
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
  busyTitle,
  errors,
  flash,
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

      {flash && (
        <View
          style={{
            backgroundColor: COLORS.insightBg,
            borderWidth: 1,
            borderColor: COLORS.success,
            borderRadius: 10,
            padding: 10,
            marginBottom: 10,
          }}
        >
          <Text style={{ color: COLORS.success, fontSize: 13 }}>{flash}</Text>
        </View>
      )}

      {/* Cards */}
      {cards.map((card, i) => (
        <LLMCardView
          key={i}
          card={card}
          busy={busyTitle === card.title}
          error={errors?.[card.title]}
          onApprove={() => onApproveAction?.(card)}
          onDismiss={() => onDismissAction?.(card)}
        />
      ))}
    </View>
  );
}

function LLMCardView({
  card,
  busy,
  error,
  onApprove,
  onDismiss,
}: {
  card: LLMCard;
  busy: boolean;
  error?: string;
  onApprove: () => void;
  onDismiss: () => void;
}) {
  // An action card without a resolvable move is an insight with buttons that
  // can't do anything, so it renders as an insight instead of offering Approve.
  const isAction =
    card.type === "action" &&
    !!card.envelope_from &&
    !!card.envelope_to &&
    Number.isFinite(card.amount) &&
    (card.amount ?? 0) > 0;
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
        <>
          {/* State the exact move the button performs — the body text is prose
              and may not match the structured fields that are actually applied. */}
          <Text style={{ color: COLORS.textPrimary, fontSize: 12, marginBottom: 8 }}>
            Moves ${(card.amount ?? 0).toFixed(2)} from {card.envelope_from} to{" "}
            {card.envelope_to} this month.
          </Text>

          {error && (
            <Text style={{ color: COLORS.danger, fontSize: 12, marginBottom: 8 }}>{error}</Text>
          )}

          <View style={{ flexDirection: "row", gap: 8 }}>
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
              <Text style={{ color: "#fff", fontWeight: "600", fontSize: 13 }}>Approve</Text>
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
    </View>
  );
}
