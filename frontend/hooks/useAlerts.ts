import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export type AlertSource = "native" | "tradingview";
export type AlertSeverity = "red" | "yellow" | "green";

/**
 * One item in the unified alerts feed (GET /api/alerts). Mirrors the backend
 * `UnifiedAlert` contract exactly (backend/app/api/alerts/route.ts): native
 * `alert_fires` and `tradingview_alerts` normalized into one shape.
 */
export interface UnifiedAlert {
  id: string;
  source: AlertSource;
  ticker: string;
  conditionLabel: string;
  price: number | null;
  timestamp: number; // Unix seconds (fired_at / received_at)
  severity: AlertSeverity;
  unread: boolean;
  analyzedAt: number | null; // TradingView only; null for native fires
  alertId: string | null; // standing price_alerts id; null for TradingView
}

export function useAlerts() {
  return useQuery({
    queryKey: ["alerts"],
    queryFn: () => api.get<{ alerts: UnifiedAlert[] }>("/api/alerts"),
    refetchInterval: 60 * 1000, // poll every 60s for new fires
    select: (data) => ({
      alerts: data.alerts,
      unreadCount: data.alerts.filter((a) => a.unread).length,
    }),
  });
}

/**
 * Mark one feed item read. The backend routes to the correct table by the
 * item's `source` (alert_fires vs tradingview_alerts), so it must be sent.
 */
export function useMarkAlertRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, source }: { id: string; source: AlertSource }) =>
      api.patch(`/api/alerts/${id}/read`, { source }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["alerts"] }),
  });
}

// --- Standing price alerts (the "Manage alerts" surface) ---

// Read set (poller can set triggered/expired); only active|paused are settable
// back via PATCH (setting active on a triggered/expired alert = re-arm).
export type StandingAlertStatus = "active" | "triggered" | "paused" | "expired";
export type SettableAlertStatus = "active" | "paused";
export type AlertConditionType =
  | "price_above"
  | "price_below"
  | "pct_change_up"
  | "pct_change_down";

/** A monitoring instruction (GET /api/alerts/standing) — distinct from a fire. */
export interface StandingAlert {
  id: string;
  ticker: string;
  label: string | null;
  conditionLabel: string;
  conditionType: AlertConditionType;
  threshold: number;
  status: StandingAlertStatus;
  extendedHours: boolean;
  cooldownSeconds: number | null;
  lastTriggeredAt: number | null;
  triggerCount: number;
  expiresAt: number | null;
  createdAt: number;
}

export function useStandingAlerts() {
  return useQuery({
    queryKey: ["standing-alerts"],
    queryFn: () => api.get<{ alerts: StandingAlert[] }>("/api/alerts/standing"),
    select: (data) => data.alerts,
  });
}

export interface CreateAlertInput {
  ticker: string;
  conditionType: AlertConditionType;
  threshold: number; // dollar price, or decimal pct (0.03 = 3%) for pct_change_*
  label?: string;
  extendedHours?: boolean;
  cooldownSeconds?: number; // omitted = one-time fire
  expiresAt?: number;
}

export function useCreateAlert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateAlertInput) =>
      api.post<{ id: string }>("/api/alerts", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["standing-alerts"] }),
  });
}

export interface UpdateAlertInput {
  status?: SettableAlertStatus; // "active" on a triggered/expired alert = re-arm
  label?: string | null;
  threshold?: number;
  extendedHours?: boolean;
  cooldownSeconds?: number | null;
  expiresAt?: number | null;
}

export function useUpdateStandingAlert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateAlertInput }) =>
      api.patch(`/api/alerts/${id}`, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["standing-alerts"] }),
  });
}

export function useDeleteStandingAlert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del(`/api/alerts/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["standing-alerts"] }),
  });
}
