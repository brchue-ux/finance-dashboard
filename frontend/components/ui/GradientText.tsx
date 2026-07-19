import type { ComponentType, ReactElement, PropsWithChildren } from "react";
import { Text, TextProps } from "react-native";
import MaskedViewRaw from "@react-native-masked-view/masked-view";
import { LinearGradient } from "expo-linear-gradient";
import { GRADIENT } from "@/constants/theme";

// masked-view@0.3.2 (the version SDK 53 pins) still ships React-18-era class
// component types that React 19's stricter JSX.ElementType rejects. The native
// module is React-19-compatible (Expo bundles it with SDK 53); only the type
// stub is stale, so we retype it to the prop surface this component uses.
const MaskedView = MaskedViewRaw as unknown as ComponentType<
  PropsWithChildren<{ maskElement: ReactElement }>
>;

interface GradientTextProps extends TextProps {
  children: string;
}

export function GradientText({ children, style, ...props }: GradientTextProps) {
  return (
    <MaskedView maskElement={<Text style={style} {...props}>{children}</Text>}>
      <LinearGradient
        colors={GRADIENT.brand}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
      >
        <Text style={[style, { opacity: 0 }]} {...props}>{children}</Text>
      </LinearGradient>
    </MaskedView>
  );
}
