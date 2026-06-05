import { useGetNetwork, getGetNetworkQueryKey } from "@workspace/api-client-react";
import type { NetworkReport } from "@workspace/api-client-react";
import type { UseQueryResult, QueryKey } from "@tanstack/react-query";

const NETWORK_STALE_TIME = 3 * 60 * 1000;

export function useAppNetwork(appId: string | undefined): UseQueryResult<NetworkReport, unknown> & { queryKey: QueryKey } {
  const id = appId ?? "";
  const queryKey = getGetNetworkQueryKey(id);
  const result = useGetNetwork<NetworkReport, unknown>(id, undefined, {
    query: { enabled: !!appId, queryKey, staleTime: NETWORK_STALE_TIME },
  });
  return { ...result, queryKey };
}
