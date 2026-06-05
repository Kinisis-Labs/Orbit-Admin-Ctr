import { useGetApp, getGetAppQueryKey } from "@workspace/api-client-react";
import type { AppDetail } from "@workspace/api-client-react";
import type { UseQueryResult } from "@tanstack/react-query";
import type { QueryKey } from "@tanstack/react-query";

const APP_STALE_TIME = 3 * 60 * 1000;

export function useApp(appId: string | undefined): UseQueryResult<AppDetail, unknown> & { queryKey: QueryKey } {
  const id = appId ?? "";
  const queryKey = getGetAppQueryKey(id);
  const result = useGetApp<AppDetail, unknown>(id, {
    query: { enabled: !!appId, queryKey, staleTime: APP_STALE_TIME },
  });
  return { ...result, queryKey };
}
