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
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { GradientText } from "@/components/ui/GradientText";
import { StatCard } from "@/components/ui/StatCard";
import { MonthNav } from "@/components/budget/MonthNav";
import { EnvelopeCard } from "@/components/budget/EnvelopeCard";
import { LLMCards } from "@/components/budget/LLMCards";
import { TransactionFeed } from "@/components/budget/TransactionFeed";
import { ConversationSheet } from "@/components/llm/ConversationSheet";
import { COLORS } from "@/constants/theme";
import {
  useBudget,
  useSyncBudget,
  useLLMCards,
  useForceReanalyze,
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
          <Pressable onPress={() => router.push("/reports")} hitSlop={10}>
            <Text style={{ fontSize: 20 }}>📊</Text>
          </Pressable>
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
            <StatCard label="Spent" value={fmt(summary.totalSpent)} />
            <StatCard
              label="Remaining"
              value={fmt(summary.remaining)}
              valueColor={summary.remaining < 0 ? COLORS.danger : COLORS.success}
            />
            <StatCard
              label="Saved"
              value={fmt(summary.saved)}
              valueColor={summary.saved >= 0 ? COLORS.success : COLORS.danger}
            />
          </View>
        )}

        {/* Envelope grid */}
        {data?.envelopes.map((env) => (
          <EnvelopeCard key={env.id} envelope={env} />
        ))}

        {/* LLM cards */}
        <View style={{ marginTop: 8, marginBottom: 20 }}>
          <LLMCards
            cards={llmQuery.data?.cards ?? []}
            lastAnalyzedAt={llmQuery.data?.lastAnalyzedAt ?? null}
            isLoading={llmQuery.isLoading || reanalyze.isPending}
            onReanalyze={() => reanalyze.mutate()}
            onApproveAction={(card) => {
              // TODO: apply envelope reallocation
              console.log("Approve action:", card);
            }}
            onDismissAction={(card) => {
              console.log("Dismiss action:", card);
            }}
          />
        </View>

        {/* Transaction feed */}
        {data?.transactions && (
          <TransactionFeed transactions={data.transactions} />
        )}
      </ScrollView>

      <ConversationSheet
        visible={chatOpen}
        onClose={() => setChatOpen(false)}
        view="budget"
        initialCards={llmQuery.data?.cards}
      />
    </SafeAreaView>
  );
}
