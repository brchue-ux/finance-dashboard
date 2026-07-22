/**
 * Per-account transaction history — spec §9 Banks: tapping a Banks account card
 * opens this screen, which reuses TransactionFeed filtered to one account_id
 * (via GET /api/banks/:id/transactions). Also the nav target for the Budget
 * screen's notable transactions, which pass ?highlight=<txId> to mark the row.
 */
import { useState, useRef, useCallback } from "react";
import { ScrollView, View, Text, Pressable, ActivityIndicator, Modal } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { COLORS } from "@/constants/theme";
import { TransactionFeed } from "@/components/budget/TransactionFeed";
import { useAccountTransactions } from "@/hooks/useBanks";
import { SplitEditor } from "@/components/budget/SplitEditor";
import { CategoryPicker } from "@/components/budget/CategoryPicker";
import { TransactionActionSheet } from "@/components/budget/TransactionActionSheet";
import type { Transaction } from "@/hooks/useBudget";

export default function AccountTransactionsScreen() {
  const { id, highlight } = useLocalSearchParams<{ id: string; highlight?: string }>();
  const router = useRouter();
  // Arriving from a notable/insight card, the target transaction is often older
  // than the 30 most recent — it was then absent from the response entirely, so
  // the highlight matched nothing and this read as a generic list. Fetch deeper
  // when we have a specific row to find.
  const PAGE = highlight ? 200 : 30;
  const { data, isLoading, isError } = useAccountTransactions(id ?? "", PAGE);
  const [splitting, setSplitting] = useState<Transaction | null>(null);
  const [recategorizing, setRecategorizing] = useState<Transaction | null>(null);
  // The transaction whose action sheet is open. Tapping a row opens this; the
  // sheet then routes to the category or split editor below.
  const [actionsFor, setActionsFor] = useState<Transaction | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  // Tinting a row that is off-screen is invisible; scroll it into view. Offset
  // leaves the preceding row visible so the highlight reads as "here", not "top".
  const scrollToHighlight = useCallback((y: number) => {
    scrollRef.current?.scrollTo({ y: Math.max(0, y - 80), animated: true });
  }, []);

  const highlightMissing =
    Boolean(highlight) && Boolean(data) && !data!.transactions.some((t) => t.id === highlight);

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

      <ScrollView ref={scrollRef} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
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
            {highlightMissing && (
              // Say so rather than silently presenting an unhighlighted list —
              // that ambiguity is what made this look broken on device.
              <Text style={{ color: COLORS.warning, fontSize: 12, marginBottom: 10 }}>
                That transaction is older than the {data!.transactions.length} shown here.
              </Text>
            )}
            <TransactionFeed
              transactions={data!.transactions}
              highlightId={highlight}
              onPressTransaction={setActionsFor}
              limit={PAGE}
              onHighlightLayout={scrollToHighlight}
            />
            {data!.hasMore && (
              <Text style={{ color: COLORS.textMuted, fontSize: 12, textAlign: "center", marginTop: 12 }}>
                Showing the {data!.transactions.length} most recent.
              </Text>
            )}
          </>
        )}
      </ScrollView>

      {/* Action sheet — the single entry point for a row tap. Routes to the
          category picker or the split editor rather than making either a hidden
          gesture. Split is offered here because this screen has account context. */}
      <Modal
        visible={actionsFor !== null}
        animationType="slide"
        transparent
        onRequestClose={() => setActionsFor(null)}
      >
        <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.6)" }}>
          <View style={{ backgroundColor: COLORS.background, borderTopLeftRadius: 20, borderTopRightRadius: 20 }}>
            {actionsFor && (
              <TransactionActionSheet
                transaction={actionsFor}
                onChangeCategory={() => {
                  setRecategorizing(actionsFor);
                  setActionsFor(null);
                }}
                onSplit={() => {
                  setSplitting(actionsFor);
                  setActionsFor(null);
                }}
                onClose={() => setActionsFor(null)}
              />
            )}
          </View>
        </View>
      </Modal>

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

      {/* Category picker. Separate modal from the split editor because the two
          are different edits: one reassigns the whole transaction, the other
          divides it. */}
      <Modal
        visible={recategorizing !== null}
        animationType="slide"
        transparent
        onRequestClose={() => setRecategorizing(null)}
      >
        <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.6)" }}>
          <View
            style={{
              backgroundColor: COLORS.background,
              borderTopLeftRadius: 20,
              borderTopRightRadius: 20,
              maxHeight: "70%",
            }}
          >
            {recategorizing && (
              <CategoryPicker
                transactionId={recategorizing.id}
                description={recategorizing.merchantName ?? recategorizing.description}
                currentCategory={recategorizing.category}
                onDone={() => setRecategorizing(null)}
              />
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
