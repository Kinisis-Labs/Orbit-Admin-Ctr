import { useGetAppAlerts, getGetAppAlertsQueryKey } from "@workspace/api-client-react";
import type { Alert } from "@workspace/api-client-react";
import type { UseQueryResult } from "@tanstack/react-query";
import type { QueryKey } from "@tanstack/react-query";

const ALERTS_STALE_TIME = 3 * 60 * 1000;

export function useAppAlerts(appId: string | undefined): UseQueryResult<Alert[], unknown> & { queryKey: QueryKey } {
  const id = appId ?? "";
  const queryKey = getGetAppAlertsQueryKey(id);
  const result = useGetAppAlerts<Alert[], unknown>(id, undefined, {
    query: { enabled: !!appId, queryKey, staleTime: ALERTS_STALE_TIME },
  });
  return { ...result, queryKey };
}
