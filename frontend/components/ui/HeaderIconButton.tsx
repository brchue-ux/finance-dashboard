/**
 * Header action button — the app's one way to put an icon in a screen header.
 *
 * Replaces raw colored emoji (⬆️🗂️💡📊), which fought the muted glass theme:
 * four full-color pictograms in a row read as noise, not as controls. Here the
 * glyph is monochrome secondary-text inside a small glass circle, so actions
 * share one visual weight and color stays reserved for meaning (the badge).
 */
import { View, Text, Pressable } from "react-native";
import { COLORS } from "@/constants/theme";

export function HeaderIconButton({
  glyph,
  onPress,
  badge,
  accessibilityLabel,
}: {
  /** A monochrome text glyph ("↥", "▦", "✦", "∿") — not an emoji. */
  glyph: string;
  onPress: () => void;
  /** Small count badge; hidden when 0/undefined. */
  badge?: number;
  accessibilityLabel?: string;
}) {
  return (
    <Pressable onPress={onPress} hitSlop={8} accessibilityLabel={accessibilityLabel}>
      <View
        style={{
          width: 34,
          height: 34,
          borderRadius: 17,
          backgroundColor: COLORS.glassBg,
          borderWidth: 1,
          borderColor: COLORS.glassBorder,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Text style={{ color: COLORS.textSecondary, fontSize: 15 }}>{glyph}</Text>
      </View>
      {badge != null && badge > 0 && (
        <View
          style={{
            position: "absolute",
            top: -3,
            right: -4,
            minWidth: 15,
            height: 15,
            borderRadius: 8,
            paddingHorizontal: 3,
            backgroundColor: COLORS.brandPurple,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text style={{ color: "#fff", fontSize: 9, fontWeight: "700" }}>{badge}</Text>
        </View>
      )}
    </Pressable>
  );
}
