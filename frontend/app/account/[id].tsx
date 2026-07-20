/**
 * Per-account transaction history — spec §9 Banks: tapping a Banks account card
 * opens this screen, which reuses TransactionFeed filtered to one account_id
 * (via GET /api/banks/:id/transactions). Also the nav target for the Budget
 * screen's notable transactions, which pass ?highlight=<txId> to mark the row.
 */
import { useState } from "react";
import { ScrollView, View, Text, Pressable, ActivityIndicator, Modal } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { COLORS } from "@/constants/theme";
import { TransactionFeed } from "@/components/budget/TransactionFeed";
import { useAccountTransactions } from "@/hooks/useBanks";
import { SplitEditor } from "@/components/budget/SplitEditor";
import type { Transaction } from "@/hooks/useBudget";

export default function AccountTransactionsScreen() {
  const { id, highlight } = useLocalSearchParams<{ id: string; highlight?: string }>();
  const router = useRouter();
  // 30 matches TransactionFeed's own render cap, so the "showing N" note is honest.
  const { data, isLoading, isError } = useAccountTransactions(id ?? "", 30);
  const [splitting, setSplitting] = useState<Transaction | null>(null);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.background }}>
      <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 }}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={{ flexDirection: "row", alignItems: "center" }}>
          <Text style={{ color: COLORS.brandPurple, fontSize: 24, marginRight: 4 }}>‹</Text>
          <Text style={{ color: COLORS.textPrimary, fontSize: 18, fontWeight: "700" }} numberOfLines={1}>
            {data?.accountName ?? "Account"}
          </Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        {isLoading ? (
          <ActivityIndicator color={COLORS.brandPurple} style={{ marginTop: 40 }} />
        ) : isError ? (
          <Text style={{ color: COLORS.danger, fontSize: 14, textAlign: "center", marginTop: 40 }}>
            Couldn’t load transactions.
          </Text>
        ) : (data?.transactions.length ?? 0) === 0 ? (
          <Text style={{ color: COLORS.textMuted, fontSize: 14, textAlign: "center", marginTop: 40 }}>
            No transactions for this account yet.
          </Text>
        ) : (
          <>
            <TransactionFeed
              transactions={data!.transactions}
              highlightId={highlight}
              onSplit={setSplitting}
            />
            {data!.hasMore && (
              <Text style={{ color: COLORS.textMuted, fontSize: 12, textAlign: "center", marginTop: 12 }}>
                Showing the {data!.transactions.length} most recent.
              </Text>
            )}
          </>
        )}
      </ScrollView>

      {/* Split editor. Reached by tapping a row here rather than from the
          blended Budget feed, where a row appears without its account. */}
      <Modal
        visible={splitting !== null}
        animationType="slide"
        transparent
        onRequestClose={() => setSplitting(null)}
      >
        <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.6)" }}>
          <View
            style={{
              backgroundColor: COLORS.background,
              borderTopLeftRadius: 20,
              borderTopRightRadius: 20,
              padding: 20,
              maxHeight: "88%",
            }}
          >
            <ScrollView>
              {splitting && (
                <SplitEditor
                  transactionId={splitting.id}
                  transactionAmount={splitting.amount}
                  description={splitting.merchantName ?? splitting.description}
                  onDone={() => setSplitting(null)}
                />
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
