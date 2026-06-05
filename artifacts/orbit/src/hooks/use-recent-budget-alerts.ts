import { useMemo } from "react";
import { useListBudgetAlertLog, getListBudgetAlertLogQueryKey } from "@workspace/api-client-react";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function sevenDaysAgoIso(): string {
  return new Date(Date.now() - SEVEN_DAYS_MS).toISOString();
}

/**
 * Returns a Map<appId, Date> containing the most recent budget alert sentAt
 * for each app that fired an alert within the last 7 days.
 * Only fetched when `enabled` is true (i.e. the user has cost-reader access).
 * Uses the server-side `since` filter so we never miss alerts due to row limits.
 */
export function useRecentBudgetAlerts(enabled = true): Map<string, Date> {
  const since = useMemo(() => sevenDaysAgoIso(), []);

  const { data: entries } = useListBudgetAlertLog(
    { since, limit: 200 },
    {
      query: {
        enabled,
        queryKey: getListBudgetAlertLogQueryKey({ since, limit: 200 }),
        staleTime: 5 * 60 * 1000,
      },
    },
  );

  return useMemo(() => {
    const map = new Map<string, Date>();
    if (!entries) return map;

    for (const entry of entries) {
      const sentAt = new Date(entry.sentAt);
      const existing = map.get(entry.appId);
      if (!existing || sentAt > existing) {
        map.set(entry.appId, sentAt);
      }
    }

    return map;
  }, [entries]);
}
