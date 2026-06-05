import { useQueries } from "@tanstack/react-query";
import { useListApps, getGetCostQueryOptions } from "@workspace/api-client-react";
import type { CostReport } from "@workspace/api-client-react";

export function useOverBudgetDays(enabled = true) {
  const { data: apps, isLoading: appsLoading } = useListApps();

  const costQueries = useQueries({
    queries: (enabled && apps ? apps : []).map((app) =>
      getGetCostQueryOptions(app.id)
    ),
  });

  const isLoading = appsLoading || costQueries.some((q) => q.isLoading);

  const overBudgetCount = costQueries.reduce((count, q) => {
    const report = q.data as CostReport | undefined;
    if (!report) return count;
    return report.forecast > report.budget ? count + 1 : count;
  }, 0);

  return { overBudgetCount, isLoading };
}
