import { Text, TextProps } from "react-native";
import MaskedView from "@react-native-masked-view/masked-view";
import { LinearGradient } from "expo-linear-gradient";
import { GRADIENT } from "@/constants/theme";

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
