/**
 * Settings → Developer. Browsable job_runs feed with filters and error detail.
 * Reads the DB via /api/system/jobs only — deep debugging stays in Railway's
 * own log viewer (pulling its API in was rejected: extra dependency and auth
 * surface for marginal value).
 *
 * No access gating: single-user app, and it exposes only this user's own rows.
 */
import { useState } from "react";
import { ScrollView, View, Text, Pressable, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { GlassCard } from "@/components/ui/GlassCard";
import { GradientText } from "@/components/ui/GradientText";
import { COLORS } from "@/constants/theme";
import { useJobRuns, type JobRun } from "@/hooks/useSystem";

const JOB_TYPES = [
  "plaid_sync",
  "snaptrade_sync",
  "alert_poll",
  "nightly_batch",
  "import_csv",
  "recategorize",
  "tradingview_webhook",
];

function fmtTime(unixSeconds: number | null): string {
  if (!unixSeconds) return "—";
  return new Date(unixSeconds * 1000).toLocaleString();
}

function duration(job: JobRun): string {
  if (!job.finishedAt) return job.status === "running" ? "running…" : "—";
  const s = job.finishedAt - job.startedAt;
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

export default function DeveloperScreen() {
  const router = useRouter();
  const [jobType, setJobType] = useState<string | undefined>();
  const [failedOnly, setFailedOnly] = useState(false);

  const { data, isLoading, isError } = useJobRuns({
    jobType,
    status: failedOnly ? "failed" : undefined,
  });

  const jobs = data?.jobs ?? [];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.background }}>
      <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 }}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={{ flexDirection: "row", alignItems: "center" }}>
          <Text style={{ color: COLORS.brandPurple, fontSize: 24, marginRight: 4 }}>‹</Text>
          <GradientText style={{ fontSize: 20, fontWeight: "800" }}>Developer</GradientText>
        </Pressable>
      </View>

      {/* Filters */}
      <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <Chip label="All" active={!jobType} onPress={() => setJobType(undefined)} />
          {JOB_TYPES.map((t) => (
            <Chip
              key={t}
              label={t.replace(/_/g, " ")}
              active={jobType === t}
              onPress={() => setJobType(jobType === t ? undefined : t)}
            />
          ))}
        </ScrollView>
        <Pressable onPress={() => setFailedOnly((v) => !v)} style={{ marginTop: 8 }}>
          <Text style={{ color: failedOnly ? COLORS.danger : COLORS.textMuted, fontSize: 13 }}>
            {failedOnly ? "✓ " : ""}Failed only
          </Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        {isLoading ? (
          <ActivityIndicator color={COLORS.brandPurple} style={{ marginTop: 40 }} />
        ) : isError ? (
          <Text style={{ color: COLORS.danger, fontSize: 14, textAlign: "center", marginTop: 40 }}>
            Couldn’t load job runs.
          </Text>
        ) : jobs.length === 0 ? (
          <Text style={{ color: COLORS.textMuted, fontSize: 14, textAlign: "center", marginTop: 40 }}>
            No job runs match this filter.
          </Text>
        ) : (
          jobs.map((job) => <JobCard key={job.id} job={job} />)
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function JobCard({ job }: { job: JobRun }) {
  const [expanded, setExpanded] = useState(false);
  const color =
    job.status === "complete"
      ? COLORS.success
      : job.status === "failed"
        ? COLORS.danger
        : COLORS.brandPurple;

  const hasDetail = Boolean(job.metadata) || Boolean(job.errorMessage);

  return (
    <Pressable onPress={() => hasDetail && setExpanded((v) => !v)}>
      <GlassCard style={{ marginBottom: 8 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <Text style={{ color: COLORS.textPrimary, fontSize: 14, fontWeight: "600" }}>
            {job.jobType.replace(/_/g, " ")}
          </Text>
          <Text style={{ color, fontSize: 12, fontWeight: "600" }}>{job.status}</Text>
        </View>

        <Text style={{ color: COLORS.textMuted, fontSize: 12, marginTop: 4 }}>
          {fmtTime(job.startedAt)} · {duration(job)}
        </Text>

        {job.errorMessage && (
          <Text
            style={{ color: COLORS.danger, fontSize: 12, marginTop: 6 }}
            numberOfLines={expanded ? undefined : 2}
          >
            {job.errorMessage}
          </Text>
        )}

        {expanded && job.metadata && (
          <Text
            selectable
            style={{
              color: COLORS.textMuted,
              fontSize: 11,
              marginTop: 8,
              fontFamily: "monospace",
            }}
          >
            {JSON.stringify(job.metadata, null, 2)}
          </Text>
        )}

        {hasDetail && !expanded && (
          <Text style={{ color: COLORS.textMuted, fontSize: 11, marginTop: 6 }}>
            Tap for detail
          </Text>
        )}
      </GlassCard>
    </Pressable>
  );
}

function Chip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: active ? COLORS.brandPurple : COLORS.glassBorder,
        backgroundColor: active ? "rgba(124,58,237,0.15)" : COLORS.glassBg,
        marginRight: 8,
      }}
    >
      <Text style={{ color: active ? COLORS.brandPurple : COLORS.textMuted, fontSize: 12 }}>
        {label}
      </Text>
    </Pressable>
  );
}
