import { View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { COLORS, GRADIENT } from "@/constants/theme";

interface ProgressBarProps {
  progress: number; // 0–1
  overBudget?: boolean;
  /** 0–1: where spend "should" be by now (6d pace). Drawn as a tick so the bar
   *  reads as ahead/behind pace, not just a raw fill. Omit for no marker. */
  marker?: number;
}

export function ProgressBar({ progress, overBudget = false, marker }: ProgressBarProps) {
  const clamped = Math.min(progress, 1);
  // A marker at 0 or 1 carries no "you're ahead/behind" information (start and
  // end of month), so it is only drawn strictly inside the bar.
  const showMarker = marker != null && marker > 0 && marker < 1;
  return (
    <View
      style={{
        height: 6,
        borderRadius: 3,
        backgroundColor: COLORS.glassBorder,
        overflow: "hidden",
      }}
    >
      <LinearGradient
        colors={overBudget ? GRADIENT.danger : GRADIENT.brand}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={{ width: `${clamped * 100}%`, height: "100%", borderRadius: 3 }}
      />
      {showMarker && (
        <View
          style={{
            position: "absolute",
            left: `${marker * 100}%`,
            top: -1,
            bottom: -1,
            width: 2,
            backgroundColor: COLORS.textPrimary,
            opacity: 0.7,
          }}
        />
      )}
    </View>
  );
}
