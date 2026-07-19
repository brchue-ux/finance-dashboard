/**
 * Reports — spec §9 Reports Screen. Shared destination reached via the header
 * icon on Budget and Portfolio (not a 6th tab). Every section is deterministic
 * (no LLM): net worth over time, income vs expenses, category trends, a monthly
 * spending drill-down (reuses /api/budget), and a portfolio performance summary
 * (reuses /api/portfolio). Charts are simple native bars/lines — the data is
 * local, so no WebView/Lightweight-Charts dependency is needed here.
 */
import { useState } from "react";
import { ScrollView, View, Text, Pressable, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { COLORS } from "@/constants/theme";
import { MonthNav } from "@/components/budget/MonthNav";
import { useReports } from "@/hooks/useReports";
import { useBudget } from "@/hooks/useBudget";
import { usePortfolio } from "@/hooks/usePortfolio";

function money(n: number, digits = 0): string {
  const abs = Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return `${n < 0 ? "-" : ""}$${abs}`;
}

export default function ReportsScreen() {
  const router = useRouter();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);

  const { data: reports, isLoading } = useReports(12);
  const { data: budget } = useBudget(year, month);
  const { data: portfolio } = usePortfolio();

  function prevMonth() {
    if (month === 1) { setYear((y) => y - 1); setMonth(12); } else setMonth((m) => m - 1);
  }
  function nextMonth() {
    if (month === 12) { setYear((y) => y + 1); setMonth(1); } else setMonth((m) => m + 1);
  }

  const latestNetWorth = reports?.netWorth.at(-1);
  const recentFlows = (reports?.incomeVsExpenses ?? []).slice(-6);
  const latestTrend = reports?.categoryTrends.at(-1);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.background }}>
      {/* Header */}
      <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 }}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={{ flexDirection: "row", alignItems: "center" }}>
          <Text style={{ color: COLORS.brandPurple, fontSize: 24, marginRight: 4 }}>‹</Text>
          <Text style={{ color: COLORS.textPrimary, fontSize: 18, fontWeight: "700" }}>Reports</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>
        {isLoading ? (
          <ActivityIndicator color={COLORS.brandPurple} style={{ marginTop: 40 }} />
        ) : (
          <>
            {/* 1. Net worth over time */}
            <Section title="Net worth">
              {latestNetWorth ? (
                <>
                  <Text style={{ color: COLORS.textPrimary, fontSize: 30, fontWeight: "800" }}>
                    {money(latestNetWorth.total)}
                  </Text>
                  <Text style={{ color: COLORS.textMuted, fontSize: 12, marginTop: 2, marginBottom: 12 }}>
                    {money(latestNetWorth.bank)} bank · {money(latestNetWorth.portfolio)} portfolio
                  </Text>
                  <MiniLine values={reports!.netWorth.map((p) => p.total)} />
                </>
              ) : (
                <Empty>History starts once daily balance capture begins — nothing yet.</Empty>
              )}
            </Section>

            {/* 2. Income vs expenses */}
            <Section title="Income vs expenses">
              {recentFlows.length > 0 ? (
                <IncomeExpenseChart
                  data={recentFlows.map((f) => ({ month: f.month, income: f.income, expenses: f.expenses, net: f.net }))}
                />
              ) : (
                <Empty>No transaction history in range yet.</Empty>
              )}
            </Section>

            {/* 3. Category trends (most recent month) */}
            <Section title={`Top categories${latestTrend ? ` · ${latestTrend.month}` : ""}`}>
              {latestTrend && Object.keys(latestTrend.categories).length > 0 ? (
                <CategoryBars categories={latestTrend.categories} />
              ) : (
                <Empty>No categorized spending yet.</Empty>
              )}
            </Section>

            {/* 4. Monthly spending drill-down */}
            <Section title="Monthly spending">
              <MonthNav year={year} month={month} onPrev={prevMonth} onNext={nextMonth} />
              {budget ? (
                <>
                  <Text style={{ color: COLORS.textPrimary, fontSize: 22, fontWeight: "800", marginBottom: 10 }}>
                    {money(budget.summary.totalSpent)} spent
                  </Text>
                  {budget.envelopes.map((e) => (
                    <View key={e.id} style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 6 }}>
                      <Text style={{ color: COLORS.textMuted, fontSize: 13, flex: 1 }} numberOfLines={1}>{e.name}</Text>
                      <Text style={{ color: e.overBudget ? COLORS.danger : COLORS.textPrimary, fontSize: 13, fontWeight: "600" }}>
                        {money(e.spent)}{e.allocated > 0 ? ` / ${money(e.allocated)}` : ""}
                      </Text>
                    </View>
                  ))}
                </>
              ) : (
                <ActivityIndicator color={COLORS.brandPurple} />
              )}
            </Section>

            {/* 5. Portfolio performance */}
            <Section title="Portfolio performance">
              {portfolio?.latestSnapshot ? (
                <PortfolioPerformance
                  totalValue={portfolio.latestSnapshot.totalValue}
                  history={portfolio.snapshotHistory}
                />
              ) : (
                <Empty>Connect an investment account to see performance.</Empty>
              )}
            </Section>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Presentational pieces ─────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View
      style={{
        backgroundColor: COLORS.glassBg,
        borderWidth: 1,
        borderColor: COLORS.glassBorder,
        borderRadius: 14,
        padding: 16,
        marginBottom: 14,
      }}
    >
      <Text style={{ color: COLORS.textMuted, fontSize: 12, fontWeight: "700", letterSpacing: 1, marginBottom: 10, textTransform: "uppercase" }}>
        {title}
      </Text>
      {children}
    </View>
  );
}

