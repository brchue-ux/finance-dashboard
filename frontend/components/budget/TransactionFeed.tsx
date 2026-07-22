/**
 * The transaction feed — the app's reusable pattern for any dense list of
 * money events (account history, monthly transactions, future search results).
 *
 * Shape: each DAY is an inset rounded card under a small header carrying the
 * date and the day's net — so the unit of scanning is the day, not the row,
 * and the space between cards is what kills the text-wall effect. The feed
 * groups and orders by date itself rather than trusting arrival order; an
 * unsorted endpoint once scrambled the chronology because headers were drawn
 * on date CHANGE, and a renderer this reusable must not have that dependency.
 *
 * Color implies, it doesn't shout: outflows are the default state of this
 * list, so they wear the quiet secondary text color; only money-in gets a hue
 * (mint), and each category contributes a small muted identity dot. Heavy days
 * stay inside the same card umbrella — beyond a threshold the tail collapses
 * behind a "Show N more" row, so one Costco-run-and-twelve-subscriptions day
 * can't dominate the scroll.
 */
import { useState } from "react";
import { View, Text, Pressable } from "react-native";
import { COLORS, categoryColor } from "@/constants/theme";
import type { Transaction } from "@/hooks/useBudget";

interface TransactionFeedProps {
  transactions: Transaction[];
  /** Transaction id to visually mark — set when arriving from a notable card. */
  highlightId?: string;
  /**
   * When provided, tapping a row opens its action sheet (change category /
   * split). One tap, one target — this replaced a nested category chip that
   * competed with a tap-to-split row and was effectively undiscoverable.
   */
  onPressTransaction?: (txn: Transaction) => void;
  /** Max rows to render. Must not be smaller than the caller's fetch limit,
   *  or a highlighted row can be fetched but never drawn. */
  limit?: number;
  /** Fires with the highlighted row's day-section y offset so the caller can
   *  scroll to it. Without this the row is tinted but left off-screen, which
   *  reads as a generic list rather than "here is your transaction". */
  onHighlightLayout?: (y: number) => void;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Days longer than this collapse their tail behind "Show N more". */
const DAY_COLLAPSE_THRESHOLD = 6;
const DAY_COLLAPSED_ROWS = 5;

/** "2026-07-12" -> "Fri, Jul 12". Built from the parts, not `new Date(iso)`,
 *  which parses a bare date as UTC and can shift it a day in local time. */
function formatDateHeader(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const dow = DAYS[new Date(y, m - 1, d).getDay()];
  return `${dow}, ${MONTHS[m - 1]} ${d}`;
}

function fmt(amount: number) {
  const abs = Math.abs(amount);
  return amount < 0 ? `-$${abs.toFixed(2)}` : `+$${abs.toFixed(2)}`;
}

/** "2026-06" -> "Jun" — where a refund's money actually counted. */
function formatRefundMonth(yyyyMm: string): string {
  const m = Number(yyyyMm.slice(5, 7));
  return MONTHS[m - 1] ?? yyyyMm;
}

interface DaySection {
  date: string;
  rows: Transaction[];
  net: number;
}

/** Group into day sections, newest day first. Row order within a day is kept
 *  as given (the endpoints order within-day by recency). */
function groupByDay(rows: Transaction[]): DaySection[] {
  const byDate = new Map<string, Transaction[]>();
  for (const t of rows) {
    const list = byDate.get(t.date);
    if (list) list.push(t);
    else byDate.set(t.date, [t]);
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => (a > b ? -1 : 1))
    .map(([date, dayRows]) => ({
      date,
      rows: dayRows,
      net: dayRows.reduce((s, t) => s + t.amount, 0),
    }));
}

export function TransactionFeed({
  transactions,
  highlightId,
  onPressTransaction,
  limit = 30,
  onHighlightLayout,
}: TransactionFeedProps) {
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set());
  const sections = groupByDay(transactions.slice(0, limit));

