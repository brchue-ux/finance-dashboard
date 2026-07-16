import { View, Text, Pressable } from "react-native";
import { COLORS } from "@/constants/theme";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

interface MonthNavProps {
  year: number;
  month: number; // 1-12
  netPosition?: number;
  onPrev: () => void;
  onNext: () => void;
}

export function MonthNav({ year, month, netPosition, onPrev, onNext }: MonthNavProps) {
  const isPositive = (netPosition ?? 0) >= 0;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
      <Pressable onPress={onPrev} hitSlop={12}>
        <Text style={{ color: COLORS.brandPurple, fontSize: 20 }}>{"<"}</Text>
      </Pressable>
      <View style={{ alignItems: "center" }}>
        <Text style={{ color: COLORS.textPrimary, fontSize: 17, fontWeight: "700" }}>
          {MONTH_NAMES[month - 1]} {year}
        </Text>
        {netPosition !== undefined && (
          <Text style={{ color: isPositive ? COLORS.success : COLORS.danger, fontSize: 13 }}>
            {isPositive ? "+" : ""}${netPosition.toFixed(0)}
          </Text>
        )}
      </View>
      <Pressable onPress={onNext} hitSlop={12}>
        <Text style={{ color: COLORS.brandPurple, fontSize: 20 }}>{">"}</Text>
      </Pressable>
    </View>
  );
}
