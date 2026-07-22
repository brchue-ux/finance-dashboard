/**
 * Notable transactions — spec §9 Budget item 5 / remediation Ticket 011 §3.
 * Deterministic (non-LLM) surfacing of single transactions that consume an
 * outsized share of their own envelope. One card per category, each swipeable
 * between that category's own notable transactions (backend caps at 3).
 * Tapping a transaction opens its account's history highlighted to that row.
 */
import { useState } from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  type LayoutChangeEvent,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
} from "react-native";
import { useRouter } from "expo-router";
import { GlassCard } from "@/components/ui/GlassCard";
import { COLORS } from "@/constants/theme";
import type { NotableCategory, NotableTransaction } from "@/hooks/useBudget";

function fmt(n: number) {
  return `$${Math.abs(n).toFixed(2)}`;
}

interface NotableTransactionsProps {
  categories: NotableCategory[];
  /** Suppress the internal heading when a caller (the collapsed row) supplies
   *  its own — avoids a duplicate "Notable transactions" title. */
  hideHeading?: boolean;
}

export function NotableTransactions({ categories, hideHeading }: NotableTransactionsProps) {
  if (categories.length === 0) return null;

  return (
    <View style={{ marginBottom: 20 }}>
      {!hideHeading && (
        <Text
          style={{
            color: COLORS.textPrimary,
            fontWeight: "700",
            fontSize: 16,
            marginBottom: 12,
          }}
        >
          Notable transactions
        </Text>
      )}
      {categories.map((cat) => (
        <NotableCategoryCard key={cat.category} category={cat} />
      ))}
    </View>
  );
}

function NotableCategoryCard({ category }: { category: NotableCategory }) {
  const router = useRouter();
  const [page, setPage] = useState(0);
  // Measured rather than taken from Dimensions so paging stays correct on web
  // and after rotation, where the window width isn't the card's width.
  const [pageWidth, setPageWidth] = useState(0);

  const count = category.transactions.length;

  function onLayout(e: LayoutChangeEvent) {
    setPageWidth(e.nativeEvent.layout.width);
  }

  function onScrollEnd(e: NativeSyntheticEvent<NativeScrollEvent>) {
    if (pageWidth <= 0) return;
    setPage(Math.round(e.nativeEvent.contentOffset.x / pageWidth));
  }

  function openTransaction(txn: NotableTransaction) {
    router.push(`/account/${txn.accountId}?highlight=${txn.id}`);
  }

  return (
    <GlassCard style={{ marginBottom: 10 }}>
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 10,
        }}
      >
        <Text style={{ color: COLORS.textPrimary, fontWeight: "600", fontSize: 15 }}>
          {category.category}
        </Text>
        {count > 1 && (
          <Text style={{ color: COLORS.textMuted, fontSize: 12 }}>
            {page + 1} of {count}
          </Text>
        )}
      </View>

      <View onLayout={onLayout}>
        {/* Paging is only meaningful once the width is known; until then the
            first transaction still renders, so the card is never blank. */}
        <ScrollView
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          scrollEnabled={count > 1 && pageWidth > 0}
          onMomentumScrollEnd={onScrollEnd}
        >
          {category.transactions.map((txn) => (
            <Pressable
              key={txn.id}
              onPress={() => openTransaction(txn)}
              style={{ width: pageWidth > 0 ? pageWidth : undefined }}
            >
              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <View style={{ flex: 1, marginRight: 8 }}>
                  <Text
                    style={{ color: COLORS.textPrimary, fontSize: 14 }}
                    numberOfLines={1}
                  >
                    {txn.merchantName ?? txn.description}
                  </Text>
                  <Text style={{ color: COLORS.textMuted, fontSize: 12, marginTop: 2 }}>
                    {txn.date}
                  </Text>
                </View>
                <Text
                  style={{ color: COLORS.danger, fontWeight: "600", fontSize: 14 }}
                >
                  {fmt(txn.amount)}
                </Text>
              </View>
              <Text style={{ color: COLORS.warning, fontSize: 12, marginTop: 6 }}>
                {Math.round(txn.shareOfAllocation * 100)}% of {category.category}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      {count > 1 && (
        <View
          style={{
            flexDirection: "row",
            justifyContent: "center",
            gap: 6,
            marginTop: 10,
          }}
        >
          {category.transactions.map((txn, i) => (
            <View
              key={txn.id}
              style={{
                width: 6,
                height: 6,
                borderRadius: 3,
                backgroundColor:
                  i === page ? COLORS.brandPurple : COLORS.glassBorder,
              }}
            />
          ))}
        </View>
      )}
    </GlassCard>
  );
}
