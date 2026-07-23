import { useEffect } from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/query-client";
import { COLORS } from "@/constants/theme";
import "../global.css";

export default function RootLayout() {
  return (
    // Gesture-handler needs its root view above any GestureDetector (the
    // native-thread swipe in SwipeToDismiss); flex:1 or gestures silently no-op.
    <GestureHandlerRootView style={{ flex: 1 }}>
    <QueryClientProvider client={queryClient}>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: COLORS.background },
        }}
      >
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="manage-alerts" options={{ presentation: "card" }} />
        <Stack.Screen name="account/[id]" options={{ presentation: "card" }} />
        <Stack.Screen name="reports" options={{ presentation: "card" }} />
        <Stack.Screen name="holding/[ticker]" options={{ presentation: "card" }} />
        <Stack.Screen name="connect-account" options={{ presentation: "modal" }} />
        <Stack.Screen name="plaid-hosted-link-complete" />
        <Stack.Screen name="snaptrade-complete" />
      </Stack>
    </QueryClientProvider>
    </GestureHandlerRootView>
  );
}
