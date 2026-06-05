import { useListApps, getListAppsQueryKey } from "@workspace/api-client-react";
import type { AppSummary } from "@workspace/api-client-react";
import type { UseQueryResult } from "@tanstack/react-query";
import type { QueryKey } from "@tanstack/react-query";

const APPS_STALE_TIME = 5 * 60 * 1000;

export function useApps(): UseQueryResult<AppSummary[], unknown> & { queryKey: QueryKey } {
  return useListApps<AppSummary[], unknown>({
    query: { queryKey: getListAppsQueryKey(), staleTime: APPS_STALE_TIME },
  });
}
