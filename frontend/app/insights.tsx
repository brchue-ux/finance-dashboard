/**
 * Insights — the full list of Claude analyses and suggested trims, drilled into
 * from the pinned card on the budget tab. Moving the wall of cards here keeps
 * the budget tab high-level while still giving every recommendation a home.
 *
 * Shares the same card state as the budget tab (via useInsights), so a card
 * applied or dismissed here is consistent with the pinned card, and vice versa.
 */
import { ScrollView, View, Text, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { COLORS } from "@/constants/theme";
import { GradientText } from "@/components/ui/GradientText";
import { LLMCards } from "@/components/budget/LLMCards";
import { useInsights } from "@/hooks/useInsights";

export default function InsightsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ year?: string; month?: string }>();
  const now = new Date();
  const year = Number(params.year) || now.getFullYear();
  const month = Number(params.month) || now.getMonth() + 1;

  const insights = useInsights("budget", year, month);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.background }}>
      <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 }}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={{ flexDirection: "row", alignItems: "center" }}>
          <Text style={{ color: COLORS.brandPurple, fontSize: 24, marginRight: 4 }}>‹</Text>
          <GradientText style={{ fontSize: 20, fontWeight: "800" }}>Insights</GradientText>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        {insights.visibleCards.length === 0 &&
        !(insights.llmQuery.isLoading && !insights.llmQuery.data) ? (
          <Text style={{ color: COLORS.textMuted, fontSize: 14, textAlign: "center", marginTop: 40 }}>
            No open insights right now. Re-analyze to generate fresh ones.
          </Text>
        ) : null}

        <LLMCards
          cards={insights.visibleCards}
          lastAnalyzedAt={insights.llmQuery.data?.lastAnalyzedAt ?? null}
          isLoading={insights.llmQuery.isLoading && !insights.llmQuery.data}
          isRefreshing={Boolean(insights.llmQuery.data?.refreshing) || insights.reanalyze.isPending}
          onReanalyze={insights.onReanalyze}
          busyTitle={insights.busyTitle}
          errors={insights.cardErrors}
          flash={insights.flash}
          onApproveAction={insights.onApprove}
          onDismissAction={insights.onDismiss}
        />
      </ScrollView>
    </SafeAreaView>
  );
}
