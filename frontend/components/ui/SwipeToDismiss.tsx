/**
 * Horizontal swipe-to-dismiss for a card, built on core PanResponder + Animated
 * (no gesture-handler dependency, no root-view setup). Fling the card left or
 * right past a threshold and it slides off and calls onDismiss; a short drag
 * springs back. A small ✕ is a guaranteed fallback if the gesture feels finicky
 * on device.
 *
 * Feel notes (the first cut was "janky" on device): release animations run on
 * the NATIVE driver — transform and opacity qualify, and JS-thread animation
 * stutter was the core of the complaint. Finger-follow updates still cross the
 * bridge each frame; that is inherent to PanResponder (fixing it means taking
 * the gesture-handler dependency, deliberately not done).
 *
 * The responder only claims clearly-horizontal drags, so the surrounding
 * vertical ScrollView keeps scrolling normally.
 */
import { useRef } from "react";
import { Animated, PanResponder, Pressable, Text, Dimensions } from "react-native";
import { COLORS } from "@/constants/theme";

const SCREEN_W = Dimensions.get("window").width;
const FLING_DISTANCE = 110;
const FLING_VELOCITY = 0.5;

export function SwipeToDismiss({
  onDismiss,
  children,
}: {
  onDismiss: () => void;
  children: React.ReactNode;
}) {
  const translateX = useRef(new Animated.Value(0)).current;
  // Fade as it moves so the dismiss reads as intentional, not a glitch.
  const opacity = translateX.interpolate({
    inputRange: [-SCREEN_W, 0, SCREEN_W],
    outputRange: [0, 1, 0],
    extrapolate: "clamp",
  });

  const pan = useRef(
    PanResponder.create({
      // Claim only when the drag is meaningfully horizontal, so vertical
      // scrolling still belongs to the ScrollView.
      onMoveShouldSetPanResponder: (_, g) =>
        Math.abs(g.dx) > 10 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
      onPanResponderMove: (_, g) => translateX.setValue(g.dx),
      onPanResponderRelease: (_, g) => {
        if (Math.abs(g.dx) > FLING_DISTANCE || Math.abs(g.vx) > FLING_VELOCITY) {
          // Momentum-matched exit: a spring seeded with the release velocity
          // carries the fling instead of restarting it — the fixed-duration
          // linear slide was most of the perceived jank. overshootClamping
          // stops it dead offscreen rather than bouncing there.
          Animated.spring(translateX, {
            toValue: g.dx < 0 ? -SCREEN_W : SCREEN_W,
            velocity: g.vx,
            overshootClamping: true,
            restDisplacementThreshold: 8,
            restSpeedThreshold: 8,
            useNativeDriver: true,
          }).start(() => onDismiss());
        } else {
          // Snappy return, not the loose default wobble.
          Animated.spring(translateX, {
            toValue: 0,
            speed: 24,
            bounciness: 5,
            useNativeDriver: true,
          }).start();
        }
      },
    })
  ).current;

  return (
    <Animated.View {...pan.panHandlers} style={{ transform: [{ translateX }], opacity }}>
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
  );
}
