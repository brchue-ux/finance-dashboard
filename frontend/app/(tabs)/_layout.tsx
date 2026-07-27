import { Tabs, Redirect } from "expo-router";
import { View, Text, ActivityIndicator } from "react-native";
import { COLORS } from "@/constants/theme";
import { useAlerts } from "@/hooks/useAlerts";
import { useBudget } from "@/hooks/useBudget";
import { usePortfolio } from "@/hooks/usePortfolio";
import { useSession } from "@/lib/auth";
import { connectionNeedsAction } from "@/lib/connection-status";

function AlertsBadge() {
  const { data } = useAlerts();
  if (!data?.unreadCount) return null;
  return (
    <View
      style={{
        position: "absolute",
        top: -4,
        right: -8,
        backgroundColor: COLORS.danger,
        borderRadius: 8,
        minWidth: 16,
        height: 16,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 4,
      }}
    >
      <Text style={{ color: "#fff", fontSize: 10, fontWeight: "700" }}>
        {data.unreadCount > 99 ? "99+" : data.unreadCount}
      </Text>
    </View>
  );
}

/**
 * Dot on the Settings tab when a connection needs re-auth. Broken connections
 * are rare, so this deliberately isn't a banner on every screen — it's the same
 * unobtrusive tab-bar signal as AlertsBadge, and Settings → Connected Accounts
 * is the destination once it's noticed.
 */
function ConnectionAlertBadge() {
  const now = new Date();
  const { data: budget } = useBudget(now.getFullYear(), now.getMonth() + 1);
  const { data: portfolio } = usePortfolio();

  const bankNeedsAttention = (budget?.bankConnections ?? []).some((c) =>
    connectionNeedsAction(c.status)
  );
  const brokerageNeedsAttention = connectionNeedsAction(portfolio?.connection?.status);

  if (!bankNeedsAttention && !brokerageNeedsAttention) return null;

  return (
    <View
      style={{
        position: "absolute",
        top: -2,
        right: -6,
        backgroundColor: COLORS.warning,
        borderRadius: 5,
        width: 10,
        height: 10,
      }}
    />
  );
}

export default function TabsLayout() {
  const { data: session, isPending } = useSession();

  // Hold rendering until the session resolves, so we don't flash the tabs
  // (and fire authed API calls) before redirecting an unauthenticated user.
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

  if (!session) {
    return <Redirect href="/(auth)/login" />;
  }

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: "#1A1826",
          borderTopColor: COLORS.glassBorder,
          borderTopWidth: 1,
        },
        tabBarActiveTintColor: COLORS.brandPurple,
        tabBarInactiveTintColor: COLORS.textMuted,
        tabBarLabelStyle: { fontSize: 11, fontWeight: "600" },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Budget",
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18 }}>💰</Text>,
        }}
      />
      <Tabs.Screen
        name="banks"
        options={{
          title: "Banks",
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18 }}>🏦</Text>,
        }}
      />
      <Tabs.Screen
        name="portfolio"
        options={{
          title: "Portfolio",
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18 }}>📈</Text>,
        }}
      />
      <Tabs.Screen
        name="alerts"
        options={{
          title: "Alerts",
          tabBarIcon: ({ color }) => (
            <View>
              <Text style={{ color, fontSize: 18 }}>🔔</Text>
              <AlertsBadge />
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Settings",
          tabBarIcon: ({ color }) => (
            <View>
              <Text style={{ color, fontSize: 18 }}>⚙️</Text>
              <ConnectionAlertBadge />
            </View>
          ),
        }}
      />
    </Tabs>
  );
}
