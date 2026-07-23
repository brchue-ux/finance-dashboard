/**
 * Horizontal swipe-to-dismiss for a card. Fling past a threshold and it slides
 * off and calls onDismiss; a short drag springs back. A small ✕ remains as a
 * guaranteed fallback if the gesture feels finicky on device.
 *
 * gesture-handler + reanimated on purpose (the PanResponder version was the
 * last known jank source): the pan callbacks are worklets, so FINGER-FOLLOW
 * runs on the UI thread — the old implementation crossed the JS bridge every
 * frame, which no amount of release-spring tuning could hide. Release springs
 * are seeded with the gesture velocity so the exit carries the fling instead
 * of restarting it.
 *
 * activeOffsetX/failOffsetY keep vertical scrolling owned by the surrounding
 * ScrollView: the pan only activates on a clearly-horizontal drag and fails
 * fast on a vertical one.
 */
import { Pressable, Text, Dimensions } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  interpolate,
  runOnJS,
} from "react-native-reanimated";
import { COLORS } from "@/constants/theme";

const SCREEN_W = Dimensions.get("window").width;
const FLING_DISTANCE = 110;
const FLING_VELOCITY = 500; // px/s — gesture-handler units, not PanResponder's px/ms

export function SwipeToDismiss({
  onDismiss,
  children,
}: {
  onDismiss: () => void;
  children: React.ReactNode;
}) {
  const translateX = useSharedValue(0);

  const pan = Gesture.Pan()
    .activeOffsetX([-10, 10])
    .failOffsetY([-10, 10])
    .onUpdate((e) => {
      translateX.value = e.translationX;
    })
    .onEnd((e) => {
      if (Math.abs(e.translationX) > FLING_DISTANCE || Math.abs(e.velocityX) > FLING_VELOCITY) {
        translateX.value = withSpring(
          e.translationX < 0 ? -SCREEN_W : SCREEN_W,
          {
            velocity: e.velocityX,
            overshootClamping: true,
            restDisplacementThreshold: 8,
            restSpeedThreshold: 8,
          },
          (finished) => {
            if (finished) runOnJS(onDismiss)();
          }
        );
      } else {
        // Snappy return, not the loose default wobble.
        translateX.value = withSpring(0, { damping: 20, stiffness: 300, velocity: e.velocityX });
      }
    });

  // Fade as it moves so the dismiss reads as intentional, not a glitch.
  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
    opacity: interpolate(translateX.value, [-SCREEN_W, 0, SCREEN_W], [0, 1, 0], "clamp"),
  }));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={style}>
        {children}
        <Pressable
          onPress={onDismiss}
          hitSlop={12}
          style={{
            position: "absolute",
            top: 8,
            right: 8,
            width: 22,
            height: 22,
            borderRadius: 11,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: COLORS.glassBg,
            borderWidth: 1,
            borderColor: COLORS.glassBorder,
          }}
        >
          <Text style={{ color: COLORS.textMuted, fontSize: 12, lineHeight: 13 }}>✕</Text>
        </Pressable>
      </Animated.View>
    </GestureDetector>
  );
}
