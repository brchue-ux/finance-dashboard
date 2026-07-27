/**
 * Gradient-filled heading text. `GradientText.web.tsx` replaces this file on the
 * web platform — masked-view has no real web implementation (its `.web.js`
 * renders the mask element and discards the children), so the gradient there is
 * done with `background-clip: text` instead.
 */
import type { ComponentType, ReactElement, PropsWithChildren } from "react";
import { Text, TextProps } from "react-native";
import MaskedViewRaw from "@react-native-masked-view/masked-view";
import { LinearGradient } from "expo-linear-gradient";
import { COLORS, GRADIENT } from "@/constants/theme";

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
    <MaskedView
      // The mask needs a colour of its own. Masking only reads its alpha, so
      // this is invisible where masking works — and the difference between a
      // legible heading and black-on-#13111C anywhere it silently doesn't.
      // Caller styles come after, so an explicit colour still wins.
      maskElement={<Text style={[{ color: COLORS.textPrimary }, style]} {...props}>{children}</Text>}
    >
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
