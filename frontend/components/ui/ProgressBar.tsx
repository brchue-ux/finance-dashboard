import { View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { COLORS, GRADIENT } from "@/constants/theme";

interface ProgressBarProps {
  progress: number; // 0–1
  overBudget?: boolean;
}

export function ProgressBar({ progress, overBudget = false }: ProgressBarProps) {
  const clamped = Math.min(progress, 1);
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
    </View>
  );
}
