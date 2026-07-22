/**
 * Budget tab — main budget view.
 * Spec §9 Budget Screen layout.
 */
import { useState } from "react";
import {
  ScrollView,
  View,
  Text,
  Pressable,
  RefreshControl,
  ActivityIndicator,
  Modal,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { GradientText } from "@/components/ui/GradientText";
import { HeaderIconButton } from "@/components/ui/HeaderIconButton";
import { StatCard } from "@/components/ui/StatCard";
import { MonthNav } from "@/components/budget/MonthNav";
import { EnvelopeCard } from "@/components/budget/EnvelopeCard";
import { GroupTile } from "@/components/budget/GroupTile";
import { PinnedInsight } from "@/components/budget/PinnedInsight";
import { NotableTransactions } from "@/components/budget/NotableTransactions";
import { groupEnvelopes, UNGROUPED } from "@/lib/groups";
import { EnvelopeDetailSheet } from "@/components/budget/EnvelopeDetailSheet";
import { SwipeToDismiss } from "@/components/ui/SwipeToDismiss";
import { ConversationSheet } from "@/components/llm/ConversationSheet";
import { COLORS } from "@/constants/theme";
import { useInsights, topCard } from "@/hooks/useInsights";
import { useBudget, useSyncBudget, type BudgetEnvelope } from "@/hooks/useBudget";

function fmt(n: number) {
  return `$${Math.abs(n).toFixed(0)}`;
}

export default function BudgetScreen() {
  const router = useRouter();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [chatOpen, setChatOpen] = useState(false);

  const { data, isLoading, refetch } = useBudget(year, month);
  const syncMutation = useSyncBudget();
  // Claude cards, shared with the full Insights screen (same resolved-state).
  const insights = useInsights("budget", year, month);

  // The envelope trending-vs-typical detail (6d). Independent of the txn sheet —
  // the two are never open at once, so they don't overlap.
  const [envelopeDetail, setEnvelopeDetail] = useState<BudgetEnvelope | null>(null);
  // Which group tile is zoomed into; null = the top-level grid of tiles. Kept as
  // a name (not an index) so it survives a data refresh reordering the groups.
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  // Notable transactions is collapsed to a single row by default — it was a big
  // part of the scroll. Expanded on demand.
  const [notableExpanded, setNotableExpanded] = useState(false);
  // Swiped-away (session-scoped) so the group tiles come up into full frame. The
  // 💡 header icon still reaches the Insights screen after the pin is dismissed.
  const [pinnedDismissed, setPinnedDismissed] = useState(false);
  const [unattributedDismissed, setUnattributedDismissed] = useState(false);

  function prevMonth() {
    if (month === 1) { setYear(y => y - 1); setMonth(12); }
    else setMonth(m => m - 1);
  }
  function nextMonth() {
    if (month === 12) { setYear(y => y + 1); setMonth(1); }
    else setMonth(m => m + 1);
  }

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

  const summary = data?.summary;

  // Parent-group tiles, and the categories inside the one that's zoomed in.
  const groups = data ? groupEnvelopes(data.envelopes) : [];
  const openGroupEnvelopes =
    openGroup !== null
      ? (data?.envelopes ?? []).filter((e) => (e.groupName || UNGROUPED) === openGroup)
      : [];
  const notableCount = (data?.notableTransactions ?? []).reduce(
    (n, c) => n + c.transactions.length,
    0
  );
  // The single card pinned at the top; the rest live behind "N more" → Insights.
  const pinned = topCard(insights.visibleCards);

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
          <GradientText style={{ fontSize: 28, fontWeight: "800" }}>Budget</GradientText>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            {/* Importing a statement is a routine, recurring action, not a
                one-time setup chore — it stays one tap from the budget rather
                than buried in Settings or behind the bank-connect flow. */}
            <HeaderIconButton
              glyph="↥"
              onPress={() => router.push("/import")}
              accessibilityLabel="Import a CSV or Excel file"
            />
            <HeaderIconButton
              glyph="▦"
              onPress={() => router.push("/manage-envelopes")}
              accessibilityLabel="Manage categories"
            />
            {/* Always-available entry to Insights — the way back after the pinned
                card is swiped away. Badged with the open-card count. */}
            <HeaderIconButton
              glyph="✦"
              onPress={() => router.push({ pathname: "/insights", params: { year, month } })}
              badge={insights.visibleCards.length}
              accessibilityLabel="Insights"
            />
            <HeaderIconButton
              glyph="∿"
              onPress={() => router.push("/reports")}
              accessibilityLabel="Reports"
            />
          </View>
        </View>

        {/* Month navigation */}
        <MonthNav
          year={year}
          month={month}
          netPosition={summary?.saved}
          onPrev={prevMonth}
          onNext={nextMonth}
        />

        {/* Summary strip */}
        {summary && (
          <View style={{ flexDirection: "row", gap: 8, marginBottom: 20 }}>
            {/* Total outflow, not envelope-attributed spend. Showing only what
                reached an envelope made "Spent" shrink as categorization
                coverage got worse — the opposite of the truth. The uncounted
                remainder is called out below rather than quietly dropped. */}
            <StatCard label="Spent" value={fmt(summary.totalOutflow)} />
            {/* With nothing budgeted, "Remaining" would just be -Spent, which
                reads as overspend against a limit that was never set. */}
            <StatCard
              label="Remaining"
              value={summary.configuredEnvelopes === 0 ? "—" : fmt(summary.remaining)}
              valueColor={
                summary.configuredEnvelopes === 0
                  ? COLORS.textMuted
                  : summary.remaining < 0
                    ? COLORS.danger
                    : COLORS.success
              }
            />
            <StatCard
              label="Saved"
              value={fmt(summary.saved)}
              valueColor={summary.saved >= 0 ? COLORS.success : COLORS.danger}
            />
          </View>
        )}

        {/* Spend that reached no envelope. Without this the money simply is not
            on screen anywhere: it is absent from every envelope card, and the
            envelope grid below is the only place spending is itemised. It still
            reduces Saved, so leaving it unexplained makes the numbers look
            wrong rather than incomplete. Tapping goes where it gets fixed. */}
        {summary && summary.unattributedSpent > 0 && !unattributedDismissed && (
          <SwipeToDismiss onDismiss={() => setUnattributedDismissed(true)}>
            <Pressable
              onPress={() => router.push("/manage-envelopes")}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
                padding: 12,
                paddingRight: 34,
                marginBottom: 20,
                borderRadius: 10,
                backgroundColor: "rgba(245,158,11,0.08)",
                borderWidth: 1,
                borderColor: "rgba(245,158,11,0.25)",
              }}
            >
              <Text style={{ fontSize: 16 }}>📥</Text>
              <View style={{ flex: 1 }}>
                <Text style={{ color: COLORS.warning, fontWeight: "600", fontSize: 13 }}>
                  {fmt(summary.unattributedSpent)} not in any category
                </Text>
                <Text style={{ color: COLORS.textMuted, fontSize: 11, marginTop: 2 }}>
                  {Math.round((summary.unattributedSpent / summary.totalOutflow) * 100)}% of this
                  month's spending — counted in your total, but in no category below.
                </Text>
              </View>
            </Pressable>
          </SwipeToDismiss>
        )}

        {/* No envelopes at all: budget math and categorization can't work yet. */}
        {data && data.envelopes.length === 0 && (
          <Pressable onPress={() => router.push("/manage-envelopes")}>
            <View style={{ padding: 16, borderRadius: 16, borderWidth: 1, borderColor: COLORS.glassBorder, backgroundColor: COLORS.glassBg }}>
              <Text style={{ color: COLORS.textPrimary, fontWeight: "600", fontSize: 15 }}>
                Set up your categories
              </Text>
              <Text style={{ color: COLORS.textMuted, fontSize: 13, marginTop: 6 }}>
                Transactions stay uncategorized until at least one category exists.
              </Text>
            </View>
          </Pressable>
        )}

        {/* ── Zoomed into one group: its categories only ─────────────────── */}
        {data && data.envelopes.length > 0 && openGroup !== null && (
          <>
            <Pressable
              onPress={() => setOpenGroup(null)}
              hitSlop={8}
              style={{ flexDirection: "row", alignItems: "center", marginBottom: 12 }}
            >
              <Text style={{ color: COLORS.brandPurple, fontSize: 22, marginRight: 4 }}>‹</Text>
              <Text style={{ color: COLORS.textPrimary, fontSize: 18, fontWeight: "800" }}>
                {openGroup}
              </Text>
            </Pressable>
            {openGroupEnvelopes.map((env) => (
              <EnvelopeCard
                key={env.id}
                envelope={env}
                onSetTarget={() => router.push("/manage-envelopes")}
                onPress={() => setEnvelopeDetail(env)}
              />
            ))}
          </>
        )}

        {/* ── Top level: pinned insight + group tiles + collapsed extras ──── */}
        {data && data.envelopes.length > 0 && openGroup === null && (
          <>
            {/* Pinned Claude card — the most important one, actionable right here;
                the rest are one tap away on the Insights screen. Swipe (or ✕) to
                clear it so the tiles rise to full frame; the 💡 header icon brings
                Insights back. */}
            {pinned && !pinnedDismissed && (
              <SwipeToDismiss onDismiss={() => setPinnedDismissed(true)}>
                <PinnedInsight
                  card={pinned}
                  moreCount={insights.visibleCards.length - 1}
                  busy={insights.busyTitle === pinned.title}
                  error={insights.cardErrors[pinned.title]}
                  flash={insights.flash}
                  onApprove={() => insights.onApprove(pinned)}
                  onDismiss={() => insights.onDismiss(pinned)}
                  onOpenAll={() =>
                    router.push({ pathname: "/insights", params: { year, month } })
                  }
                />
              </SwipeToDismiss>
            )}

            {/* Group tiles — two per row, tap to zoom in */}
            <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between" }}>
              {groups.map((g) => (
                <GroupTile key={g.name} group={g} onPress={() => setOpenGroup(g.name)} />
              ))}
            </View>

            {/* Notable transactions collapsed to one row — it was a big chunk of
                the scroll; expand on demand. */}
            {notableCount > 0 && (
              <View style={{ marginTop: 8, marginBottom: 12 }}>
                <Pressable
                  onPress={() => setNotableExpanded((v) => !v)}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                    paddingVertical: 12,
                    paddingHorizontal: 14,
                    borderRadius: 12,
                    borderWidth: 1,
                    borderColor: COLORS.glassBorder,
                    backgroundColor: COLORS.glassBg,
                  }}
                >
                  <Text style={{ color: COLORS.textPrimary, fontWeight: "600", fontSize: 14 }}>
                    ⚡ Notable this month ({notableCount})
                  </Text>
                  <Text style={{ color: COLORS.textMuted, fontSize: 15 }}>
                    {notableExpanded ? "Hide" : "Show"}
                  </Text>
                </Pressable>
                {notableExpanded && (
                  <View style={{ marginTop: 10 }}>
                    <NotableTransactions
                      categories={data?.notableTransactions ?? []}
                      hideHeading
                    />
                  </View>
                )}
              </View>
            )}

            {/* Transactions moved off the tab — one button, not an endless
                inline feed that buried everything above it. */}
            <Pressable
              onPress={() =>
                router.push({ pathname: "/transactions", params: { year, month } })
              }
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                paddingVertical: 14,
                paddingHorizontal: 16,
                borderRadius: 14,
                borderWidth: 1,
                borderColor: COLORS.glassBorder,
                backgroundColor: COLORS.glassBg,
                marginTop: 4,
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <Text style={{ fontSize: 18 }}>🧾</Text>
                <Text style={{ color: COLORS.textPrimary, fontWeight: "600", fontSize: 15 }}>
                  All transactions
                </Text>
              </View>
              <Text style={{ color: COLORS.textMuted, fontSize: 20 }}>›</Text>
            </Pressable>
          </>
        )}
      </ScrollView>

      {/* Envelope trending-vs-typical detail (6d) — its own Modal, only ever
          open when a card is tapped, never at the same time as the txn sheet. */}
      <Modal
        visible={envelopeDetail !== null}
        animationType="slide"
        transparent
        onRequestClose={() => setEnvelopeDetail(null)}
      >
        <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.6)" }}>
          <View
            style={{
              backgroundColor: COLORS.background,
              borderTopLeftRadius: 20,
              borderTopRightRadius: 20,
              maxHeight: "80%",
            }}
          >
            {envelopeDetail && (
              <EnvelopeDetailSheet
                envelope={envelopeDetail}
                onClose={() => setEnvelopeDetail(null)}
              />
            )}
          </View>
        </View>
      </Modal>

      <ConversationSheet
        visible={chatOpen}
        onClose={() => setChatOpen(false)}
        view="budget"
        initialCards={insights.llmQuery.data?.cards}
      />
    </SafeAreaView>
  );
}
