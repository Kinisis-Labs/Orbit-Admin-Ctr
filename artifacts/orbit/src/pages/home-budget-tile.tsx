import { useMemo } from "react";
import { useGetGlobalCostSummary, getGetGlobalCostSummaryQueryKey } from "@workspace/api-client-react";
import { useQueryClient, useQueries } from "@tanstack/react-query";
import { getCost, getGetCostQueryKey } from "@workspace/api-client-react";
import { useApps } from "@/hooks/use-apps";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

const num = (n: number) => new Intl.NumberFormat("en-US").format(n);

function WoWTrendBadge({ trend }: { trend: string | null }) {
  if (!trend) {
    return (
      <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
        <Minus className="h-3 w-3" />
        <span>No trend</span>
      </div>
    );
  }
  
  const isUp = trend.startsWith("+");
  const isFlat = trend === "0%" || trend === "0.0%";
  
  return (
    <div className={`flex items-center gap-1 text-[11px] ${
      isUp ? "text-red-500" : isFlat ? "text-muted-foreground" : "text-emerald-500"
    }`}>
      {isUp ? <TrendingUp className="h-3 w-3" /> : isFlat ? <Minus className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      <span>{trend}</span>
    </div>
  );
}

export function HomeBudgetTile() {
  const { data: apps } = useApps();
  const queryClient = useQueryClient();

  // Fetch cost data for all apps
  const costQueries = useQueries({
    queries: apps?.map(app => ({
      queryKey: getGetCostQueryKey(app.id),
      queryFn: () => getCost(app.id),
      staleTime: 5 * 60 * 1000,
    })) ?? [],
  });

  const { data: globalCostSummary } = useGetGlobalCostSummary({
    query: { queryKey: getGetGlobalCostSummaryQueryKey(), staleTime: 5 * 60 * 1000 },
  });

  // Build cost center data from global cost summary (matches costs page exactly)
  const costCenterData = useMemo(() => {
    const categories = globalCostSummary?.byCategory ?? [];
    return categories.map(cat => ({
      id: `cost-center-${cat.category}`,
      name: cat.category === "Other" ? "Microsoft365" : cat.category,
      category: cat.category,
      monthToDateCost: cat.monthToDate,
      budget: null, // Cost centers don't have individual budgets
      forecast: null, // Cost centers don't have individual forecasts
      environment: "cost-center",
    }));
  }, [globalCostSummary?.byCategory]);

  // Calculate totals using real cost data (matches costs and revenue tabs)
  const totals = useMemo(() => {
    // Sum of all cost centers
    const costCenterTotal = costCenterData.reduce((total, center) => total + center.monthToDateCost, 0);
    
    // Sum of all apps with real cost data
    const appTotal = apps?.reduce((total, app, index) => {
      const costData = costQueries[index]?.data;
      return total + (costData?.monthToDate ?? 0);
    }, 0) ?? 0;
    
    // Sum of all app budgets
    const appBudgetTotal = apps?.reduce((total, app, index) => {
      const costData = costQueries[index]?.data;
      return total + (costData?.budget ?? 0);
    }, 0) ?? 0;
    
    // Sum of all app forecasts
    const appForecastTotal = apps?.reduce((total, app, index) => {
      const costData = costQueries[index]?.data;
      return total + (costData?.forecast ?? 0);
    }, 0) ?? 0;

    const totalSpent = costCenterTotal + appTotal;
    const totalBudget = appBudgetTotal;
    const totalForecast = appForecastTotal;
    const variance = totalBudget > 0 ? totalBudget - totalForecast : null;
    const utilizationPct = totalBudget > 0 ? Math.min((totalSpent / totalBudget) * 100, 100) : null;

    return {
      totalSpent,
      totalBudget,
      totalForecast,
      variance,
      utilizationPct,
      costCenterCount: costCenterData.length,
      appCount: apps?.length ?? 0,
    };
  }, [costCenterData, apps, costQueries]);

  const isLoading = apps === undefined || costQueries.some(q => q.isLoading) || !globalCostSummary;

  return (
    <div className="bg-card border border-border shadow-sm">
      <div className="flex items-center justify-between p-3 border-b border-border">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-muted-foreground" />
          <h3 className="font-semibold text-sm">Budget Overview</h3>
        </div>
        <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <span>{totals.costCenterCount} cost centers</span>
          <span>•</span>
          <span>{totals.appCount} apps</span>
        </div>
      </div>

      <div className="p-3 space-y-3">
        {/* Spent MTD */}
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[11px] text-muted-foreground">Spent MTD</div>
            {isLoading ? (
              <Skeleton className="h-6 w-20 mt-1" />
            ) : (
              <div className="flex items-center gap-2">
                <div className="text-lg font-semibold tabular-nums">{fmt(totals.totalSpent)}</div>
                <WoWTrendBadge trend={globalCostSummary?.wowTrend ?? null} />
              </div>
            )}
          </div>
        </div>

        {/* Total Budget */}
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[11px] text-muted-foreground">Total Budget</div>
            {isLoading ? (
              <Skeleton className="h-6 w-20 mt-1" />
            ) : (
              <div className="text-lg font-semibold tabular-nums">
                {totals.totalBudget > 0 ? fmt(totals.totalBudget) : <span className="text-muted-foreground/50">—</span>}
              </div>
            )}
          </div>
        </div>

        {/* Forecast EOM */}
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[11px] text-muted-foreground">Forecast EOM</div>
            {isLoading ? (
              <Skeleton className="h-6 w-20 mt-1" />
            ) : (
              <div className="text-lg font-semibold tabular-nums">
                {totals.totalForecast > 0 ? fmt(totals.totalForecast) : <span className="text-muted-foreground/50">—</span>}
              </div>
            )}
          </div>
        </div>

        {/* Variance */}
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[11px] text-muted-foreground">Variance</div>
            {isLoading ? (
              <Skeleton className="h-6 w-20 mt-1" />
            ) : (
              <div className={`text-lg font-semibold tabular-nums ${
                totals.variance == null ? "" : totals.variance < 0 ? "text-destructive" : "text-emerald-500"
              }`}>
                {totals.variance == null ? (
                  <span className="text-muted-foreground/50">—</span>
                ) : (
                  fmt(totals.variance)
                )}
              </div>
            )}
          </div>
        </div>

        {/* Utilization */}
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[11px] text-muted-foreground">Budget Utilization</div>
            {isLoading ? (
              <Skeleton className="h-6 w-20 mt-1" />
            ) : (
              <div className="text-lg font-semibold tabular-nums">
                {totals.utilizationPct != null ? `${totals.utilizationPct.toFixed(1)}%` : <span className="text-muted-foreground/50">—</span>}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Cost Centers Summary */}
      <div className="border-t border-border p-3">
        <div className="text-[11px] text-muted-foreground mb-2">Cost Centers (MTD)</div>
        <div className="space-y-1">
          {isLoading ? (
            <Skeleton className="h-4 w-full" />
          ) : (
            costCenterData.slice(0, 3).map(center => (
              <div key={center.id} className="flex items-center justify-between text-[11px]">
                <span className="text-muted-foreground">{center.name}</span>
                <span className="font-medium tabular-nums">{fmt(center.monthToDateCost)}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
