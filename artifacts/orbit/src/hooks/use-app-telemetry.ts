import { useGetTelemetry, getGetTelemetryQueryKey } from "@workspace/api-client-react";
import type { TelemetryReport } from "@workspace/api-client-react";
import type { UseQueryResult, QueryKey } from "@tanstack/react-query";

const TELEMETRY_STALE_TIME = 3 * 60 * 1000;
const TELEMETRY_REFETCH_INTERVAL = 60_000;

export function useAppTelemetry(appId: string | undefined): UseQueryResult<TelemetryReport, unknown> & { queryKey: QueryKey } {
  const id = appId ?? "";
  const queryKey = getGetTelemetryQueryKey(id);
  const result = useGetTelemetry<TelemetryReport, unknown>(id, undefined, {
    query: {
      enabled: !!appId,
      queryKey,
      staleTime: TELEMETRY_STALE_TIME,
      refetchInterval: TELEMETRY_REFETCH_INTERVAL,
      refetchIntervalInBackground: false,
    },
  });
  return { ...result, queryKey };
}
