/**
 * Settings → System status. Trust signals, not logs: is my data current, did
 * the background work run. Raw job rows live on the Developer screen.
 */
import { ScrollView, View, Text, Pressable, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { GlassCard } from "@/components/ui/GlassCard";
import { GradientText } from "@/components/ui/GradientText";
import { COLORS } from "@/constants/theme";
import { useSystemStatus } from "@/hooks/useSystem";

/** job_runs timestamps are unix seconds; connection timestamps are too. */
function timeAgo(unixSeconds: number | null): string {
  if (!unixSeconds) return "never";
  const mins = Math.floor((Date.now() / 1000 - unixSeconds) / 60);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function statusColor(status: string | null): string {
  if (status === "complete" || status === "active") return COLORS.success;
  if (status === "failed") return COLORS.danger;
  // A run where only some units of work succeeded must not read as green.
  if (status === "partial") return COLORS.warning;
  if (status === "running") return COLORS.brandPurple;
  return COLORS.warning;
}

function Row({
  label,
  value,
  detail,
  color,
}: {
  label: string;
  value: string;
  detail?: string;
  color?: string;
}) {
  return (
    <View style={{ paddingVertical: 8 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Text style={{ color: COLORS.textPrimary, fontSize: 14, flex: 1 }} numberOfLines={1}>
          {label}
        </Text>
        <Text style={{ color: color ?? COLORS.textMuted, fontSize: 13, marginLeft: 8 }}>
          {value}
        </Text>
      </View>
      {detail && (
        <Text style={{ color: COLORS.textMuted, fontSize: 12, marginTop: 2 }}>{detail}</Text>
      )}
    </View>
  );
}

export default function SystemStatusScreen() {
  const router = useRouter();
  const { data, isLoading, isError } = useSystemStatus();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.background }}>
      <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 }}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={{ flexDirection: "row", alignItems: "center" }}>
          <Text style={{ color: COLORS.brandPurple, fontSize: 24, marginRight: 4 }}>‹</Text>
          <GradientText style={{ fontSize: 20, fontWeight: "800" }}>System status</GradientText>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        {isLoading ? (
          <ActivityIndicator color={COLORS.brandPurple} style={{ marginTop: 40 }} />
        ) : isError || !data ? (
          <Text style={{ color: COLORS.danger, fontSize: 14, textAlign: "center", marginTop: 40 }}>
            Couldn’t load system status.
          </Text>
        ) : (
          <>
            <SectionLabel>CONNECTIONS</SectionLabel>
            <GlassCard style={{ marginBottom: 20 }}>
              {data.connections.banks.length === 0 && !data.connections.wealthsimple && (
                <Text style={{ color: COLORS.textMuted, fontSize: 13 }}>
                  No accounts connected yet.
                </Text>
              )}
              {data.connections.banks.map((b) => (
                <Row
                  key={b.institution}
                  label={b.institution}
                  value={b.status === "active" ? "Live" : b.status}
                  detail={`Last synced ${timeAgo(b.lastSyncedAt)}`}
                  color={statusColor(b.status)}
                />
              ))}
              {data.connections.wealthsimple && (
                <Row
                  label="Wealthsimple"
                  value={
                    data.connections.wealthsimple.status === "active"
                      ? "Live"
                      : data.connections.wealthsimple.status
                  }
                  detail={`Last synced ${timeAgo(data.connections.wealthsimple.lastSyncedAt)}`}
                  color={statusColor(data.connections.wealthsimple.status)}
                />
              )}
            </GlassCard>

            <SectionLabel>BACKGROUND JOBS</SectionLabel>
            <GlassCard style={{ marginBottom: 20 }}>
              <Row
                label="Price alert engine"
                value={
                  data.alertEngine.marketWindowOpenNow
                    ? timeAgo(data.alertEngine.lastRunAt)
                    : "Market closed"
                }
                // A gap outside market hours is expected, so it isn't flagged
                // as stale — the poller only runs Mon–Fri ~4:00–20:00 ET.
                detail={
                  data.alertEngine.marketWindowOpenNow
                    ? `Last run ${data.alertEngine.lastRunStatus ?? "unknown"}`
                    : `Last checked ${timeAgo(data.alertEngine.lastRunAt)}`
                }
                color={
                  data.alertEngine.marketWindowOpenNow
                    ? statusColor(data.alertEngine.lastRunStatus)
                    : COLORS.textMuted
                }
              />
              <Row
                label="Nightly analysis"
                value={timeAgo(data.nightlyAnalysis.lastRunAt)}
                detail={`Last run ${data.nightlyAnalysis.lastRunStatus ?? "never run"}`}
                color={statusColor(data.nightlyAnalysis.lastRunStatus)}
              />
            </GlassCard>

            <SectionLabel>IMPORT HISTORY</SectionLabel>
            <GlassCard style={{ marginBottom: 20 }}>
              {data.importHistory.length === 0 ? (
                <Text style={{ color: COLORS.textMuted, fontSize: 13 }}>No imports yet.</Text>
              ) : (
                data.importHistory.map((j) => (
                  <Row
                    key={j.id}
                    label={j.jobType.replace(/_/g, " ")}
                    value={j.status}
                    detail={
                      j.errorMessage
                        ? j.errorMessage
                        : `${timeAgo(j.startedAt)}${
                            typeof j.metadata?.imported === "number"
                              ? ` · ${j.metadata.imported} rows`
                              : ""
                          }`
                    }
                    color={statusColor(j.status)}
                  />
                ))
              )}
            </GlassCard>

            <Pressable onPress={() => router.push("/developer")}>
              <GlassCard>
                <Text style={{ color: COLORS.textPrimary, fontSize: 15 }}>Developer</Text>
                <Text style={{ color: COLORS.textMuted, fontSize: 12, marginTop: 2 }}>
                  Raw job run history with errors
                </Text>
              </GlassCard>
            </Pressable>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <Text
      style={{
        color: COLORS.textMuted,
        fontSize: 12,
        fontWeight: "600",
        letterSpacing: 1,
        marginBottom: 10,
      }}
    >
      {children}
    </Text>
  );
}
