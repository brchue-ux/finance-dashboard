/**
 * TradingView alerts setup — webhook URL + per-user secret.
 *
 * Also carries the plan-requirement notice required by build-reminders.md #2:
 * TradingView webhooks need a paid plan (Essential or higher). Without this
 * surfaced, a free-plan user configures alerts and waits for data that never
 * arrives — silent failure, the worst outcome. Chosen form is the soft inline
 * indicator (option B), not a hard onboarding gate, because native price alerts
 * are the load-bearing path here and TradingView is an optional enhancement.
 */
import { useState } from "react";
import { ScrollView, View, Text, Pressable, ActivityIndicator, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useMutation } from "@tanstack/react-query";
import { GlassCard } from "@/components/ui/GlassCard";
import { GradientText } from "@/components/ui/GradientText";
import { COLORS } from "@/constants/theme";
import { api } from "@/lib/api";
import { getApiUrl } from "@/lib/env";

export default function TradingViewAlertsScreen() {
  const router = useRouter();
  const [secret, setSecret] = useState<string | null>(null);

  const issue = useMutation({
    mutationFn: () => api.post<{ secret: string }>("/api/settings/webhook-secret"),
    onSuccess: (r) => setSecret(r.secret),
    onError: (e) => Alert.alert("Couldn’t generate secret", String(e)),
  });

  const webhookUrl = `${getApiUrl()}/api/webhooks/tradingview`;

  function generate() {
    const rotating = secret !== null;
    const run = () => issue.mutate();
    if (!rotating) return run();
    Alert.alert(
      "Rotate secret?",
      "The previous secret stops working immediately. Any TradingView alert still using it will fail until you update it.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Rotate", style: "destructive", onPress: run },
      ]
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.background }}>
      <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 }}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={{ flexDirection: "row", alignItems: "center" }}>
          <Text style={{ color: COLORS.brandPurple, fontSize: 24, marginRight: 4 }}>‹</Text>
          <GradientText style={{ fontSize: 20, fontWeight: "800" }}>TradingView alerts</GradientText>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        {/* Plan requirement — build-reminders.md #2 */}
        <View
          style={{
            backgroundColor: COLORS.insightBg,
            borderWidth: 1,
            borderColor: COLORS.insightBorder,
            borderRadius: 16,
            padding: 16,
            marginBottom: 16,
          }}
        >
          <Text style={{ color: COLORS.warning, fontWeight: "700", fontSize: 14 }}>
            Requires a paid TradingView plan
          </Text>
          <Text style={{ color: COLORS.textPrimary, fontSize: 13, marginTop: 6, lineHeight: 19 }}>
            TradingView only sends webhooks on Essential plans and above. On the
            free plan you can create alerts, but they will never reach this app.
          </Text>
          <Text style={{ color: COLORS.textMuted, fontSize: 12, marginTop: 8, lineHeight: 18 }}>
            This is optional. Native price alerts run on their own and don’t need
            a TradingView plan — set those up under Manage alerts.
          </Text>
        </View>

        <GlassCard style={{ marginBottom: 12 }}>
          <Text style={{ color: COLORS.textPrimary, fontWeight: "600", fontSize: 15 }}>
            Webhook URL
          </Text>
          <Text
            selectable
            style={{ color: COLORS.textMuted, fontSize: 12, marginTop: 8, lineHeight: 18 }}
          >
            {webhookUrl}
          </Text>
          <Text style={{ color: COLORS.textMuted, fontSize: 12, marginTop: 8 }}>
            Paste this into the alert’s Notification → Webhook URL field.
          </Text>
        </GlassCard>

        <GlassCard>
          <Text style={{ color: COLORS.textPrimary, fontWeight: "600", fontSize: 15 }}>
            Webhook secret
          </Text>
          <Text style={{ color: COLORS.textMuted, fontSize: 12, marginTop: 6, lineHeight: 18 }}>
            Include this in the alert message body so the app can verify the
            request is yours. Only a hash is stored, so it’s shown once — if you
            lose it, generate a new one.
          </Text>

          {secret && (
            <View
              style={{
                backgroundColor: COLORS.glassBg,
                borderWidth: 1,
                borderColor: COLORS.glassBorder,
                borderRadius: 10,
                padding: 12,
                marginTop: 12,
              }}
            >
              <Text selectable style={{ color: COLORS.textPrimary, fontSize: 13 }}>
                {secret}
              </Text>
              <Text style={{ color: COLORS.warning, fontSize: 11, marginTop: 8 }}>
                Copy this now — it won’t be shown again.
              </Text>
            </View>
          )}

          <Pressable onPress={generate} disabled={issue.isPending} style={{ marginTop: 14 }}>
            {issue.isPending ? (
              <ActivityIndicator color={COLORS.brandPurple} />
            ) : (
              <Text style={{ color: COLORS.brandPurple, fontWeight: "600", fontSize: 14 }}>
                {secret ? "Generate a new secret" : "Generate secret"}
              </Text>
            )}
          </Pressable>
        </GlassCard>
      </ScrollView>
    </SafeAreaView>
  );
}
