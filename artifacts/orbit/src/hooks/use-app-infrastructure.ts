import { useGetInfrastructure, getGetInfrastructureQueryKey } from "@workspace/api-client-react";
import type { InfrastructureReport } from "@workspace/api-client-react";
import type { UseQueryResult, QueryKey } from "@tanstack/react-query";

const INFRASTRUCTURE_STALE_TIME = 3 * 60 * 1000;

export function useAppInfrastructure(appId: string | undefined): UseQueryResult<InfrastructureReport, unknown> & { queryKey: QueryKey } {
  const id = appId ?? "";
  const queryKey = getGetInfrastructureQueryKey(id);
  const result = useGetInfrastructure<InfrastructureReport, unknown>(id, undefined, {
    query: { enabled: !!appId, queryKey, staleTime: INFRASTRUCTURE_STALE_TIME },
  });
  return { ...result, queryKey };
}
