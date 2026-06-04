import { useMemo } from "react";
import { useGetGlobalCostSummary, getGetGlobalCostSummaryQueryKey } from "@workspace/api-client-react";

function getDaysInCurrentMonth(): number {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
}

export function useOverBudgetDays(enabled = true) {
  const { data: cost, isLoading } = useGetGlobalCostSummary(undefined, {
    query: {
      queryKey: getGetGlobalCostSummaryQueryKey(),
      enabled,
    },
  });

  const overBudgetCount = useMemo(() => {
    if (!cost?.daily?.length || !cost.budget || cost.budget <= 0) return 0;
    const daysInMonth = getDaysInCurrentMonth();
    const dailyBudget = cost.budget / daysInMonth;
    return cost.daily.filter((d) => d.value > dailyBudget).length;
  }, [cost]);

  return { overBudgetCount, isLoading };
}
