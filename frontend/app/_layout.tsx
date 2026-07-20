import { useEffect } from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/query-client";
import { COLORS } from "@/constants/theme";
import "../global.css";

export default function RootLayout() {
  return (
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
      </Stack>
    </QueryClientProvider>
  );
}
