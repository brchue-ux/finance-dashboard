/**
 * Holding Detail — spec §9. Native/NativeWind shell; the candlestick chart is
 * the only piece inside a WebView (ChartView). Reached from the Portfolio
 * holdings list and from Alerts cards (which pass alert context via params).
 */
import { useMemo, useState } from "react";
import { ScrollView, View, Text, Pressable, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { COLORS } from "@/constants/theme";
import { ConversationSheet } from "@/components/llm/ConversationSheet";
import { ChartView, type ChartBar } from "@/components/portfolio/ChartView";
import { usePortfolio, useOHLCV, type Holding } from "@/hooks/usePortfolio";

const TAX_BADGE: Record<Holding["accountType"], { label: string; color: string }> = {
  tfsa: { label: "TFSA — No capital gains on sale", color: COLORS.success },
  rrsp: { label: "RRSP — Tax-deferred", color: "#3B82F6" },
  non_reg: { label: "Non-Reg — Capital gains apply", color: COLORS.warning },
  crypto: { label: "Crypto", color: "#8B5CF6" },
};

function money(n: number, digits = 2): string {
  return `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

export default function HoldingDetailScreen() {
  const { ticker, alertCondition, alertPrice } = useLocalSearchParams<{
    ticker: string;
    alertCondition?: string;
    alertPrice?: string;
  }>();
  const router = useRouter();
  const symbol = (ticker ?? "").toUpperCase();

  const { data: portfolio } = usePortfolio();
  const { data: ohlcv, isLoading: chartLoading, isError: chartError } = useOHLCV(symbol, "1y");
  const [chatOpen, setChatOpen] = useState(false);
  const [ma20, setMa20] = useState(false);
  const [ma50, setMa50] = useState(false);
  const [rsi, setRsi] = useState(false);
  const [macd, setMacd] = useState(false);

  // RSI and MACD each add a stacked sub-pane, so grow the chart to keep price readable.
  const chartHeight = 260 + (rsi ? 90 : 0) + (macd ? 90 : 0);

  const holding = portfolio?.holdings.find((h) => h.ticker.toUpperCase() === symbol);

  const bars: ChartBar[] = useMemo(
    () => (ohlcv?.bars ?? []).map((b) => ({ time: b.time, open: b.open, high: b.high, low: b.low, close: b.close })),
    [ohlcv]
  );
  const overlay = useMemo(
    () =>
      holding
        ? { costBasis: holding.costBasis, purchaseLabel: `${holding.quantity} shares @ ${money(holding.costBasis)}` }
        : undefined,
    [holding]
  );

  const costTotal = holding ? holding.costBasis * holding.quantity : 0;
  const pnl = holding ? holding.marketValue - costTotal : 0;
  const pnlPct = costTotal > 0 ? (pnl / costTotal) * 100 : 0;
  const currentPrice = holding && holding.quantity > 0 ? holding.marketValue / holding.quantity : null;
  const badge = holding ? TAX_BADGE[holding.accountType] : null;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.background }}>
      {/* Header */}
      <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 }}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={{ flexDirection: "row", alignItems: "center", flex: 1 }}>
          <Text style={{ color: COLORS.brandPurple, fontSize: 24, marginRight: 4 }}>‹</Text>
          <View>
            <Text style={{ color: COLORS.textPrimary, fontSize: 18, fontWeight: "800" }}>{symbol}</Text>
            {holding && <Text style={{ color: COLORS.textMuted, fontSize: 12 }} numberOfLines={1}>{holding.name}</Text>}
          </View>
        </Pressable>
        <Pressable
          onPress={() => router.push({ pathname: "/manage-alerts", params: { ticker: symbol } } as any)}
          hitSlop={8}
        >
          <Text style={{ color: COLORS.brandPurple, fontSize: 14, fontWeight: "600" }}>Set alert</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        {/* Alert context (when arriving from an alert) */}
        {alertCondition ? (
          <View style={{ backgroundColor: COLORS.insightBg, borderWidth: 1, borderColor: COLORS.insightBorder, borderRadius: 12, padding: 12, marginBottom: 14 }}>
            <Text style={{ color: COLORS.warning, fontSize: 12, fontWeight: "700", marginBottom: 2 }}>ALERT</Text>
            <Text style={{ color: COLORS.textPrimary, fontSize: 14 }}>
              {alertCondition}{alertPrice ? ` · ${money(Number(alertPrice))}` : ""}
            </Text>
          </View>
        ) : null}

        {/* Chart */}
        {chartLoading ? (
          <View style={{ height: 260, alignItems: "center", justifyContent: "center" }}>
            <ActivityIndicator color={COLORS.brandPurple} />
          </View>
        ) : chartError || bars.length === 0 ? (
          <View style={{ height: 120, alignItems: "center", justifyContent: "center", backgroundColor: COLORS.glassBg, borderRadius: 12, borderWidth: 1, borderColor: COLORS.glassBorder }}>
            <Text style={{ color: COLORS.textMuted, fontSize: 13 }}>Price history unavailable</Text>
          </View>
        ) : (
          <ChartView bars={bars} overlay={overlay} ma20={ma20} ma50={ma50} rsi={rsi} macd={macd} height={chartHeight} />
        )}

        {/* Indicator toggles: MA20/MA50 overlay the price; RSI/MACD add sub-panes. */}
        {bars.length > 0 && (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
            <Chip label="MA20" active={ma20} onPress={() => setMa20((v) => !v)} />
            <Chip label="MA50" active={ma50} onPress={() => setMa50((v) => !v)} />
            <Chip label="RSI" active={rsi} onPress={() => setRsi((v) => !v)} />
            <Chip label="MACD" active={macd} onPress={() => setMacd((v) => !v)} />
          </View>
        )}

        {/* Position summary */}
        {holding ? (
          <View style={{ backgroundColor: COLORS.glassBg, borderWidth: 1, borderColor: COLORS.glassBorder, borderRadius: 14, padding: 16, marginTop: 16 }}>
            {badge && (
              <View style={{ alignSelf: "flex-start", backgroundColor: badge.color + "22", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, marginBottom: 12 }}>
                <Text style={{ color: badge.color, fontSize: 11, fontWeight: "700" }}>{badge.label}</Text>
              </View>
            )}
            <Row label="Market value" value={money(holding.marketValue)} />
            {currentPrice != null && <Row label="Current price" value={money(currentPrice)} />}
            <Row label="Cost basis" value={`${money(holding.costBasis)} · ${money(costTotal)} total`} />
            <Row
              label="Unrealized P&L"
              value={`${pnl >= 0 ? "+" : ""}${money(pnl)} (${pnl >= 0 ? "+" : ""}${pnlPct.toFixed(1)}%)`}
              valueColor={pnl >= 0 ? COLORS.success : COLORS.danger}
            />
          </View>
        ) : (
          <Text style={{ color: COLORS.textMuted, fontSize: 13, marginTop: 16 }}>
            {symbol} isn’t in your portfolio — showing price history only.
          </Text>
        )}

        {/* Analyze with Claude */}
        <Pressable
          onPress={() => setChatOpen(true)}
          style={{ backgroundColor: COLORS.brandPurple, borderRadius: 12, paddingVertical: 13, alignItems: "center", marginTop: 20 }}
        >
          <Text style={{ color: "#fff", fontWeight: "700", fontSize: 15 }}>Analyze with Claude</Text>
        </Pressable>
      </ScrollView>

      <ConversationSheet
        visible={chatOpen}
        onClose={() => setChatOpen(false)}
        view="portfolio"
        alertContext={JSON.stringify({
          ticker: symbol,
          ...(holding ? { marketValue: holding.marketValue, costBasis: holding.costBasis, quantity: holding.quantity } : {}),
          ...(alertCondition ? { alertCondition } : {}),
        })}
      />
    </SafeAreaView>
  );
}

function Row({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 6 }}>
      <Text style={{ color: COLORS.textMuted, fontSize: 13 }}>{label}</Text>
      <Text style={{ color: valueColor ?? COLORS.textPrimary, fontSize: 13, fontWeight: "600" }}>{value}</Text>
    </View>
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        paddingHorizontal: 14,
        paddingVertical: 7,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: active ? COLORS.brandPurple : COLORS.glassBorder,
        backgroundColor: active ? "rgba(124,58,237,0.15)" : "transparent",
      }}
    >
      <Text style={{ color: active ? COLORS.textPrimary : COLORS.textMuted, fontSize: 13, fontWeight: "600" }}>{label}</Text>
    </Pressable>
  );
}