  return (
    <View>
      <Text style={{ color: COLORS.textPrimary, fontWeight: "700", fontSize: 16, marginBottom: 2 }}>
        Transactions
      </Text>
      {sections.map((day) => {
        const holdsHighlight =
          highlightId != null && day.rows.some((t) => t.id === highlightId);
        // A highlighted row hidden behind the collapse would make the jump
        // land on a day that visibly doesn't contain it — auto-expand.
        const expanded = expandedDays.has(day.date) || holdsHighlight;
        const collapsed = !expanded && day.rows.length > DAY_COLLAPSE_THRESHOLD;
        const visibleRows = collapsed ? day.rows.slice(0, DAY_COLLAPSED_ROWS) : day.rows;

        return (
          <View
            key={day.date}
            onLayout={
              holdsHighlight && onHighlightLayout
                ? (e) => onHighlightLayout(e.nativeEvent.layout.y)
                : undefined
            }
            style={{ marginTop: 16 }}
          >
            {/* Day header: the date anchors the eye; the net gives each day a
                one-glance verdict without opening a single row. */}
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "baseline",
                paddingHorizontal: 4,
                marginBottom: 6,
              }}
            >
              <Text
                style={{
                  color: COLORS.textMuted,
                  fontSize: 11,
                  fontWeight: "700",
                  letterSpacing: 0.5,
                  textTransform: "uppercase",
                }}
              >
                {formatDateHeader(day.date)}
              </Text>
              <Text
                style={{
                  color: day.net >= 0 ? COLORS.moneyIn : COLORS.textMuted,
                  fontSize: 12,
                  fontWeight: "600",
                }}
              >
                {fmt(day.net)}
              </Text>
            </View>

            <View
              style={{
                backgroundColor: COLORS.glassBg,
                borderWidth: 1,
                borderColor: COLORS.glassBorder,
                borderRadius: 14,
                overflow: "hidden",
              }}
            >
              {visibleRows.map((txn, i) => (
                <TransactionRow
                  key={txn.id}
                  txn={txn}
                  first={i === 0}
                  highlighted={txn.id === highlightId}
                  onPress={onPressTransaction}
                />
              ))}
              {collapsed && (
                <Pressable
                  onPress={() =>
                    setExpandedDays((prev) => new Set(prev).add(day.date))
                  }
                  style={{
                    paddingVertical: 11,
                    alignItems: "center",
                    borderTopWidth: 1,
                    borderTopColor: COLORS.glassBorder,
                  }}
                >
                  <Text style={{ color: COLORS.brandPurple, fontSize: 13, fontWeight: "600" }}>
                    Show {day.rows.length - DAY_COLLAPSED_ROWS} more
                  </Text>
                </Pressable>
              )}
            </View>
          </View>
        );
      })}
      {sections.length > 0 && onPressTransaction && (
        <Text style={{ color: COLORS.textMuted, fontSize: 12, marginTop: 14 }}>
          Tap a transaction to change its category or split it.
        </Text>
      )}
    </View>
  );
}

function TransactionRow({
  txn,
  first,
  highlighted,
  onPress,
}: {
  txn: Transaction;
  first: boolean;
  highlighted: boolean;
  onPress?: (txn: Transaction) => void;
}) {
  const inflow = txn.amount >= 0;
  return (
    <Pressable
      onPress={onPress ? () => onPress(txn) : undefined}
      disabled={!onPress}
      style={{
        flexDirection: "row",
        alignItems: "center",
        paddingVertical: 12,
        paddingHorizontal: 14,
        // Hairline between rows, inset by the card's own padding — the card
        // edge does the outer framing, so full-bleed rules would double up.
        borderTopWidth: first ? 0 : 1,
        borderTopColor: COLORS.glassBorder,
        ...(highlighted
          ? { backgroundColor: COLORS.insightBg, borderLeftWidth: 2, borderLeftColor: COLORS.warning }
          : null),
      }}
    >
      <View style={{ flex: 1, paddingRight: 10 }}>
        <Text style={{ color: COLORS.textPrimary, fontSize: 15, fontWeight: "500" }} numberOfLines={1}>
          {txn.merchantName ?? txn.description}
        </Text>
        <View style={{ flexDirection: "row", alignItems: "center", marginTop: 3 }}>
          {/* One muted dot of category identity — rhythm, not rainbow. */}
          <View
            style={{
              width: 6,
              height: 6,
              borderRadius: 3,
              marginRight: 6,
              backgroundColor:
                txn.splitCategories && txn.splitCategories.length > 0
                  ? COLORS.brandPurple
                  : txn.category
                    ? categoryColor(txn.category)
                    : COLORS.glassBorder,
            }}
          />
          <Text style={{ color: COLORS.textMuted, fontSize: 12 }} numberOfLines={1}>
            {txn.splitCategories && txn.splitCategories.length > 0 ? (
              <>
                <Text style={{ color: COLORS.brandPurple, fontWeight: "600" }}>Split</Text>
                {" · " + txn.splitCategories.join(", ")}
              </>
            ) : (
              (txn.category ?? "Uncategorized")
            )}
            {/* A refund is money back, not income — and when it reconciled a
                PAST month's budget, say which one, or the row's absence from
                this month's math reads as a bug. */}
            {txn.refundEffectiveMonth ? (
              <Text style={{ color: COLORS.moneyIn, fontWeight: "600" }}>
                {" · Refund"}
                {txn.refundEffectiveMonth !== txn.date.slice(0, 7)
                  ? ` → ${formatRefundMonth(txn.refundEffectiveMonth)}`
                  : ""}
              </Text>
            ) : null}
            {txn.pending ? " · Pending" : ""}
          </Text>
        </View>
      </View>
      {/* Spending is the list's default state, not an alarm: outflows stay
          quiet; only money-in gets color. */}
      <Text
        style={{
          color: inflow ? COLORS.moneyIn : COLORS.textSecondary,
          fontWeight: "600",
          fontSize: 15,
          fontVariant: ["tabular-nums"],
        }}
      >
        {fmt(txn.amount)}
      </Text>
      {onPress && (
        <Text style={{ color: COLORS.textMuted, fontSize: 18, marginLeft: 8 }}>›</Text>
      )}
    </Pressable>
  );
}