function Empty({ children }: { children: string }) {
  return <Text style={{ color: COLORS.textMuted, fontSize: 13 }}>{children}</Text>;
}

/** Sparkline-style line: one thin vertical bar per point, height ∝ value. */
function MiniLine({ values }: { values: number[] }) {
  if (values.length === 0) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-end", height: 56, gap: 2 }}>
      {values.map((v, i) => (
        <View
          key={i}
          style={{
            flex: 1,
            height: 6 + ((v - min) / span) * 50,
            backgroundColor: COLORS.brandPurple,
            opacity: 0.5 + (0.5 * (i + 1)) / values.length,
            borderRadius: 2,
          }}
        />
      ))}
    </View>
  );
}

function IncomeExpenseChart({
  data,
}: {
  data: { month: string; income: number; expenses: number; net: number }[];
}) {
  const max = Math.max(1, ...data.map((d) => Math.max(d.income, d.expenses)));
  return (
    <View style={{ gap: 12 }}>
      {data.map((d) => (
        <View key={d.month}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 4 }}>
            <Text style={{ color: COLORS.textMuted, fontSize: 12 }}>{d.month}</Text>
            <Text style={{ color: d.net >= 0 ? COLORS.success : COLORS.danger, fontSize: 12, fontWeight: "600" }}>
              net {money(d.net)}
            </Text>
          </View>
          <View style={{ height: 8, borderRadius: 4, backgroundColor: COLORS.success, width: `${(d.income / max) * 100}%`, marginBottom: 3 }} />
          <View style={{ height: 8, borderRadius: 4, backgroundColor: COLORS.danger, width: `${(d.expenses / max) * 100}%` }} />
        </View>
      ))}
    </View>
  );
}

function CategoryBars({ categories }: { categories: Record<string, number> }) {
  const rows = Object.entries(categories).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const max = Math.max(1, ...rows.map(([, v]) => v));
  return (
    <View style={{ gap: 8 }}>
      {rows.map(([name, value]) => (
        <View key={name}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 3 }}>
            <Text style={{ color: COLORS.textMuted, fontSize: 13 }} numberOfLines={1}>{name}</Text>
            <Text style={{ color: COLORS.textPrimary, fontSize: 13, fontWeight: "600" }}>{money(value)}</Text>
          </View>
          <View style={{ height: 6, borderRadius: 3, backgroundColor: COLORS.brandPurple, width: `${(value / max) * 100}%` }} />
        </View>
      ))}
    </View>
  );
}

function PortfolioPerformance({
  totalValue,
  history,
}: {
  totalValue: number;
  history: { snapshotAt: number; totalValue: number }[];
}) {
  const first = history[0]?.totalValue;
  const change = first != null && first > 0 ? totalValue - first : null;
  const changePct = change != null && first ? (change / first) * 100 : null;
  return (
    <>
      <Text style={{ color: COLORS.textPrimary, fontSize: 30, fontWeight: "800" }}>{money(totalValue, 2)}</Text>
      {change != null && changePct != null ? (
        <Text style={{ color: change >= 0 ? COLORS.success : COLORS.danger, fontSize: 13, marginTop: 4, marginBottom: 12 }}>
          {change >= 0 ? "+" : ""}{money(change, 2)} ({changePct >= 0 ? "+" : ""}{changePct.toFixed(1)}%) since tracking began
        </Text>
      ) : (
        <Text style={{ color: COLORS.textMuted, fontSize: 12, marginTop: 4, marginBottom: 12 }}>
          Return appears once there’s more than one snapshot.
        </Text>
      )}
      {history.length > 1 && <MiniLine values={history.map((h) => h.totalValue)} />}
    </>
  );
}
