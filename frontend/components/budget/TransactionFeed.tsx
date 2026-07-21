import { View, Text, Pressable } from "react-native";
import { COLORS } from "@/constants/theme";
import type { Transaction } from "@/hooks/useBudget";

interface TransactionFeedProps {
  transactions: Transaction[];
  /** Transaction id to visually mark — set when arriving from a notable card. */
  highlightId?: string;
  /**
   * When provided, rows become tappable to split. Only offered where a
   * transaction has real context (per-account history), not on the blended
   * Budget feed, where the same row appears without its account.
   */
  onSplit?: (txn: Transaction) => void;
  /**
   * When provided, the category becomes its own tappable chip. Kept separate
   * from the row press so the split editor keeps the whole-row target it was
   * verified with on-device — tapping the category to change the category is
   * the direct mapping, and it needs no hidden gesture to discover.
   */
  onRecategorize?: (txn: Transaction) => void;
  /** Max rows to render. Must not be smaller than the caller's fetch limit,
   *  or a highlighted row can be fetched but never drawn. */
  limit?: number;
  /** Fires with the highlighted row's y offset so the caller can scroll to it.
   *  Without this the row is tinted but left off-screen, which reads as a
   *  generic list rather than "here is your transaction". */
  onHighlightLayout?: (y: number) => void;
}

function fmt(amount: number) {
  const abs = Math.abs(amount);
  return amount < 0 ? `-$${abs.toFixed(2)}` : `+$${abs.toFixed(2)}`;
}

export function TransactionFeed({
  transactions,
  highlightId,
  onSplit,
  onRecategorize,
  limit = 30,
  onHighlightLayout,
}: TransactionFeedProps) {
  return (
    <View>
      <Text style={{ color: COLORS.textPrimary, fontWeight: "700", fontSize: 16, marginBottom: 12 }}>
        Transactions
      </Text>
      {transactions.slice(0, limit).map((txn) => (
        <Pressable
          key={txn.id}
          onPress={onSplit ? () => onSplit(txn) : undefined}
          disabled={!onSplit}
          onLayout={
            txn.id === highlightId && onHighlightLayout
              ? (e) => onHighlightLayout(e.nativeEvent.layout.y)
              : undefined
          }
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "center",
            paddingVertical: 10,
            borderBottomWidth: 1,
            borderBottomColor: COLORS.glassBorder,
            // Highlight reuses the insight-card tint rather than a new colour.
            ...(txn.id === highlightId
              ? {
                  backgroundColor: COLORS.insightBg,
                  borderLeftWidth: 2,
                  borderLeftColor: COLORS.warning,
                  paddingLeft: 8,
                  marginHorizontal: -8,
                  paddingRight: 8,
                }
              : null),
          }}
        >
          <View style={{ flex: 1 }}>
            <Text style={{ color: COLORS.textPrimary, fontSize: 14 }} numberOfLines={1}>
              {txn.merchantName ?? txn.description}
            </Text>
            <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap" }}>
              {onRecategorize ? (
                // Nested Pressable: RN gives the touch to the innermost
                // responder, so this does not also open the split editor.
                // Padded because the bare text is a ~12px-tall target.
                <Pressable
                  onPress={() => onRecategorize(txn)}
                  hitSlop={8}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    paddingVertical: 3,
                    paddingHorizontal: 7,
                    marginVertical: 2,
                    marginRight: 4,
                    borderRadius: 10,
                    borderWidth: 1,
                    borderColor: COLORS.glassBorder,
                  }}
                >
                  <Text style={{ color: COLORS.textMuted, fontSize: 12 }}>
                    {txn.category ?? "uncategorized"}
                  </Text>
                  <Text style={{ color: COLORS.textMuted, fontSize: 9, marginLeft: 4 }}>▾</Text>
                </Pressable>
              ) : (
                <Text style={{ color: COLORS.textMuted, fontSize: 12 }}>
                  {txn.category ?? "uncategorized"}
                </Text>
              )}
              <Text style={{ color: COLORS.textMuted, fontSize: 12 }}>
                · {txn.date}
                {txn.pending ? " · Pending" : ""}
              </Text>
            </View>
          </View>
          <Text
            style={{
              color: txn.amount < 0 ? COLORS.danger : COLORS.success,
              fontWeight: "600",
              fontSize: 14,
              marginLeft: 8,
            }}
          >
            {fmt(txn.amount)}
          </Text>
          {/* Without this the row is silently tappable — there was no way to
              discover the split editor existed. */}
          {onSplit && (
            <Text style={{ color: COLORS.textMuted, fontSize: 18, marginLeft: 6 }}>›</Text>
          )}
        </Pressable>
      ))}
      {transactions.length > 0 && (onSplit || onRecategorize) && (
        <Text style={{ color: COLORS.textMuted, fontSize: 12, marginTop: 10 }}>
          {onSplit && onRecategorize
            ? "Tap a category to move it to another envelope, or a transaction to split it."
            : onSplit
              ? "Tap a transaction to split it across envelopes."
              : "Tap a category to move it to another envelope."}
        </Text>
      )}
    </View>
  );
}
