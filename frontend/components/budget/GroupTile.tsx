/**
 * A parent-group tile on the budget tab — the app-folder square that collapses
 * a group's categories into one high-level summary. Tap to zoom into the group.
 */
import { View, Text, Pressable } from "react-native";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { COLORS } from "@/constants/theme";
import type { GroupSummary } from "@/lib/groups";

function fmt(n: number) {
  return `$${Math.round(Math.abs(n)).toLocaleString()}`;
}

/** Same pace framing as the individual cards, rolled up to the group. */
function groupStatus(g: GroupSummary): { text: string; color: string } {
  const inProgress = g.monthFraction != null && g.monthFraction < 1 && g.allocated > 0;
  if (inProgress) {
    if (g.expectedByNow <= 0) return { text: "On pace", color: COLORS.textMuted };
    const ratio = g.spent / g.expectedByNow;
    if (ratio > 1.1) return { text: "Over pace", color: COLORS.warning };
    if (ratio < 0.9) return { text: "Under pace", color: COLORS.success };
    return { text: "On pace", color: COLORS.textMuted };
  }
  if (g.allocated > 0 && g.spent > g.allocated)
    return { text: `Over by ${fmt(g.spent - g.allocated)}`, color: COLORS.danger };
  return { text: "On budget", color: COLORS.textMuted };
}

interface GroupTileProps {
  group: GroupSummary;
  onPress: () => void;
}

export function GroupTile({ group, onPress }: GroupTileProps) {
  const status = groupStatus(group);
  const progress = group.allocated > 0 ? group.spent / group.allocated : 0;
  const inProgress = group.monthFraction != null && group.monthFraction < 1 && group.allocated > 0;

  return (
    <Pressable
      onPress={onPress}
      style={{
        width: "48%",
        backgroundColor: COLORS.glassBg,
        borderWidth: 1,
        borderColor: COLORS.glassBorder,
        borderRadius: 16,
        padding: 14,
        marginBottom: 12,
      }}
    >
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
        <Text style={{ color: COLORS.textPrimary, fontWeight: "700", fontSize: 15, flex: 1 }} numberOfLines={2}>
          {group.name}
        </Text>
        <Text style={{ color: COLORS.textMuted, fontSize: 18, marginLeft: 4 }}>›</Text>
      </View>

      <Text style={{ color: COLORS.textPrimary, fontSize: 20, fontWeight: "800" }}>{fmt(group.spent)}</Text>
      <Text style={{ color: COLORS.textMuted, fontSize: 12, marginTop: 1, marginBottom: 10 }}>
        {group.allocated > 0 ? `of ${fmt(group.allocated)} budget` : "no budget set"}
      </Text>

      {group.allocated > 0 && (
        <ProgressBar
          progress={progress}
          overBudget={group.spent > group.allocated}
          marker={inProgress ? group.monthFraction ?? undefined : undefined}
        />
      )}

      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 10 }}>
        <Text style={{ color: status.color, fontSize: 12, fontWeight: "600" }} numberOfLines={1}>
          {status.text}
        </Text>
        <Text style={{ color: COLORS.textMuted, fontSize: 11 }}>
          {group.envelopes.length}
          {group.overCount > 0 ? ` · ${group.overCount} over` : ""}
        </Text>
      </View>
    </Pressable>
  );
}
