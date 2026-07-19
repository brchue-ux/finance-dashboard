import { Stack, Redirect } from "expo-router";
import { View, ActivityIndicator } from "react-native";
import { COLORS } from "@/constants/theme";
import { useSession } from "@/lib/auth";

export default function AuthLayout() {
  const { data: session, isPending } = useSession();

  // Wait for the session check before deciding, so an already-signed-in user
  // isn't briefly shown the login screen on cold start.
  if (isPending) {
    return (
      <View
        style={{
          flex: 1,
          justifyContent: "center",
          alignItems: "center",
          backgroundColor: COLORS.background,
        }}
      >
        <ActivityIndicator color={COLORS.brandPurple} />
      </View>
    );
  }

  if (session) {
    return <Redirect href="/(tabs)" />;
  }

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: COLORS.background },
      }}
    />
  );
}
