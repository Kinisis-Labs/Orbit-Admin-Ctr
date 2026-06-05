import { useGetCost, getGetCostQueryKey } from "@workspace/api-client-react";
import type { CostReport } from "@workspace/api-client-react";
import type { UseQueryResult, QueryKey } from "@tanstack/react-query";

const COST_STALE_TIME = 5 * 60 * 1000;

export function useAppCost(appId: string | undefined, enabled = true): UseQueryResult<CostReport, unknown> & { queryKey: QueryKey } {
  const id = appId ?? "";
  const queryKey = getGetCostQueryKey(id);
  const result = useGetCost<CostReport, unknown>(id, undefined, {
    query: { enabled: !!appId && enabled, queryKey, staleTime: COST_STALE_TIME },
  });
  return { ...result, queryKey };
}
