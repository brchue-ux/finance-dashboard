/**
 * All transactions for a month — the budget tab used to inline this feed at the
 * bottom, burying it under everything else. It's now one button away instead,
 * so the budget tab stays a high-level view and browsing transactions is a
 * deliberate, full-screen action.
 *
 * Month-scoped (with nav) to match the budget tab's month context, and reuses
 * the same tap → action → category / split flow as the per-account screen.
 */
import { useState } from "react";
import { ScrollView, View, Text, Pressable, ActivityIndicator, Modal } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { COLORS } from "@/constants/theme";
import { GradientText } from "@/components/ui/GradientText";
import { MonthNav } from "@/components/budget/MonthNav";
import { TransactionFeed } from "@/components/budget/TransactionFeed";
import { CategoryPicker } from "@/components/budget/CategoryPicker";
import { TransactionActionSheet } from "@/components/budget/TransactionActionSheet";
import { SplitEditor } from "@/components/budget/SplitEditor";
import { useBudget, type Transaction } from "@/hooks/useBudget";

export default function TransactionsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ year?: string; month?: string }>();
  const now = new Date();
  const [year, setYear] = useState(Number(params.year) || now.getFullYear());
  const [month, setMonth] = useState(Number(params.month) || now.getMonth() + 1);

  // Reuses the budget query (already cached from the budget tab) — its
  // transactions are exactly this month's rows.
  const { data, isLoading } = useBudget(year, month);

  // One sheet, ONE open Modal — three modes switched in place (opening a second
  // Modal while closing another hangs on Android).
  const [sheet, setSheet] = useState<
    { txn: Transaction; mode: "actions" | "category" | "split" } | null
  >(null);

  function prevMonth() {
    if (month === 1) { setYear((y) => y - 1); setMonth(12); }
    else setMonth((m) => m - 1);
  }
  function nextMonth() {
    if (month === 12) { setYear((y) => y + 1); setMonth(1); }
    else setMonth((m) => m + 1);
  }

  const transactions = data?.transactions ?? [];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.background }}>
      <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 }}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={{ flexDirection: "row", alignItems: "center" }}>
          <Text style={{ color: COLORS.brandPurple, fontSize: 24, marginRight: 4 }}>‹</Text>
          <GradientText style={{ fontSize: 20, fontWeight: "800" }}>Transactions</GradientText>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <MonthNav year={year} month={month} onPrev={prevMonth} onNext={nextMonth} />

        {isLoading && !data ? (
          <ActivityIndicator color={COLORS.brandPurple} style={{ marginTop: 40 }} />
        ) : transactions.length === 0 ? (
          <Text style={{ color: COLORS.textMuted, fontSize: 14, textAlign: "center", marginTop: 40 }}>
            No transactions this month.
          </Text>
        ) : (
          <TransactionFeed
            transactions={transactions}
            onPressTransaction={(txn) => setSheet({ txn, mode: "actions" })}
            limit={transactions.length}
          />
        )}
      </ScrollView>

      {/* One Modal, three modes — mirrors the per-account screen exactly. */}
      <Modal
        visible={sheet !== null}
        animationType="slide"
        transparent
        onRequestClose={() => setSheet(null)}
      >
        <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.6)" }}>
          <View
            style={{
              backgroundColor: COLORS.background,
              borderTopLeftRadius: 20,
              borderTopRightRadius: 20,
              maxHeight: "88%",
            }}
          >
            {sheet && sheet.mode === "actions" && (
              <TransactionActionSheet
                transaction={sheet.txn}
                onChangeCategory={() => setSheet({ txn: sheet.txn, mode: "category" })}
                onSplit={() => setSheet({ txn: sheet.txn, mode: "split" })}
                onClose={() => setSheet(null)}
              />
            )}
            {sheet && sheet.mode === "category" && (
              <CategoryPicker
                transactionId={sheet.txn.id}
                description={sheet.txn.merchantName ?? sheet.txn.description}
                currentCategory={sheet.txn.category}
                onDone={() => setSheet(null)}
              />
            )}
            {sheet && sheet.mode === "split" && (
              <ScrollView contentContainerStyle={{ padding: 20 }}>
                <SplitEditor
                  transactionId={sheet.txn.id}
                  transactionAmount={sheet.txn.amount}
                  description={sheet.txn.merchantName ?? sheet.txn.description}
                  onDone={() => setSheet(null)}
                />
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
