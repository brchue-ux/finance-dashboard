/**
 * Suggested Categories — build-reminders item 6c.
 *
 * Instead of shipping a fixed taxonomy, the app derives a proposal from the
 * user's OWN spending: the categories their transactions actually fall into,
 * and the merchants nothing could place. Everything here is a proposal the user
 * accepts, renames, or ignores — never an imposition. Reached from Manage
 * Categories.
 */
import { View, Text, Pressable, ScrollView, ActivityIndicator, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { GlassCard } from "@/components/ui/GlassCard";
import { GradientText } from "@/components/ui/GradientText";
import { COLORS } from "@/constants/theme";
import { useEnvelopeProposal, type RecognizedCategory, type UnrecognizedMerchant } from "@/hooks/useEnvelopeProposal";
import { useCreateEnvelope } from "@/hooks/useEnvelopes";
import { formatMoney } from "@/lib/money";

const money = (n: number) => formatMoney(n);

export default function SuggestedCategoriesScreen() {
  const router = useRouter();
  const { data, isLoading, refetch } = useEnvelopeProposal();
  const create = useCreateEnvelope();

  // Only the categories the user does NOT already have are actionable; the rest
  // are shown for context so the proposal reads as "here is your whole picture".
  const newCategories = (data?.recognized ?? []).filter((r) => !r.alreadyExists);
  const existing = (data?.recognized ?? []).filter((r) => r.alreadyExists);

  function addRecognized(r: RecognizedCategory) {
    create.mutate(
      {
        name: r.name,
        // The observed monthly average is a starting target the user can tune,
        // not a limit we invented.
        monthlyTarget: Math.round(r.monthlyAverage),
        // Seed the same merchant rules so accepting immediately auto-files the
        // rows that produced this suggestion.
        categoryRules: r.categoryRules,
      },
      {
        onSuccess: () => refetch(),
        onError: (e) => Alert.alert("Couldn’t add category", String(e)),
      }
    );
  }

  function addFromMerchant(m: UnrecognizedMerchant) {
    // The merchant string becomes both the category name and its matching rule.
    // It is deliberately editable afterward — renaming in Manage Categories
    // cascades to history and learned rules — so "BCM INSURANCE WELLAND" can
    // become "Insurance" without losing anything.
    Alert.alert(
      "Create a category?",
      `Creates a category "${m.merchant}" that matches this merchant. You can rename it afterward in Manage Categories.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Create",
          onPress: () =>
            create.mutate(
              { name: m.merchant, monthlyTarget: 0, categoryRules: [m.merchant] },
              {
                onSuccess: () => refetch(),
                onError: (e) => Alert.alert("Couldn’t create category", String(e)),
              }
            ),
        },
      ]
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.background }}>
      <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 }}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={{ flexDirection: "row", alignItems: "center" }}>
          <Text style={{ color: COLORS.brandPurple, fontSize: 24, marginRight: 4 }}>‹</Text>
          <GradientText style={{ fontSize: 20, fontWeight: "800" }}>Suggested categories</GradientText>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        {isLoading ? (
          <ActivityIndicator color={COLORS.brandPurple} style={{ marginTop: 40 }} />
        ) : !data ? (
          <Text style={{ color: COLORS.textMuted }}>Couldn’t load suggestions.</Text>
        ) : (
          <>
            <Text style={{ color: COLORS.textMuted, fontSize: 13, marginBottom: 16, lineHeight: 19 }}>
              Grouped from your last {data.monthsObserved} months of spending. These
              are suggestions from your own transactions — add what fits, skip the rest.
            </Text>

            {/* New categories we can offer, most spend first */}
            {newCategories.length > 0 && (
              <>
                <SectionLabel text="From your spending" />
                {newCategories.map((r) => (
                  <GlassCard key={r.name} style={{ marginBottom: 10 }}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
                      <View style={{ flex: 1, paddingRight: 12 }}>
                        <Text style={{ color: COLORS.textPrimary, fontWeight: "600", fontSize: 15 }}>{r.name}</Text>
                        <Text style={{ color: COLORS.textMuted, fontSize: 12, marginTop: 3 }}>
                          {money(r.monthlyAverage)}/mo avg · {r.transactionCount} transactions
                        </Text>
                        <Text style={{ color: COLORS.textMuted, fontSize: 11, marginTop: 4 }} numberOfLines={1}>
                          {r.sampleMerchants.join(" · ")}
                        </Text>
                      </View>
                      <Pressable onPress={() => addRecognized(r)} disabled={create.isPending} hitSlop={8}>
                        <Text style={{ color: COLORS.brandPurple, fontWeight: "700", fontSize: 14 }}>Add</Text>
                      </Pressable>
                    </View>
                  </GlassCard>
                ))}
              </>
            )}

            {/* The gap a shipped taxonomy hides: merchants nothing matched */}
            {data.unrecognized.length > 0 && (
              <>
                <SectionLabel text="Not in any category yet" />
                <Text style={{ color: COLORS.textMuted, fontSize: 12, marginBottom: 10, lineHeight: 18 }}>
                  These merchants aren’t matched by any category, so their spending
                  isn’t counted anywhere. Create a category, or categorize them from
                  the transaction feed.
                </Text>
                {data.unrecognized.map((m) => (
                  <GlassCard key={m.merchant} style={{ marginBottom: 8 }}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                      <View style={{ flex: 1, paddingRight: 12 }}>
                        <Text style={{ color: COLORS.textPrimary, fontSize: 14 }} numberOfLines={1}>{m.merchant}</Text>
                        <Text style={{ color: COLORS.textMuted, fontSize: 12, marginTop: 2 }}>
                          {money(m.totalSpent)} · {m.transactionCount} transactions
                        </Text>
                      </View>
                      <Pressable onPress={() => addFromMerchant(m)} disabled={create.isPending} hitSlop={8}>
                        <Text style={{ color: COLORS.brandPurple, fontWeight: "600", fontSize: 13 }}>New category</Text>
                      </Pressable>
                    </View>
                  </GlassCard>
                ))}
              </>
            )}

            {/* Already-set-up categories, shown so the picture is complete */}
            {existing.length > 0 && (
              <>
                <SectionLabel text="Already added" />
                {existing.map((r) => (
                  <View
                    key={r.name}
                    style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 8, paddingHorizontal: 4 }}
                  >
                    <Text style={{ color: COLORS.textMuted, fontSize: 14 }}>{r.name}</Text>
                    <Text style={{ color: COLORS.textMuted, fontSize: 12 }}>{money(r.monthlyAverage)}/mo</Text>
                  </View>
                ))}
              </>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function SectionLabel({ text }: { text: string }) {
  return (
    <Text
      style={{
        color: COLORS.textMuted,
        fontSize: 11,
        fontWeight: "700",
        letterSpacing: 0.5,
        textTransform: "uppercase",
        marginTop: 18,
        marginBottom: 8,
      }}
    >
      {text}
    </Text>
  );
}
