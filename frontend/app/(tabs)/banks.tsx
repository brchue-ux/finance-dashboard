/**
 * Banks tab — spec §9 Banks Screen. Primary account browsing: one card per
 * connected bank account with balance masked-by-default (tap-to-reveal), plus
 * the "+ Add account" entry. Card tap → per-account transaction history.
 *
 * "+ Add account" launches the onboarding wizard, which is PAUSED (it needs an
 * interactive OAuth/hosted-link flow the user must drive) — so the entry is
 * present but explains it's not wired yet. It goes live with the wizard task.
 */
import { useState } from "react";
import { ScrollView, View, Text, Pressable, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { GradientText } from "@/components/ui/GradientText";
import { COLORS } from "@/constants/theme";
import { connectionStatusPill } from "@/lib/connection-status";
import { useBanks, type BankAccount } from "@/hooks/useBanks";

function timeAgo(ts: number | null): string {
  if (ts == null) return "never";
  const diff = Math.floor(Date.now() / 1000 - ts);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function formatBalance(account: BankAccount): string {
  const value = account.balanceCurrent ?? account.balanceAvailable;
  if (value == null) return "—";
  const currency = account.isoCurrencyCode && account.isoCurrencyCode !== "CAD" ? ` ${account.isoCurrencyCode}` : "";
  return `$${Math.abs(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${currency}`;
}

export default function BanksScreen() {
  const { data: accounts, isLoading } = useBanks();
  const router = useRouter();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.background }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
        <GradientText style={{ fontSize: 28, fontWeight: "800", marginBottom: 20 }}>Banks</GradientText>

        {isLoading ? (
          <ActivityIndicator color={COLORS.brandPurple} style={{ marginTop: 40 }} />
        ) : (
          <>
            {(accounts ?? []).map((account) => (
              <AccountCard
                key={account.id}
                account={account}
                onPress={() => router.push({ pathname: "/account/[id]", params: { id: account.id } } as any)}
              />
            ))}

            {/* Adding one more account is a single connection, not the whole
                first-run chain — the full wizard is offered below when the user
                has nothing connected yet. */}
            <Pressable
              // Opens the type picker — bank, brokerage or spreadsheet — so
              // every population path stays reachable after onboarding.
              onPress={() => router.push("/connect-account" as any)}
              style={{
                borderWidth: 1,
                borderColor: COLORS.glassBorder,
                borderStyle: "dashed",
                borderRadius: 14,
                paddingVertical: 18,
                alignItems: "center",
                marginTop: 6,
              }}
            >
              <Text style={{ color: COLORS.brandPurple, fontSize: 15, fontWeight: "600" }}>
                + Add another account
              </Text>
            </Pressable>

            {(accounts?.length ?? 0) === 0 && (
              <View style={{ marginTop: 16, alignItems: "center" }}>
                <Text style={{ color: COLORS.textMuted, fontSize: 13, textAlign: "center" }}>
                  No accounts yet. Add one to start tracking balances and transactions.
                </Text>
                {/* Nothing connected: offer the guided chain rather than making
                    the user discover and trigger each connection separately. */}
                <Pressable onPress={() => router.push("/connect-account?mode=wizard" as any)} style={{ marginTop: 12 }}>
                  <Text style={{ color: COLORS.brandPurple, fontSize: 14, fontWeight: "600" }}>
                    Set up all my accounts
                  </Text>
                </Pressable>
              </View>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function AccountCard({ account, onPress }: { account: BankAccount; onPress: () => void }) {
  const [revealed, setRevealed] = useState(false);
  const pill = connectionStatusPill(account.connectionStatus);
  const synced = account.connectionStatus === "manual" ? "Manual account" : `Synced ${timeAgo(account.lastSyncedAt)}`;

  return (
    <Pressable
      onPress={onPress}
      style={{
        backgroundColor: COLORS.glassBg,
        borderWidth: 1,
        borderColor: COLORS.glassBorder,
        borderRadius: 14,
        padding: 16,
        marginBottom: 12,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 10 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: COLORS.textPrimary, fontWeight: "700", fontSize: 15 }} numberOfLines={1}>
            {account.name}
          </Text>
          <Text style={{ color: COLORS.textMuted, fontSize: 12, marginTop: 2 }}>
            {account.institution}
            {account.mask ? ` ••${account.mask}` : ""}
          </Text>
        </View>
        {pill && (
          <Text style={{ color: pill.color, fontSize: 12, fontWeight: "600" }}>{pill.label}</Text>
        )}
      </View>

      <View style={{ flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between" }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <Text style={{ color: COLORS.textPrimary, fontSize: 22, fontWeight: "800" }}>
            {revealed ? formatBalance(account) : "••••••"}
          </Text>
          <Pressable
            onPress={(e) => {
              // On web the click bubbles to the card (→ navigation); stop it so
              // the eye toggle only reveals. On native, nested Pressables don't
              // bubble, and stopPropagation is absent — hence the guarded cast.
              (e as { stopPropagation?: () => void })?.stopPropagation?.();
              setRevealed((r) => !r);
            }}
            hitSlop={12}
          >
            <Text style={{ fontSize: 16 }}>{revealed ? "🙈" : "👁"}</Text>
          </Pressable>
        </View>
        <Text style={{ color: COLORS.textMuted, fontSize: 12 }}>{synced}</Text>
      </View>
    </Pressable>
  );
}
