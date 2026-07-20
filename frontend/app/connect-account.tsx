/**
 * Add Account wizard (spec §5). Reached from the Banks tab "+ Add account".
 * Two provider choices, each a hosted sign-in that never exposes credentials to
 * this app. On success the relevant queries are invalidated (in useConnect) and
 * we pop back to where the user came from so the new data appears.
 */
import { useEffect } from "react";
import { View, Text, Pressable, ActivityIndicator, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { COLORS } from "@/constants/theme";
import { useConnectBank, useConnectBrokerage, type ConnectOutcome } from "@/hooks/useConnect";

export default function ConnectAccountScreen() {
  const router = useRouter();
  const bank = useConnectBank();
  const brokerage = useConnectBrokerage();

  const busy = bank.isPending || brokerage.isPending;
  const connected =
    bank.data === "connected" || brokerage.data === "connected";
  const cancelled =
    (bank.data as ConnectOutcome | undefined) === "cancelled" ||
    (brokerage.data as ConnectOutcome | undefined) === "cancelled";
  const error = bank.error ?? brokerage.error;

  // A finished connection has already invalidated the data queries; give the
  // success state a beat to register, then return to the Banks list.
  useEffect(() => {
    if (!connected) return;
    const t = setTimeout(() => router.back(), 1200);
    return () => clearTimeout(t);
  }, [connected, router]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.background }}>
      <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 }}>
        <Pressable onPress={() => router.back()} hitSlop={12} disabled={busy} style={{ flexDirection: "row", alignItems: "center", flex: 1, opacity: busy ? 0.4 : 1 }}>
          <Text style={{ color: COLORS.brandPurple, fontSize: 24, marginRight: 4 }}>‹</Text>
          <Text style={{ color: COLORS.textPrimary, fontSize: 18, fontWeight: "700" }}>Add account</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <Text style={{ color: COLORS.textMuted, fontSize: 14, lineHeight: 20, marginBottom: 20 }}>
          Connect through the provider’s own secure sign-in. Your banking
          credentials are entered with them — never stored in this app.
        </Text>

        {connected ? (
          <View style={{ backgroundColor: COLORS.insightBg, borderWidth: 1, borderColor: COLORS.insightBorder, borderRadius: 14, padding: 20, alignItems: "center" }}>
            <Text style={{ fontSize: 32, marginBottom: 6 }}>✓</Text>
            <Text style={{ color: COLORS.success, fontSize: 16, fontWeight: "700" }}>Connected</Text>
            <Text style={{ color: COLORS.textMuted, fontSize: 13, marginTop: 4 }}>Pulling in your accounts…</Text>
          </View>
        ) : (
          <>
            <ProviderCard
              emoji="🏦"
              title="Connect a bank"
              subtitle="Chequing, savings & credit cards via Plaid"
              pending={bank.isPending}
              disabled={busy}
              onPress={() => bank.mutate()}
            />
            <ProviderCard
              emoji="📈"
              title="Connect a brokerage"
              subtitle="Wealthsimple & others via SnapTrade"
              pending={brokerage.isPending}
              disabled={busy}
              onPress={() => brokerage.mutate()}
            />

            {busy && (
              <Text style={{ color: COLORS.textMuted, fontSize: 13, textAlign: "center", marginTop: 16 }}>
                Finish signing in from the browser window…
              </Text>
            )}
            {cancelled && !busy && (
              <Text style={{ color: COLORS.textMuted, fontSize: 13, textAlign: "center", marginTop: 16 }}>
                Connection cancelled. You can try again anytime.
              </Text>
            )}
            {error && !busy && (
              <Text style={{ color: COLORS.danger, fontSize: 13, textAlign: "center", marginTop: 16 }}>
                {error.message || "Something went wrong. Please try again."}
              </Text>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function ProviderCard({
  emoji,
  title,
  subtitle,
  pending,
  disabled,
  onPress,
}: {
  emoji: string;
  title: string;
  subtitle: string;
  pending: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={{
        flexDirection: "row",
        alignItems: "center",
        backgroundColor: COLORS.glassBg,
        borderWidth: 1,
        borderColor: COLORS.glassBorder,
        borderRadius: 14,
        padding: 16,
        marginBottom: 12,
        opacity: disabled && !pending ? 0.5 : 1,
      }}
    >
      <Text style={{ fontSize: 26, marginRight: 14 }}>{emoji}</Text>
      <View style={{ flex: 1 }}>
        <Text style={{ color: COLORS.textPrimary, fontSize: 16, fontWeight: "700" }}>{title}</Text>
        <Text style={{ color: COLORS.textMuted, fontSize: 13, marginTop: 2 }}>{subtitle}</Text>
      </View>
      {pending ? (
        <ActivityIndicator color={COLORS.brandPurple} />
      ) : (
        <Text style={{ color: COLORS.brandPurple, fontSize: 22 }}>›</Text>
      )}
    </Pressable>
  );
}
