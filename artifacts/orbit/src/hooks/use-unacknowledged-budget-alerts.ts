import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getListBudgetAlertLogQueryOptions } from "@workspace/api-client-react";

export function useUnacknowledgedBudgetAlerts(enabled = true) {
  const queryClient = useQueryClient();
  const baseOptions = getListBudgetAlertLogQueryOptions({ unacknowledgedOnly: true, limit: 200 });

  // SSE subscription: invalidate the alert-log cache instantly when the server
  // pushes an "alert" event, rather than waiting for the 60-second poll.
  useEffect(() => {
    if (!enabled) return;

    const es = new EventSource("/api/alerts/stream", { withCredentials: true });

    const handleAlert = () => {
      const opts = getListBudgetAlertLogQueryOptions({ unacknowledgedOnly: true, limit: 200 });
      void queryClient.invalidateQueries({ queryKey: opts.queryKey });
    };

    es.addEventListener("alert", handleAlert);

    return () => {
      es.removeEventListener("alert", handleAlert);
      es.close();
    };
  }, [enabled, queryClient]);

  const { data, isLoading } = useQuery({
    ...baseOptions,
    enabled,
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
  });

  return {
    unacknowledgedCount: data?.total ?? 0,
    isLoading,
  };
}
