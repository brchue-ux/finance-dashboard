/**
 * Web-direct GradientText. Metro resolves this file for the web platform in
 * place of GradientText.tsx — the same platform split ChartView uses.
 *
 * Why a split at all: `@react-native-masked-view` ships no real web
 * implementation. Its `MaskedView.web.js` is
 * `React.createElement(View, props, maskElement)` — the children (the gradient)
 * are DISCARDED and only the mask element survives. The mask carries no colour
 * of its own, so every screen title on web fell back to black on the #13111C
 * background: measured `color: rgb(0, 0, 0)` across 15+ screens.
 *
 * The web platform can do this natively without masked-view: paint the gradient
 * as the element's background and clip it to the glyphs.
 */
import { Text, TextProps, type TextStyle } from "react-native";
import { GRADIENT } from "@/constants/theme";

// react-native-web forwards unrecognised style keys through to CSS, which is
// how a web-only file reaches background-clip. RN's TextStyle has no types for
// these, so the CSS block is declared on its own and cast at the boundary.
const GRADIENT_FILL = {
  // 90deg matches the native start={{ x: 0, y: 0 }} → end={{ x: 1, y: 0 }}.
  // The element stays full-width like the native MaskedView, so the gradient
  // spans the same box on both platforms rather than only the glyphs.
  backgroundImage: `linear-gradient(90deg, ${GRADIENT.brand.join(", ")})`,
  backgroundClip: "text",
  WebkitBackgroundClip: "text",
  // Safari needs -webkit-text-fill-color too; `color` alone still paints the
  // glyphs opaquely over the clipped background there.
  color: "transparent",
  WebkitTextFillColor: "transparent",
} as unknown as TextStyle;

interface GradientTextProps extends TextProps {
  children: string;
}

export function GradientText({ children, style, ...props }: GradientTextProps) {
  // GRADIENT_FILL comes last: a caller's `color` must not defeat the clip and
  // repaint the text opaquely over the gradient.
  return (
    <Text style={[style, GRADIENT_FILL]} {...props}>
      {children}
    </Text>
  );
}
