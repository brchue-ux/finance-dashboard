/**
 * Category picker — reassigns one transaction to a different envelope.
 *
 * build-reminders 6a. Deliberately a flat list of the user's OWN active
 * envelopes with no free-text field: the server only accepts names that
 * resolve to an envelope, so letting someone type here would mostly produce
 * rejections. Creating a new envelope is a separate, deliberate act on
 * /manage-envelopes, not something to do halfway through filing a receipt.
 *
 * "Uncategorized" is offered as a real choice. A user who realises they
 * mis-filed something has to be able to put it back in the review queue
 * instead of picking a wrong envelope to get out of the sheet.
 */
import { useState } from "react";
import { View, Text, Pressable, ScrollView, ActivityIndicator, Alert, Dimensions } from "react-native";
import { COLORS } from "@/constants/theme";
import { useEnvelopes } from "@/hooks/useEnvelopes";
import { useRecategorize } from "@/hooks/useRecategorize";
import { LearnedRuleProposal } from "./LearnedRuleProposal";

const UNCATEGORIZED = "uncategorized";

export function CategoryPicker({
  transactionId,
  description,
  currentCategory,
  onDone,
}: {
  transactionId: string;
  description: string;
  currentCategory: string | null;
  onDone: () => void;
}) {
  const { data, isLoading } = useEnvelopes();
  const recategorize = useRecategorize();

  // Once a correction lands in a real envelope, this holds it and the sheet
  // advances to "make this a rule?" (build-reminders 6b) instead of closing.
  const [proposeFor, setProposeFor] = useState<string | null>(null);

  const envelopes = (data?.envelopes ?? []).filter((e) => e.active);
  const current = currentCategory ?? UNCATEGORIZED;

  function choose(category: string) {
    // Choosing the category it already has is a no-op that would still write
    // categorySource="manual" and refetch four queries.
    if (category.toLowerCase() === current.toLowerCase()) {
      onDone();
      return;
    }
    recategorize.mutate(
      { transactionId, category },
      {
        onSuccess: () => {
          // Offer to make it a standing rule — but only when it landed in a
          // real envelope. Promoting an "always uncategorize this" rule is a
          // rare intent, not worth interrupting the common correction flow with
          // a second step; sending someone back to the review queue just closes.
          if (category.toLowerCase() === UNCATEGORIZED) onDone();
          else setProposeFor(category);
        },
        // Surfaces the server's own message rather than a generic failure —
        // the one a user will actually hit is the split-transaction 409, which
        // tells them where to go instead.
        onError: (e: unknown) =>
          Alert.alert(
            "Could not recategorize",
            e instanceof Error ? e.message : "Something went wrong."
          ),
      }
    );
  }

  if (proposeFor) {
    return (
      <LearnedRuleProposal transactionId={transactionId} category={proposeFor} onDone={onDone} />
    );
  }

  const options = [...envelopes.map((e) => e.name), UNCATEGORIZED];

  return (
    // No flex:1 — this renders inside a bottom sheet whose height is driven by
    // its content (maxHeight only). A flex:1 root there has no bounded height to
    // fill and collapses to zero, so the whole picker rendered empty behind the
    // dark backdrop (looked like a hang). Sizing to content fixes that; the list
    // gets an explicit maxHeight so a long one still scrolls.
    <View style={{ backgroundColor: COLORS.background, padding: 16 }}>
      <Text style={{ color: COLORS.textPrimary, fontWeight: "700", fontSize: 18 }}>
        Change category
      </Text>
      <Text style={{ color: COLORS.textMuted, fontSize: 13, marginTop: 4 }} numberOfLines={2}>
        {description}
      </Text>

      {isLoading ? (
        <ActivityIndicator style={{ marginTop: 24 }} color={COLORS.textMuted} />
      ) : (
        <ScrollView style={{ marginTop: 16, maxHeight: Dimensions.get("window").height * 0.5 }}>
          {options.map((name) => {
            const isCurrent = name.toLowerCase() === current.toLowerCase();
            return (
              <Pressable
                key={name}
                onPress={() => choose(name)}
                disabled={recategorize.isPending}
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "center",
                  paddingVertical: 14,
                  borderBottomWidth: 1,
                  borderBottomColor: COLORS.glassBorder,
                  opacity: recategorize.isPending ? 0.5 : 1,
                }}
              >
                <Text
                  style={{
                    color: name === UNCATEGORIZED ? COLORS.textMuted : COLORS.textPrimary,
                    fontSize: 15,
                    fontStyle: name === UNCATEGORIZED ? "italic" : "normal",
                  }}
                >
                  {name}
                </Text>
                {isCurrent && (
                  <Text style={{ color: COLORS.success, fontSize: 14 }}>✓ current</Text>
                )}
              </Pressable>
            );
          })}

          {envelopes.length === 0 && (
            <Text style={{ color: COLORS.textMuted, fontSize: 13, marginTop: 12 }}>
              You have no categories yet. Create some in Categories first.
            </Text>
          )}
        </ScrollView>
      )}

      <Pressable
        onPress={onDone}
        disabled={recategorize.isPending}
        style={{ paddingVertical: 14, alignItems: "center", marginTop: 8 }}
      >
        <Text style={{ color: COLORS.textMuted, fontSize: 15 }}>Cancel</Text>
      </Pressable>
    </View>
  );
}
