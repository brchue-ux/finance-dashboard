import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export interface SystemStatus {
  connections: {
    banks: { institution: string; status: string; lastSyncedAt: number | null }[];
    wealthsimple: { status: string; lastSyncedAt: number | null } | null;
  };
  alertEngine: {
    lastRunAt: number | null;
    lastRunStatus: string | null;
    /** False outside Mon–Fri ~4:00–20:00 ET; a gap then is healthy, not stale. */
    marketWindowOpenNow: boolean;
  };
  nightlyAnalysis: {
    lastRunAt: number | null;
    lastRunStatus: string | null;
    /** Per-view outcomes from the batch poller ("3 cards (1 dropped by validation)"). */
    items: { view: string; outcome: string; detail?: string }[] | null;
  };
  importHistory: JobRun[];
}

export interface JobRun {
  id: string;
  userId?: string | null;
  jobType: string;
  status: string;
  startedAt: number;
  finishedAt: number | null;
  errorMessage: string | null;
  metadata: Record<string, unknown> | null;
}

export function useSystemStatus() {
  return useQuery({
    queryKey: ["system-status"],
    queryFn: () => api.get<SystemStatus>("/api/system/status"),
    refetchInterval: 60 * 1000,
  });
}

export function useJobRuns(filters: { jobType?: string; status?: string }) {
  const params = new URLSearchParams();
  if (filters.jobType) params.set("jobType", filters.jobType);
  if (filters.status) params.set("status", filters.status);
  params.set("limit", "100");
  const qs = params.toString();

  return useQuery({
    queryKey: ["job-runs", filters.jobType ?? null, filters.status ?? null],
    queryFn: () => api.get<{ jobs: JobRun[] }>(`/api/system/jobs?${qs}`),
  });
}
