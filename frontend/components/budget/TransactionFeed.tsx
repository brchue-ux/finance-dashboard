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
            <Text style={{ color: COLORS.textMuted, fontSize: 12 }}>
              {txn.category ?? "uncategorized"} · {txn.date}
              {txn.pending ? " · Pending" : ""}
            </Text>
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
      {onSplit && transactions.length > 0 && (
        <Text style={{ color: COLORS.textMuted, fontSize: 12, marginTop: 10 }}>
          Tap a transaction to split it across envelopes.
        </Text>
      )}
    </View>
  );
}
