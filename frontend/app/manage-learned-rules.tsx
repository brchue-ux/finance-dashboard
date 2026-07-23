/**
 * Manage Learned Rules — view and remove the rules the app has learned from your
 * corrections (build-reminders 6b).
 *
 * This screen is the whole point of keeping learned rules in a plain table you
 * own rather than a model you can't see: every rule here is one you approved,
 * shows what it files and how many transactions it claimed when you saved it, and
 * can be removed. Removing one isn't just forgetting it — the server re-derives
 * the rows it had captured without it, so deleting a rule genuinely undoes it.
 */
import {
  ScrollView,
  View,
  Text,
  Pressable,
  ActivityIndicator,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { GlassCard } from "@/components/ui/GlassCard";
import { GradientText } from "@/components/ui/GradientText";
import { COLORS } from "@/constants/theme";
import {
  useLearnedRulesList,
  useDeleteLearnedRule,
  type LearnedRule,
} from "@/hooks/useLearnedRules";

export default function ManageLearnedRulesScreen() {
  const router = useRouter();
  const { data, isLoading } = useLearnedRulesList();
  const remove = useDeleteLearnedRule();

  const rules = data?.rules ?? [];

  function confirmDelete(rule: LearnedRule) {
    Alert.alert(
      "Remove this rule?",
      `Transactions matching “${rule.pattern}” will be re-categorized without it — they fall back to your other rules.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () =>
            remove.mutate(rule.id, {
              onSuccess: (r) =>
                Alert.alert("Removed", `Re-categorized ${r.refiled} transaction${r.refiled === 1 ? "" : "s"}.`),
              onError: (e) => Alert.alert("Couldn’t remove", String(e)),
            }),
        },
      ]
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.background }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          paddingHorizontal: 16,
          paddingTop: 8,
          paddingBottom: 12,
        }}
      >
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          style={{ flexDirection: "row", alignItems: "center" }}
        >
          <Text style={{ color: COLORS.brandPurple, fontSize: 24, marginRight: 4 }}>‹</Text>
          <GradientText style={{ fontSize: 20, fontWeight: "800" }}>Learned rules</GradientText>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        {isLoading ? (
          <ActivityIndicator color={COLORS.brandPurple} style={{ marginTop: 40 }} />
        ) : rules.length === 0 ? (
          <GlassCard>
            <Text style={{ color: COLORS.textPrimary, fontWeight: "600", fontSize: 15 }}>
              No learned rules yet
            </Text>
            <Text style={{ color: COLORS.textMuted, fontSize: 13, marginTop: 6 }}>
              When you correct a transaction’s category, the app offers to make it
              a rule. The ones you accept show up here, and each one takes priority
              over the built-in matching.
            </Text>
          </GlassCard>
        ) : (
          <>
            <Text style={{ color: COLORS.textMuted, fontSize: 12, marginBottom: 12 }}>
              These take priority over the built-in rules. {rules.length} rule
              {rules.length === 1 ? "" : "s"}.
            </Text>
            {rules.map((rule) => (
              <GlassCard key={rule.id} style={{ marginBottom: 10 }}>
                <View
                  style={{
                    flexDirection: "row",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                  }}
                >
                  <View style={{ flex: 1, paddingRight: 12 }}>
                    <Text style={{ color: COLORS.textPrimary, fontSize: 15 }}>
                      <Text style={{ color: COLORS.textMuted }}>contains </Text>
                      <Text style={{ fontWeight: "700" }}>{rule.pattern}</Text>
                      <Text style={{ color: COLORS.textMuted }}> → </Text>
                      <Text style={{ fontWeight: "700", color: COLORS.brandPurple }}>
                        {rule.category}
                      </Text>
                    </Text>
                    {rule.catchesAtCreation != null && (
                      <Text style={{ color: COLORS.textMuted, fontSize: 12, marginTop: 6 }}>
                        Matched {rule.catchesAtCreation} transaction
                        {rule.catchesAtCreation === 1 ? "" : "s"} when saved
                      </Text>
                    )}
                    {/* Scope, only when narrowed — unscoped rules stay unadorned. */}
                    {(rule.accountId || rule.effectiveFrom) && (
                      <Text style={{ color: COLORS.brandPurple, fontSize: 12, marginTop: 4 }}>
                        {[
                          rule.accountId ? `Only ${rule.accountName ?? "one account"}` : null,
                          rule.effectiveFrom ? `From ${rule.effectiveFrom}` : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </Text>
                    )}
                  </View>
                  <Pressable
                    onPress={() => confirmDelete(rule)}
                    disabled={remove.isPending}
                    hitSlop={8}
                  >
                    <Text style={{ color: COLORS.danger, fontSize: 13, fontWeight: "600" }}>
                      Remove
                    </Text>
                  </Pressable>
                </View>
              </GlassCard>
            ))}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
