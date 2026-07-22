/**
 * What you can do with one transaction — the sheet that opens when a row is
 * tapped.
 *
 * Replaces the old inline gesture, where changing a category meant finding a
 * small chip nested inside a row that was itself tappable-to-split. The two
 * actions competed for the same touch and the category one lost, so "change a
 * category" was effectively undiscoverable. Here each action is a full-width,
 * plainly-labelled button — no hidden gesture, and the same on every screen.
 *
 * `onSplit` is omitted on the blended Budget feed, where a row appears without
 * its account and splitting has no context; the button simply isn't shown.
 */
import { View, Text, Pressable } from "react-native";
import { COLORS } from "@/constants/theme";
import type { Transaction } from "@/hooks/useBudget";

function fmt(amount: number) {
  const abs = Math.abs(amount);
  return amount < 0 ? `-$${abs.toFixed(2)}` : `+$${abs.toFixed(2)}`;
}

export function TransactionActionSheet({
  transaction,
  onChangeCategory,
  onSplit,
  onViewOriginalPurchase,
  onClose,
}: {
  transaction: Transaction;
  onChangeCategory: () => void;
  onSplit?: () => void;
  /** Refund rows with a matched purchase: jump straight to that row. The feed
   *  chip says "Refund → Jun"; this is the one-press way to actually get there
   *  — a named destination must never require the user to go find it. */
  onViewOriginalPurchase?: () => void;
  onClose: () => void;
}) {
  return (
    <View style={{ padding: 16 }}>
      <Text numberOfLines={1} style={{ color: COLORS.textPrimary, fontWeight: "700", fontSize: 16 }}>
        {transaction.merchantName ?? transaction.description}
      </Text>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 4 }}>
        <Text style={{ color: COLORS.textMuted, fontSize: 13 }} numberOfLines={1}>
          {transaction.category ?? "Uncategorized"} · {transaction.date}
        </Text>
        <Text
          style={{
            color: transaction.amount < 0 ? COLORS.danger : COLORS.success,
            fontWeight: "600",
            fontSize: 14,
            marginLeft: 8,
          }}
        >
          {fmt(transaction.amount)}
        </Text>
      </View>

      <ActionButton icon="✎" label="Change category" onPress={onChangeCategory} />
      {onSplit && <ActionButton icon="⊟" label="Split across categories" onPress={onSplit} />}
      {onViewOriginalPurchase && (
        <ActionButton icon="↩" label="View original purchase" onPress={onViewOriginalPurchase} />
      )}

      <Pressable onPress={onClose} style={{ paddingVertical: 14, alignItems: "center", marginTop: 8 }}>
        <Text style={{ color: COLORS.textMuted, fontSize: 15 }}>Cancel</Text>
      </Pressable>
    </View>
  );
}

function ActionButton({
  icon,
  label,
  onPress,
}: {
  icon: string;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        flexDirection: "row",
        alignItems: "center",
        paddingVertical: 16,
        marginTop: 14,
        borderTopWidth: 1,
        borderTopColor: COLORS.glassBorder,
      }}
    >
      <Text style={{ fontSize: 17, marginRight: 12, color: COLORS.brandPurple, width: 22 }}>{icon}</Text>
      <Text style={{ color: COLORS.textPrimary, fontSize: 16 }}>{label}</Text>
    </Pressable>
  );
}
