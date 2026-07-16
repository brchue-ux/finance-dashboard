import { View, ViewProps } from "react-native";
import { COLORS } from "@/constants/theme";

interface GlassCardProps extends ViewProps {
  children: React.ReactNode;
}

export function GlassCard({ children, style, ...props }: GlassCardProps) {
  return (
    <View
      style={[
        {
          backgroundColor: COLORS.glassBg,
          borderWidth: 1,
          borderColor: COLORS.glassBorder,
          borderRadius: 16,
          padding: 16,
        },
        style,
      ]}
      {...props}
    >
      {children}
    </View>
  );
}
