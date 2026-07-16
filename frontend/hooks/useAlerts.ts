import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export interface TradingViewAlert {
  id: string;
  ticker: string;
  conditionText: string;
  price: number | null;
  interval: string | null;
  receivedAt: number;
  analyzedAt: number | null;
  severity: "red" | "yellow" | "green";
  unread: boolean;
}

export function useAlerts() {
  return useQuery({
    queryKey: ["alerts"],
    queryFn: () => api.get<{ alerts: TradingViewAlert[] }>("/api/alerts"),
    refetchInterval: 60 * 1000, // poll every 60s for new alerts
    select: (data) => ({
      alerts: data.alerts,
      unreadCount: data.alerts.filter((a) => a.unread).length,
    }),
  });
}
