import { View, Text, Pressable } from "react-native";
import { COLORS } from "@/constants/theme";
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
  /** Fires with the highlighted row's y offset so the caller can scroll to it.
   *  Without this the row is tinted but left off-screen, which reads as a
   *  generic list rather than "here is your transaction". */
  onHighlightLayout?: (y: number) => void;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

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

export function TransactionFeed({
  transactions,
  highlightId,
  onPressTransaction,
  limit = 30,
  onHighlightLayout,
}: TransactionFeedProps) {
  const rows = transactions.slice(0, limit);
  // Rows arrive newest-first; a header is drawn whenever the date changes, so
  // the date lives once per day rather than on every row — the repetition was
  // most of what made the feed read as a wall of text.
  let lastDate: string | null = null;

  return (
    <View>
      <Text style={{ color: COLORS.textPrimary, fontWeight: "700", fontSize: 16, marginBottom: 4 }}>
        Transactions
      </Text>
      {rows.map((txn) => {
        const showHeader = txn.date !== lastDate;
        lastDate = txn.date;
        const isHighlight = txn.id === highlightId;
        return (
          <View
            key={txn.id}
            onLayout={
              isHighlight && onHighlightLayout
                ? (e) => onHighlightLayout(e.nativeEvent.layout.y)
                : undefined
            }
          >
            {showHeader && (
              <Text
                style={{
                  color: COLORS.textMuted,
                  fontSize: 11,
                  fontWeight: "700",
                  letterSpacing: 0.5,
                  textTransform: "uppercase",
                  marginTop: 18,
                  marginBottom: 4,
                }}
              >
                {formatDateHeader(txn.date)}
              </Text>
            )}
            <Pressable
              onPress={onPressTransaction ? () => onPressTransaction(txn) : undefined}
              disabled={!onPressTransaction}
              style={{
                flexDirection: "row",
                alignItems: "center",
                paddingVertical: 12,
                borderBottomWidth: 1,
                borderBottomColor: COLORS.glassBorder,
                ...(isHighlight
                  ? {
                      backgroundColor: COLORS.insightBg,
                      borderLeftWidth: 2,
                      borderLeftColor: COLORS.warning,
                      paddingLeft: 8,
                      marginHorizontal: -8,
                      paddingRight: 8,
                    }
                  : null),
              }}
            >
              <View style={{ flex: 1, paddingRight: 8 }}>
                <Text style={{ color: COLORS.textPrimary, fontSize: 15, fontWeight: "500" }} numberOfLines={1}>
                  {txn.merchantName ?? txn.description}
                </Text>
                <Text style={{ color: COLORS.textMuted, fontSize: 12, marginTop: 2 }} numberOfLines={1}>
                  {txn.splitCategories && txn.splitCategories.length > 0 ? (
                    <>
                      <Text style={{ color: COLORS.brandPurple, fontWeight: "600" }}>Split</Text>
                      {" · " + txn.splitCategories.join(", ")}
                    </>
                  ) : (
                    (txn.category ?? "Uncategorized")
                  )}
                  {/* A refund is money back, not income — and when it reconciled
                      a PAST month's budget, say which one, or the row's absence
                      from this month's math reads as a bug. */}
                  {txn.refundEffectiveMonth ? (
                    <Text style={{ color: COLORS.success, fontWeight: "600" }}>
                      {" · Refund"}
                      {txn.refundEffectiveMonth !== txn.date.slice(0, 7)
                        ? ` → ${formatRefundMonth(txn.refundEffectiveMonth)}`
                        : ""}
                    </Text>
                  ) : null}
                  {txn.pending ? " · Pending" : ""}
                </Text>
              </View>
              <Text
                style={{
                  color: txn.amount < 0 ? COLORS.danger : COLORS.success,
                  fontWeight: "600",
                  fontSize: 15,
                }}
              >
                {fmt(txn.amount)}
              </Text>
              {/* The chevron signals the row is tappable — without an affordance
                  the action sheet is as hidden as the old nested chip was. */}
              {onPressTransaction && (
                <Text style={{ color: COLORS.textMuted, fontSize: 18, marginLeft: 6 }}>›</Text>
              )}
            </Pressable>
          </View>
        );
      })}
      {rows.length > 0 && onPressTransaction && (
        <Text style={{ color: COLORS.textMuted, fontSize: 12, marginTop: 12 }}>
          Tap a transaction to change its category or split it.
        </Text>
      )}
    </View>
  );
}
