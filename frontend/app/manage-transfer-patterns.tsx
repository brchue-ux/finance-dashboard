/**
 * Manage Transfer Patterns — approve which descriptions mean "money moving
 * between my own accounts" (neither income nor spending).
 *
 * Propose, don't impose: nothing is applied until approved here. Each
 * suggestion shows what approving it would mark RIGHT NOW; approval also
 * covers future imports — this is the first production writer for that
 * marking, so new credit-card payments stop double-counting at write time.
 * Removing a pattern unmarks only the rows no other pattern still claims;
 * rows you marked by hand are never touched by pattern changes.
 */
import { ScrollView, View, Text, Pressable, ActivityIndicator, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { GlassCard } from "@/components/ui/GlassCard";
import { GradientText } from "@/components/ui/GradientText";
import { COLORS } from "@/constants/theme";
import {
  useTransferPatterns,
  useSaveTransferPattern,
  useDeleteTransferPattern,
  type SavedTransferPattern,
  type TransferPatternSuggestion,
} from "@/hooks/useTransferPatterns";

export default function ManageTransferPatternsScreen() {
  const router = useRouter();
  const { data, isLoading } = useTransferPatterns();
  const save = useSaveTransferPattern();
  const remove = useDeleteTransferPattern();

  function approve(s: TransferPatternSuggestion) {
    Alert.alert(
      "Approve this pattern?",
      `“${s.pattern}” will mark ${s.wouldMark} existing transaction${s.wouldMark === 1 ? "" : "s"} as transfers, and every future import matching it.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Approve",
          onPress: () =>
            save.mutate(s.pattern, {
              onSuccess: (r) => Alert.alert("Approved", `Marked ${r.marked} transaction${r.marked === 1 ? "" : "s"}.`),
              onError: (e) => Alert.alert("Couldn't save", String(e)),
            }),
        },
      ]
    );
  }

  function confirmDelete(p: SavedTransferPattern) {
    Alert.alert(
      "Remove this pattern?",
      `Rows only “${p.pattern}” marked will go back to counting as income/spending. Hand-marked rows are untouched.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () =>
            remove.mutate(p.id, {
              onSuccess: (r) => Alert.alert("Removed", `Unmarked ${r.unmarked} transaction${r.unmarked === 1 ? "" : "s"}.`),
              onError: (e) => Alert.alert("Couldn't remove", String(e)),
            }),
        },
      ]
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.background }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
        <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 6 }}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Text style={{ color: COLORS.brandPurple, fontSize: 16 }}>‹ Back</Text>
          </Pressable>
        </View>
        <GradientText style={{ fontSize: 24, fontWeight: "800", marginBottom: 4 }}>
          Transfer patterns
        </GradientText>
        <Text style={{ color: COLORS.textMuted, fontSize: 13, marginBottom: 16 }}>
          A transfer is money moving between your own accounts — a credit-card payment, a move
          into savings. It's neither income nor spending, so matching rows are held out of every
          budget figure. Nothing applies until you approve it.
        </Text>

        {isLoading ? (
          <ActivityIndicator color={COLORS.brandPurple} />
        ) : (
          <>
            <Text style={{ color: COLORS.textPrimary, fontWeight: "700", fontSize: 15, marginBottom: 8 }}>
              Approved
            </Text>
            {(data?.patterns ?? []).length === 0 && (
              <Text style={{ color: COLORS.textMuted, fontSize: 13, marginBottom: 12 }}>
                None yet — approve a suggestion below, and future imports mark themselves.
              </Text>
            )}
            {(data?.patterns ?? []).map((p) => (
              <GlassCard key={p.id} style={{ marginBottom: 8 }}>
                <View style={{ flexDirection: "row", alignItems: "center" }}>
                  <View style={{ flex: 1, paddingRight: 8 }}>
                    <Text style={{ color: COLORS.textPrimary, fontSize: 14, fontWeight: "600" }} numberOfLines={1}>
                      {p.pattern}
                    </Text>
                    <Text style={{ color: COLORS.textMuted, fontSize: 12, marginTop: 2 }}>
                      matches {p.currentMatches} transaction{p.currentMatches === 1 ? "" : "s"}
                    </Text>
                  </View>
                  <Pressable onPress={() => confirmDelete(p)} hitSlop={8} disabled={remove.isPending}>
                    <Text style={{ color: COLORS.danger, fontSize: 13, fontWeight: "600" }}>Remove</Text>
                  </Pressable>
                </View>
              </GlassCard>
            ))}

            <Text style={{ color: COLORS.textPrimary, fontWeight: "700", fontSize: 15, marginTop: 16, marginBottom: 8 }}>
              Suggestions
            </Text>
            {(data?.suggestions ?? []).map((s) => (
              <GlassCard key={s.pattern} style={{ marginBottom: 8 }}>
                <View style={{ flexDirection: "row", alignItems: "center" }}>
                  <View style={{ flex: 1, paddingRight: 8 }}>
                    <Text style={{ color: COLORS.textPrimary, fontSize: 14, fontWeight: "600" }} numberOfLines={1}>
                      {s.pattern}
                    </Text>
                    <Text style={{ color: COLORS.textMuted, fontSize: 12, marginTop: 2 }}>
                      {s.why}
                    </Text>
                    <Text style={{ color: COLORS.textMuted, fontSize: 12, marginTop: 2 }}>
                      would mark {s.wouldMark} now
                      {s.alreadyMarked > 0 ? ` · ${s.alreadyMarked} already marked` : ""}
                    </Text>
                  </View>
                  <Pressable onPress={() => approve(s)} hitSlop={8} disabled={save.isPending}>
                    <Text style={{ color: COLORS.brandPurple, fontSize: 13, fontWeight: "700" }}>Approve</Text>
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
