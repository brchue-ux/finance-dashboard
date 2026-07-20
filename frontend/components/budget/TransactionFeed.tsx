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
}

function fmt(amount: number) {
  const abs = Math.abs(amount);
  return amount < 0 ? `-$${abs.toFixed(2)}` : `+$${abs.toFixed(2)}`;
}

export function TransactionFeed({ transactions, highlightId, onSplit }: TransactionFeedProps) {
  return (
    <View>
      <Text style={{ color: COLORS.textPrimary, fontWeight: "700", fontSize: 16, marginBottom: 12 }}>
        Transactions
      </Text>
      {transactions.slice(0, 30).map((txn) => (
        <Pressable
          key={txn.id}
          onPress={onSplit ? () => onSplit(txn) : undefined}
          disabled={!onSplit}
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
        </Pressable>
      ))}
    </View>
  );
}
