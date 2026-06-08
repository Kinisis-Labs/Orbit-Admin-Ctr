import { useGetInfrastructure, getGetInfrastructureQueryKey } from "@workspace/api-client-react";
import type { InfrastructureReport } from "@workspace/api-client-react";
import type { UseQueryResult, QueryKey } from "@tanstack/react-query";

const INFRASTRUCTURE_STALE_TIME = 3 * 60 * 1000;
export const INFRASTRUCTURE_DEFAULT_REFETCH_INTERVAL = 60_000;

export function useAppInfrastructure(
  appId: string | undefined,
  refetchInterval: number = INFRASTRUCTURE_DEFAULT_REFETCH_INTERVAL,
): UseQueryResult<InfrastructureReport, unknown> & { queryKey: QueryKey } {
  const id = appId ?? "";
  const queryKey = getGetInfrastructureQueryKey(id);
  const result = useGetInfrastructure<InfrastructureReport, unknown>(id, undefined, {
    query: {
      enabled: !!appId,
      queryKey,
      staleTime: INFRASTRUCTURE_STALE_TIME,
      refetchInterval: refetchInterval > 0 ? refetchInterval : false,
      refetchIntervalInBackground: false,
    },
  });
  return { ...result, queryKey };
}
