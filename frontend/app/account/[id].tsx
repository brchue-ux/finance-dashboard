/**
 * Per-account transaction history — spec §9 Banks: tapping a Banks account card
 * opens this screen, which reuses TransactionFeed filtered to one account_id
 * (via GET /api/banks/:id/transactions). Also the intended nav target for the
 * Budget screen's notable transactions (scroll/highlight-to-tx is a later
 * enhancement once that Budget feature lands).
 */
import { ScrollView, View, Text, Pressable, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { COLORS } from "@/constants/theme";
import { TransactionFeed } from "@/components/budget/TransactionFeed";
import { useAccountTransactions } from "@/hooks/useBanks";

export default function AccountTransactionsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  // 30 matches TransactionFeed's own render cap, so the "showing N" note is honest.
  const { data, isLoading, isError } = useAccountTransactions(id ?? "", 30);

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
            <TransactionFeed transactions={data!.transactions} />
            {data!.hasMore && (
              <Text style={{ color: COLORS.textMuted, fontSize: 12, textAlign: "center", marginTop: 12 }}>
                Showing the {data!.transactions.length} most recent.
              </Text>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
