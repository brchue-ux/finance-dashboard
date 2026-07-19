/**
 * Manage Alerts — spec §9 Alerts "Manage alerts" entry. The standing
 * price_alerts surface (monitoring instructions), distinct from the fires feed:
 * create, pause, re-arm (a one-time fired/expired alert), and delete.
 * Reached via router.push("/manage-alerts") from the Alerts tab header.
 */
import { useState } from "react";
import {
  ScrollView,
  View,
  Text,
  TextInput,
  Pressable,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { COLORS } from "@/constants/theme";
import {
  useStandingAlerts,
  useCreateAlert,
  useUpdateStandingAlert,
  useDeleteStandingAlert,
  type StandingAlert,
  type AlertConditionType,
} from "@/hooks/useAlerts";

const CONDITIONS: { type: AlertConditionType; label: string; unit: "price" | "pct" }[] = [
  { type: "price_above", label: "Price above", unit: "price" },
  { type: "price_below", label: "Price below", unit: "price" },
  { type: "pct_change_up", label: "Up % today", unit: "pct" },
  { type: "pct_change_down", label: "Down % today", unit: "pct" },
];

const STATUS_COLOR: Record<StandingAlert["status"], string> = {
  active: COLORS.success,
  triggered: COLORS.brandBlue,
  paused: COLORS.textMuted,
  expired: COLORS.warning,
};

function timeAgo(ts: number): string {
  const diff = Math.floor(Date.now() / 1000 - ts);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export default function ManageAlertsScreen() {
  const router = useRouter();
  const { data: alerts, isLoading } = useStandingAlerts();
  const createAlert = useCreateAlert();
  const updateAlert = useUpdateStandingAlert();
  const deleteAlert = useDeleteStandingAlert();

  const [showForm, setShowForm] = useState(false);
  const [ticker, setTicker] = useState("");
  const [condition, setCondition] = useState<AlertConditionType>("price_above");
  const [thresholdText, setThresholdText] = useState("");
  const [label, setLabel] = useState("");

  const unit = CONDITIONS.find((c) => c.type === condition)!.unit;
  const thresholdValue = Number(thresholdText);
  const formValid =
    ticker.trim().length > 0 && thresholdText.trim() !== "" && thresholdValue > 0;

  function resetForm() {
    setTicker("");
    setCondition("price_above");
    setThresholdText("");
    setLabel("");
    setShowForm(false);
  }

  function submit() {
    if (!formValid) return;
    // Backend wants a decimal fraction for pct conditions (3% -> 0.03); a raw
    // dollar amount for price conditions.
    const threshold = unit === "pct" ? thresholdValue / 100 : thresholdValue;
    createAlert.mutate(
      {
        ticker: ticker.trim().toUpperCase(),
        conditionType: condition,
        threshold,
        label: label.trim() || undefined,
      },
      { onSuccess: resetForm }
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.background }}>
      {/* Header */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          paddingHorizontal: 16,
          paddingTop: 8,
          paddingBottom: 12,
        }}
      >
        <Pressable onPress={() => router.back()} hitSlop={12} style={{ flexDirection: "row", alignItems: "center", flex: 1 }}>
          <Text style={{ color: COLORS.brandPurple, fontSize: 24, marginRight: 4 }}>‹</Text>
          <Text style={{ color: COLORS.textPrimary, fontSize: 18, fontWeight: "700" }}>
            Manage Alerts
          </Text>
        </Pressable>
        <Pressable onPress={() => setShowForm((s) => !s)} hitSlop={8}>
          <Text style={{ color: COLORS.brandPurple, fontSize: 15, fontWeight: "600" }}>
            {showForm ? "Cancel" : "+ New"}
          </Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        {showForm && (
          <View
            style={{
              backgroundColor: COLORS.glassBg,
              borderWidth: 1,
              borderColor: COLORS.glassBorder,
              borderRadius: 14,
              padding: 16,
              marginBottom: 20,
              gap: 12,
            }}
          >
            <FieldLabel>Symbol</FieldLabel>
            <TextInput
              value={ticker}
              onChangeText={setTicker}
              placeholder="AAPL, ^GSPC…"
              placeholderTextColor={COLORS.textMuted}
              autoCapitalize="characters"
              autoCorrect={false}
              style={inputStyle}
            />

            <FieldLabel>Condition</FieldLabel>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {CONDITIONS.map((c) => {
                const selected = c.type === condition;
                return (
                  <Pressable
                    key={c.type}
                    onPress={() => setCondition(c.type)}
                    style={{
                      paddingHorizontal: 12,
                      paddingVertical: 8,
                      borderRadius: 10,
                      borderWidth: 1,
                      borderColor: selected ? COLORS.brandPurple : COLORS.glassBorder,
                      backgroundColor: selected ? "rgba(124,58,237,0.15)" : "transparent",
                    }}
                  >
                    <Text style={{ color: selected ? COLORS.textPrimary : COLORS.textMuted, fontSize: 13, fontWeight: "600" }}>
                      {c.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <FieldLabel>{unit === "pct" ? "Threshold (%)" : "Threshold ($)"}</FieldLabel>
            <TextInput
              value={thresholdText}
              onChangeText={setThresholdText}
              placeholder={unit === "pct" ? "3" : "150.00"}
              placeholderTextColor={COLORS.textMuted}
              keyboardType="decimal-pad"
              style={inputStyle}
            />

            <FieldLabel>Label (optional)</FieldLabel>
            <TextInput
              value={label}
              onChangeText={setLabel}
              placeholder="Stop-loss, target…"
              placeholderTextColor={COLORS.textMuted}
              style={inputStyle}
            />

            <Pressable
              onPress={submit}
              disabled={!formValid || createAlert.isPending}
              style={{
                marginTop: 4,
                backgroundColor: formValid ? COLORS.brandPurple : "rgba(124,58,237,0.4)",
                borderRadius: 10,
                paddingVertical: 12,
                alignItems: "center",
              }}
            >
              <Text style={{ color: "#fff", fontWeight: "700", fontSize: 15 }}>
                {createAlert.isPending ? "Creating…" : "Create alert"}
              </Text>
            </Pressable>
            {createAlert.isError && (
              <Text style={{ color: COLORS.danger, fontSize: 12 }}>
                Couldn’t create alert. Check the symbol and try again.
              </Text>
            )}
          </View>
        )}

        {isLoading ? (
          <ActivityIndicator color={COLORS.brandPurple} style={{ marginTop: 40 }} />
        ) : (alerts?.length ?? 0) === 0 ? (
          <View style={{ alignItems: "center", marginTop: 48 }}>
            <Text style={{ color: COLORS.textMuted, fontSize: 15 }}>No standing alerts</Text>
            <Text style={{ color: COLORS.textMuted, fontSize: 13, marginTop: 6, textAlign: "center" }}>
              Tap “+ New” to watch a symbol for a price or % move.
            </Text>
          </View>
        ) : (
          alerts!.map((alert) => (
            <StandingAlertRow
              key={alert.id}
              alert={alert}
              busy={updateAlert.isPending || deleteAlert.isPending}
              onPause={() => updateAlert.mutate({ id: alert.id, patch: { status: "paused" } })}
              onRearm={() => updateAlert.mutate({ id: alert.id, patch: { status: "active" } })}
              onDelete={() => deleteAlert.mutate(alert.id)}
            />
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function StandingAlertRow({
  alert,
  busy,
  onPause,
  onRearm,
  onDelete,
}: {
  alert: StandingAlert;
  busy: boolean;
  onPause: () => void;
  onRearm: () => void;
  onDelete: () => void;
}) {
  const fired =
    alert.triggerCount > 0 && alert.lastTriggeredAt != null
      ? `Fired ${alert.triggerCount}× · ${timeAgo(alert.lastTriggeredAt)}`
      : "Never fired";

  return (
    <View
      style={{
        backgroundColor: COLORS.glassBg,
        borderWidth: 1,
        borderColor: COLORS.glassBorder,
        borderRadius: 12,
        padding: 14,
        marginBottom: 10,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 4 }}>
        <Text style={{ color: COLORS.textPrimary, fontWeight: "700", fontSize: 15, flex: 1 }}>
          {alert.ticker}
        </Text>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 5,
          }}
        >
          <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: STATUS_COLOR[alert.status] }} />
          <Text style={{ color: COLORS.textMuted, fontSize: 12, textTransform: "capitalize" }}>
            {alert.status}
          </Text>
        </View>
      </View>
      <Text style={{ color: COLORS.textMuted, fontSize: 13 }}>
        {alert.conditionLabel}
        {alert.label ? ` · ${alert.label}` : ""}
      </Text>
      <Text style={{ color: COLORS.textMuted, fontSize: 12, marginTop: 2, opacity: 0.7 }}>{fired}</Text>

      <View style={{ flexDirection: "row", gap: 18, marginTop: 12 }}>
        {alert.status === "active" ? (
          <ActionText disabled={busy} onPress={onPause} color={COLORS.textMuted}>
            Pause
          </ActionText>
        ) : (
          <ActionText disabled={busy} onPress={onRearm} color={COLORS.success}>
            Re-arm
          </ActionText>
        )}
        <ActionText disabled={busy} onPress={onDelete} color={COLORS.danger}>
          Delete
        </ActionText>
      </View>
    </View>
  );
}

function ActionText({
  children,
  onPress,
  color,
  disabled,
}: {
  children: string;
  onPress: () => void;
  color: string;
  disabled: boolean;
}) {
  return (
    <Pressable onPress={onPress} disabled={disabled} hitSlop={8}>
      <Text style={{ color, fontSize: 13, fontWeight: "600", opacity: disabled ? 0.5 : 1 }}>
        {children}
      </Text>
    </Pressable>
  );
}

function FieldLabel({ children }: { children: string }) {
  return (
    <Text style={{ color: COLORS.textMuted, fontSize: 12, fontWeight: "600", letterSpacing: 0.5 }}>
      {children}
    </Text>
  );
}

const inputStyle = {
  backgroundColor: "rgba(255,255,255,0.04)",
  borderWidth: 1,
  borderColor: COLORS.glassBorder,
  borderRadius: 10,
  paddingHorizontal: 12,
  paddingVertical: 10,
  color: COLORS.textPrimary,
  fontSize: 15,
} as const;
