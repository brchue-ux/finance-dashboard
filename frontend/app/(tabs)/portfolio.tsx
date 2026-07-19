/**
 * Portfolio tab — spec §9 Portfolio Screen layout.
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
import { HoldingRow } from "@/components/portfolio/HoldingRow";
import { LLMCards } from "@/components/budget/LLMCards";
import { ConversationSheet } from "@/components/llm/ConversationSheet";
import { COLORS } from "@/constants/theme";
import { usePortfolio, useSyncPortfolio } from "@/hooks/usePortfolio";
import { useLLMCards, useForceReanalyze } from "@/hooks/useBudget";

export default function PortfolioScreen() {
  const router = useRouter();
  const [chatOpen, setChatOpen] = useState(false);

  const { data, isLoading, refetch } = usePortfolio();
  const syncMutation = useSyncPortfolio();
  const llmQuery = useLLMCards("portfolio");
  const reanalyze = useForceReanalyze("portfolio");

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

  const snapshot = data?.latestSnapshot;

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
          <GradientText style={{ fontSize: 28, fontWeight: "800" }}>Portfolio</GradientText>
          <Pressable onPress={() => router.push("/reports")} hitSlop={10}>
            <Text style={{ fontSize: 20 }}>📊</Text>
          </Pressable>
        </View>

        {/* Portfolio hero */}
        {snapshot ? (
          <View style={{ marginBottom: 24 }}>
            <Text style={{ color: COLORS.textMuted, fontSize: 13, marginBottom: 4 }}>Total Value</Text>
            <Text style={{ color: COLORS.textPrimary, fontSize: 36, fontWeight: "800", marginBottom: 8 }}>
              ${snapshot.totalValue.toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </Text>
            <View style={{ flexDirection: "row", gap: 16 }}>
              {Object.entries(snapshot.accounts).map(([type, value]) => (
                <View key={type}>
                  <Text style={{ color: COLORS.textMuted, fontSize: 11 }}>{type.toUpperCase()}</Text>
                  <Text style={{ color: COLORS.textPrimary, fontSize: 14, fontWeight: "600" }}>
                    ${(value as number).toLocaleString("en-CA", { maximumFractionDigits: 0 })}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        ) : (
          <View
            style={{
              backgroundColor: COLORS.glassBg,
              borderRadius: 16,
              padding: 24,
              alignItems: "center",
              marginBottom: 24,
            }}
          >
            <Text style={{ color: COLORS.textMuted, fontSize: 14, textAlign: "center" }}>
              Connect your Wealthsimple account in Settings to see your portfolio.
            </Text>
          </View>
        )}

        {/* Holdings list */}
        {data?.holdings && data.holdings.length > 0 && (
          <View style={{ marginBottom: 24 }}>
            <Text style={{ color: COLORS.textPrimary, fontWeight: "700", fontSize: 16, marginBottom: 8 }}>
              Holdings
            </Text>
            {data.holdings.map((h) => (
              <HoldingRow
                key={h.id}
                holding={h}
                onPress={() =>
                  router.push({
                    pathname: "/holding/[ticker]",
                    params: { ticker: h.ticker },
                  } as any)
                }
              />
            ))}
          </View>
        )}

        {/* LLM cards */}
        <LLMCards
          cards={llmQuery.data?.cards ?? []}
          lastAnalyzedAt={llmQuery.data?.lastAnalyzedAt ?? null}
          isLoading={llmQuery.isLoading || reanalyze.isPending}
          onReanalyze={() => reanalyze.mutate()}
        />
      </ScrollView>

      <ConversationSheet
        visible={chatOpen}
        onClose={() => setChatOpen(false)}
        view="portfolio"
        initialCards={llmQuery.data?.cards}
      />
    </SafeAreaView>
  );
}
