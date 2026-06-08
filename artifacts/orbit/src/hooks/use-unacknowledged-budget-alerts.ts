import { useQuery } from "@tanstack/react-query";
import { getListBudgetAlertLogQueryOptions } from "@workspace/api-client-react";

export function useUnacknowledgedBudgetAlerts(enabled = true) {
  const baseOptions = getListBudgetAlertLogQueryOptions({ unacknowledgedOnly: true, limit: 200 });

  const { data, isLoading } = useQuery({
    ...baseOptions,
    enabled,
    staleTime: 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });

  return {
    unacknowledgedCount: data?.length ?? 0,
    isLoading,
  };
}
