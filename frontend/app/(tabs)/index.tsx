/**
 * Budget tab — main budget view.
 * Spec §9 Budget Screen layout.
 */
import { useState } from "react";
import {
  ScrollView,
  View,
  Text,
  Pressable,
  RefreshControl,
  ActivityIndicator,
  Modal,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { GradientText } from "@/components/ui/GradientText";
import { StatCard } from "@/components/ui/StatCard";
import { MonthNav } from "@/components/budget/MonthNav";
import { EnvelopeCard } from "@/components/budget/EnvelopeCard";
import { LLMCards } from "@/components/budget/LLMCards";
import { NotableTransactions } from "@/components/budget/NotableTransactions";
import { TransactionFeed } from "@/components/budget/TransactionFeed";
import { CategoryPicker } from "@/components/budget/CategoryPicker";
import { TransactionActionSheet } from "@/components/budget/TransactionActionSheet";
import { ConversationSheet } from "@/components/llm/ConversationSheet";
import { COLORS } from "@/constants/theme";
import {
  useBudget,
  useSyncBudget,
  useLLMCards,
  useForceReanalyze,
  useApplyReallocation,
  type LLMCard,
  type Transaction,
} from "@/hooks/useBudget";

function fmt(n: number) {
  return `$${Math.abs(n).toFixed(0)}`;
}

export default function BudgetScreen() {
  const router = useRouter();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [chatOpen, setChatOpen] = useState(false);

  const { data, isLoading, refetch } = useBudget(year, month);
  const syncMutation = useSyncBudget();
  const llmQuery = useLLMCards("budget");
  const reanalyze = useForceReanalyze("budget");
  const applyReallocation = useApplyReallocation(year, month);

  // Card resolution lives here, not in the cached query: approving or
  // dismissing shouldn't force a re-analysis, and the LLM cache is shared.
  const [resolvedTitles, setResolvedTitles] = useState<string[]>([]);
  const [cardErrors, setCardErrors] = useState<Record<string, string>>({});
  const [flash, setFlash] = useState<string | null>(null);
  // One sheet, ONE open Modal — two overlapping Modals hang on Android. The
  // blended Budget feed offers no split (a row here has no account), so the
  // modes are just "actions" and "category".
  const [sheet, setSheet] = useState<{ txn: Transaction; mode: "actions" | "category" } | null>(
    null
  );

  const visibleCards = (llmQuery.data?.cards ?? []).filter(
    (c) => !resolvedTitles.includes(c.title)
  );

  async function onApprove(card: LLMCard) {
    setCardErrors((e) => ({ ...e, [card.title]: "" }));
    try {
      const res = await applyReallocation.mutateAsync(card);
      // Only hide the card once the write succeeded — hiding on tap would make
      // a rejected reallocation look applied.
      setResolvedTitles((t) => [...t, card.title]);
      setFlash(
        `Moved $${res.amount.toFixed(2)} from ${res.from.name} ($${res.from.after.toFixed(0)} left budgeted) to ${res.to.name} ($${res.to.after.toFixed(0)}).`
      );
      await refetch();
    } catch (err) {
      setCardErrors((e) => ({
        ...e,
        [card.title]: err instanceof Error ? err.message : "Couldn't apply that change.",
      }));
    }
  }

  function prevMonth() {
    if (month === 1) { setYear(y => y - 1); setMonth(12); }
    else setMonth(m => m - 1);
  }
  function nextMonth() {
    if (month === 12) { setYear(y => y + 1); setMonth(1); }
    else setMonth(m => m + 1);
  }

  async function onRefresh() {
    await syncMutation.mutateAsync();
    await refetch();
  }

  if (isLoading && !data) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.background, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator color={COLORS.brandPurple} />
      </SafeAreaView>
    );
  }

  const summary = data?.summary;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.background }}>
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
        refreshControl={
          <RefreshControl
            refreshing={syncMutation.isPending}
            onRefresh={onRefresh}
            tintColor={COLORS.brandPurple}
          />
        }
      >
        {/* Header */}
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <GradientText style={{ fontSize: 28, fontWeight: "800" }}>Budget</GradientText>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
            {/* Importing a statement is a routine, recurring action, not a
                one-time setup chore — it stays one tap from the budget rather
                than buried in Settings or behind the bank-connect flow. */}
            <Pressable
              onPress={() => router.push("/import")}
              hitSlop={10}
              accessibilityLabel="Import a CSV or Excel file"
            >
              <Text style={{ fontSize: 20 }}>⬆️</Text>
            </Pressable>
            <Pressable onPress={() => router.push("/manage-envelopes")} hitSlop={10}>
              <Text style={{ fontSize: 20 }}>🗂️</Text>
            </Pressable>
            <Pressable onPress={() => router.push("/reports")} hitSlop={10}>
              <Text style={{ fontSize: 20 }}>📊</Text>
            </Pressable>
          </View>
        </View>

        {/* Month navigation */}
        <MonthNav
          year={year}
          month={month}
          netPosition={summary?.saved}
          onPrev={prevMonth}
          onNext={nextMonth}
        />

        {/* Summary strip */}
        {summary && (
          <View style={{ flexDirection: "row", gap: 8, marginBottom: 20 }}>
            {/* Total outflow, not envelope-attributed spend. Showing only what
                reached an envelope made "Spent" shrink as categorization
                coverage got worse — the opposite of the truth. The uncounted
                remainder is called out below rather than quietly dropped. */}
            <StatCard label="Spent" value={fmt(summary.totalOutflow)} />
            {/* With nothing budgeted, "Remaining" would just be -Spent, which
                reads as overspend against a limit that was never set. */}
            <StatCard
              label="Remaining"
              value={summary.configuredEnvelopes === 0 ? "—" : fmt(summary.remaining)}
              valueColor={
                summary.configuredEnvelopes === 0
                  ? COLORS.textMuted
                  : summary.remaining < 0
                    ? COLORS.danger
                    : COLORS.success
              }
            />
            <StatCard
              label="Saved"
              value={fmt(summary.saved)}
              valueColor={summary.saved >= 0 ? COLORS.success : COLORS.danger}
            />
          </View>
        )}

        {/* Spend that reached no envelope. Without this the money simply is not
            on screen anywhere: it is absent from every envelope card, and the
            envelope grid below is the only place spending is itemised. It still
            reduces Saved, so leaving it unexplained makes the numbers look
            wrong rather than incomplete. Tapping goes where it gets fixed. */}
        {summary && summary.unattributedSpent > 0 && (
          <Pressable
            onPress={() => router.push("/manage-envelopes")}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              padding: 12,
              marginBottom: 20,
              borderRadius: 10,
              backgroundColor: "rgba(245,158,11,0.08)",
              borderWidth: 1,
              borderColor: "rgba(245,158,11,0.25)",
            }}
          >
            <Text style={{ fontSize: 16 }}>📥</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ color: COLORS.warning, fontWeight: "600", fontSize: 13 }}>
                {fmt(summary.unattributedSpent)} not in any category
              </Text>
              <Text style={{ color: COLORS.textMuted, fontSize: 11, marginTop: 2 }}>
                {Math.round((summary.unattributedSpent / summary.totalOutflow) * 100)}% of this
                month's spending — counted in your total, but in no category below.
              </Text>
            </View>
            <Text style={{ color: COLORS.textMuted, fontSize: 16 }}>›</Text>
          </Pressable>
        )}

        {/* Envelope grid */}
        {data?.envelopes.map((env) => (
          <EnvelopeCard
            key={env.id}
            envelope={env}
            onSetTarget={() => router.push("/manage-envelopes")}
          />
        ))}

        {/* No envelopes at all: budget math and categorization can't work yet. */}
        {data && data.envelopes.length === 0 && (
          <Pressable onPress={() => router.push("/manage-envelopes")}>
            <View style={{ padding: 16, borderRadius: 16, borderWidth: 1, borderColor: COLORS.glassBorder, backgroundColor: COLORS.glassBg }}>
              <Text style={{ color: COLORS.textPrimary, fontWeight: "600", fontSize: 15 }}>
                Set up your categories
              </Text>
              <Text style={{ color: COLORS.textMuted, fontSize: 13, marginTop: 6 }}>
                Transactions stay uncategorized until at least one category exists.
              </Text>
            </View>
          </Pressable>
        )}

        {/* Notable transactions — deterministic, above the AI cards so the
            free/always-current signal reads before the generated one. */}
        <View style={{ marginTop: 12 }}>
          <NotableTransactions categories={data?.notableTransactions ?? []} />
        </View>

        {/* LLM cards */}
        <View style={{ marginTop: 8, marginBottom: 20 }}>
          <LLMCards
            cards={visibleCards}
            lastAnalyzedAt={llmQuery.data?.lastAnalyzedAt ?? null}
            // Cold start only — a background refresh keeps the existing cards
            // visible rather than replacing them with a spinner.
            isLoading={llmQuery.isLoading && !llmQuery.data}
            isRefreshing={Boolean(llmQuery.data?.refreshing) || reanalyze.isPending}
            onReanalyze={() => {
              // A fresh analysis supersedes every prior verdict.
              setResolvedTitles([]);
              setCardErrors({});
              setFlash(null);
              reanalyze.mutate();
            }}
            busyTitle={applyReallocation.isPending ? applyReallocation.variables?.title : null}
            errors={cardErrors}
            flash={flash}
            onApproveAction={onApprove}
            onDismissAction={(card) => setResolvedTitles((t) => [...t, card.title])}
          />
        </View>

        {/* Transaction feed */}
        {data?.transactions && (
          <TransactionFeed
            transactions={data.transactions}
            onPressTransaction={(txn) => setSheet({ txn, mode: "actions" })}
          />
        )}
      </ScrollView>

      {/* One Modal, two modes. The action buttons switch mode in place rather
          than opening a second Modal, which is what hung on Android. */}
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
              maxHeight: "80%",
            }}
          >
            {sheet && sheet.mode === "actions" && (
              <TransactionActionSheet
                transaction={sheet.txn}
                onChangeCategory={() => setSheet({ txn: sheet.txn, mode: "category" })}
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
          </View>
        </View>
      </Modal>

      <ConversationSheet
        visible={chatOpen}
        onClose={() => setChatOpen(false)}
        view="budget"
        initialCards={llmQuery.data?.cards}
      />
    </SafeAreaView>
  );
}
