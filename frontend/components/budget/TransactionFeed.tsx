import { View, Text, Pressable } from "react-native";
import { COLORS } from "@/constants/theme";
import type { Transaction } from "@/hooks/useBudget";

interface TransactionFeedProps {
  transactions: Transaction[];
  /** Transaction id to visually mark — set when arriving from a notable card. */
  highlightId?: string;
  /**
   * When provided, tapping a row opens its action sheet (change category /
   * split). One tap, one target — this replaced a nested category chip that
   * competed with a tap-to-split row and was effectively undiscoverable.
   */
  onPressTransaction?: (txn: Transaction) => void;
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
  onPressTransaction,
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
          onPress={onPressTransaction ? () => onPressTransaction(txn) : undefined}
          disabled={!onPressTransaction}
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
              <Text style={{ color: COLORS.textMuted, fontSize: 12 }}>
                {txn.category ?? "Uncategorized"} · {txn.date}
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
          {/* The chevron signals the row is tappable — without an affordance
              the action sheet is as hidden as the old nested chip was. */}
          {onPressTransaction && (
            <Text style={{ color: COLORS.textMuted, fontSize: 18, marginLeft: 6 }}>›</Text>
          )}
        </Pressable>
      ))}
      {transactions.length > 0 && onPressTransaction && (
        <Text style={{ color: COLORS.textMuted, fontSize: 12, marginTop: 10 }}>
          Tap a transaction to change its category or split it.
        </Text>
      )}
    </View>
  );
}
