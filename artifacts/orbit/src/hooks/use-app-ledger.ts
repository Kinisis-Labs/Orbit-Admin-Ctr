import { useGetLedger, getGetLedgerQueryKey } from "@workspace/api-client-react";
import type { LedgerReport } from "@workspace/api-client-react";
import type { UseQueryResult, QueryKey } from "@tanstack/react-query";

const LEDGER_STALE_TIME = 5 * 60 * 1000;

export function useAppLedger(appId: string | undefined): UseQueryResult<LedgerReport, unknown> & { queryKey: QueryKey } {
  const id = appId ?? "";
  const queryKey = getGetLedgerQueryKey(id);
  const result = useGetLedger<LedgerReport, unknown>(id, {
    query: { enabled: !!appId, queryKey, staleTime: LEDGER_STALE_TIME },
  });
  return { ...result, queryKey };
}
