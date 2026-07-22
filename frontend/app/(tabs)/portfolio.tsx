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
import { usePortfolio, useSyncPortfolio, type AccountGroup } from "@/hooks/usePortfolio";
import { useLLMCards, useForceReanalyze } from "@/hooks/useBudget";

function money(n: number) {
  return "$" + n.toLocaleString("en-CA", { maximumFractionDigits: 0 });
}

const GROUP_LABELS: Record<string, string> = {
  tfsa: "TFSA",
  rrsp: "RRSP",
  resp: "RESP",
  fhsa: "FHSA",
  cash: "Cash",
  personal: "Personal",
  crypto: "Crypto",
  non_reg: "Non-registered",
};

/**
 * Account-type rollups in the app's card-list pattern (one card, hairline
 * rows). Managed groups say so explicitly — a robo RESP itemizes no holdings,
 * and without the label its absence from the Holdings list reads as a bug.
 * Legacy snapshots (pre-group object shape) fall back to the old chip row.
 */
function AccountGroups({ accounts }: { accounts: AccountGroup[] | Record<string, number> }) {
  if (!Array.isArray(accounts)) {
    return (
      <View style={{ flexDirection: "row", gap: 16, marginTop: 12 }}>
        {Object.entries(accounts).map(([type, value]) => (
          <View key={type}>
            <Text style={{ color: COLORS.textMuted, fontSize: 11 }}>{type.toUpperCase()}</Text>
            <Text style={{ color: COLORS.textPrimary, fontSize: 14, fontWeight: "600" }}>
              {money(value)}
            </Text>
          </View>
        ))}
      </View>
    );
  }

  const visible = accounts.filter((g) => g.total > 0);
  if (visible.length === 0) return null;

  return (
    <View
      style={{
        marginTop: 16,
        backgroundColor: COLORS.glassBg,
        borderWidth: 1,
        borderColor: COLORS.glassBorder,
        borderRadius: 14,
        overflow: "hidden",
      }}
    >
      {visible.map((g, i) => (
        <View
          key={g.type}
          style={{
            flexDirection: "row",
            alignItems: "center",
            paddingVertical: 12,
            paddingHorizontal: 14,
            borderTopWidth: i === 0 ? 0 : 1,
            borderTopColor: COLORS.glassBorder,
          }}
        >
          <View style={{ flex: 1, paddingRight: 10 }}>
            <Text style={{ color: COLORS.textPrimary, fontSize: 15, fontWeight: "500" }}>
              {GROUP_LABELS[g.type] ?? g.type}
              {g.accountCount > 1 ? (
                <Text style={{ color: COLORS.textMuted, fontSize: 12 }}>
                  {"  "}{g.accountCount} accounts
                </Text>
              ) : null}
            </Text>
            {g.managed ? (
              <Text style={{ color: COLORS.brandPurple, fontSize: 12, marginTop: 2, fontWeight: "600" }}>
                Managed by Wealthsimple
              </Text>
            ) : g.cash > 0 && g.positionsValue > 0 ? (
              <Text style={{ color: COLORS.textMuted, fontSize: 12, marginTop: 2 }}>
                {money(g.cash)} cash · {money(g.positionsValue)} holdings
              </Text>
            ) : null}
          </View>
          <Text
            style={{
              color: COLORS.textSecondary,
              fontWeight: "600",
              fontSize: 15,
              fontVariant: ["tabular-nums"],
            }}
          >
            {money(g.total)}
          </Text>
        </View>
      ))}
    </View>
  );
}

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
            <Text style={{ color: COLORS.textMuted, fontSize: 13, marginBottom: 4 }}>Total at Wealthsimple</Text>
            <Text style={{ color: COLORS.textPrimary, fontSize: 36, fontWeight: "800", marginBottom: 4 }}>
              ${snapshot.totalValue.toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </Text>
            {/* The one-glance answer to "how much of this is working?" —
                invested = everything the total holds beyond cash. */}
            <Text style={{ color: COLORS.textSecondary, fontSize: 14 }}>
              Invested {money(snapshot.totalValue - snapshot.cashValue)}
              <Text style={{ color: COLORS.textMuted }}> · </Text>
              <Text style={{ color: COLORS.moneyIn }}>Cash {money(snapshot.cashValue)}</Text>
            </Text>
            <AccountGroups accounts={snapshot.accounts} />
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
