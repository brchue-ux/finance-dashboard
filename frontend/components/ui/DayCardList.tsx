/**
 * The app's dense-list pattern (born in TransactionFeed), generic: each DAY is
 * an inset rounded card under a small date header, rows divided by hairlines,
 * the space between cards doing the anti-text-wall work. Items are grouped and
 * ordered by day HERE — a renderer this reusable must not depend on arrival
 * order (the budget feed once scrambled purely because an endpoint forgot its
 * ORDER BY).
 */
import { ReactNode } from "react";
import { View, Text } from "react-native";
import { COLORS } from "@/constants/theme";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "2026-07-12" -> "Fri, Jul 12" — built from parts; `new Date(iso)` parses a
 *  bare date as UTC and can shift it a day in local time. */
function formatDateHeader(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${DAYS[new Date(y, m - 1, d).getDay()]}, ${MONTHS[m - 1]} ${d}`;
}

export function DayCardList<T>({
  items,
  dateOf,
  keyOf,
  renderItem,
}: {
  items: T[];
  /** "YYYY-MM-DD" for grouping. */
  dateOf: (item: T) => string;
  keyOf: (item: T) => string;
  /** Renders one row; hairline separators are drawn by the list. */
  renderItem: (item: T) => ReactNode;
}) {
  const byDate = new Map<string, T[]>();
  for (const item of items) {
    const d = dateOf(item);
    const list = byDate.get(d);
    if (list) list.push(item);
    else byDate.set(d, [item]);
  }
  const sections = [...byDate.entries()].sort(([a], [b]) => (a > b ? -1 : 1));

  return (
    <View>
      {sections.map(([date, dayItems]) => (
        <View key={date} style={{ marginBottom: 14 }}>
          <Text
            style={{
              color: COLORS.textMuted,
              fontSize: 11,
              fontWeight: "700",
              letterSpacing: 0.5,
              textTransform: "uppercase",
              paddingHorizontal: 4,
              marginBottom: 6,
            }}
          >
            {formatDateHeader(date)}
          </Text>
          <View
            style={{
              backgroundColor: COLORS.glassBg,
              borderWidth: 1,
              borderColor: COLORS.glassBorder,
              borderRadius: 14,
              overflow: "hidden",
            }}
          >
            {dayItems.map((item, i) => (
              <View
                key={keyOf(item)}
                style={{ borderTopWidth: i === 0 ? 0 : 1, borderTopColor: COLORS.glassBorder }}
              >
                {renderItem(item)}
              </View>
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}
