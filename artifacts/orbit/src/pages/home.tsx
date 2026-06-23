import { useState, useMemo } from "react";
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { useGetGlobalCostSummary, getGetGlobalCostSummaryQueryKey, useGetGlobalHealth, getGetGlobalHealthQueryKey, useListUserActivity } from "@workspace/api-client-react";
import { useQueryClient, useQueries, useQuery } from "@tanstack/react-query";
import { getCost, getGetCostQueryKey } from "@workspace/api-client-react";
import { useApps } from "@/hooks/use-apps";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { TrendingUp, TrendingDown, Minus, HeartPulse, ShieldCheck, ChevronRight, DollarSign, BarChart3, Wifi } from "lucide-react";
import { Link } from "wouter";
import { useAuth } from "@/lib/auth";
import { COST_READER_GROUP } from "@/lib/auth-groups";
import { useRecentBudgetAlerts } from "@/hooks/use-recent-budget-alerts";

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

const num = (n: number) => new Intl.NumberFormat("en-US").format(n);

const STATUS_ORDER = ["healthy", "degraded", "unhealthy", "unknown"] as const;
const STATUS_LABELS: Record<string, string> = {
  healthy: "Healthy",
  degraded: "Degraded",
  unhealthy: "Unhealthy",
  unknown: "Unknown",
};
const STATUS_COLORS: Record<string, string> = {
  healthy: "text-emerald-500",
  degraded: "text-amber-500",
  unhealthy: "text-red-500",
  unknown: "text-muted-foreground",
};

const AUTH_LABELS: Record<string, string> = {
  clerk: "Clerk",
  entra: "Entra",
  none: "None",
};

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

function Tile({
  title,
  value,
  sub,
  href,
  icon,
  iconColor = "#7C3AED",
}: {
  title: string;
  value: React.ReactNode;
  sub: string;
  href?: string;
  icon?: React.ReactNode;
  iconColor?: string;
}) {
  const inner = (
    <>
      <div className="flex items-start justify-between gap-2 mb-2">
        {icon && (
          <span
            className="inline-flex items-center justify-center w-8 h-8 rounded-md shrink-0"
            style={{
              background: `${iconColor}22`,
              border: `1px solid ${iconColor}44`,
              color: iconColor,
              boxShadow: `0 0 12px ${iconColor}33`,
            }}
          >
            {icon}
          </span>
        )}
        {href && <ChevronRight className="h-3 w-3 text-muted-foreground/40 shrink-0 mt-1 ml-auto" />}
      </div>
      {value === null ? (
        <Skeleton className="h-7 w-20 mb-1" />
      ) : (
        <div className="text-2xl font-bold text-foreground mb-0.5 tabular-nums">{value}</div>
      )}
      <div className="text-[11px] text-muted-foreground truncate">{title}</div>
      <div className="text-[10px] text-muted-foreground/60 truncate mt-0.5">{sub}</div>
    </>
  );

  const cardClass = `relative overflow-hidden bg-card border border-border p-3 shadow-sm flex flex-col justify-between orbit-card-accent transition-colors`;
  
  if (href) {
    return (
      <Link href={href} className={`${cardClass} hover:bg-muted/40 hover:border-border/80 cursor-pointer`}>
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: `radial-gradient(80% 60% at 0% 0%, ${iconColor}0d 0%, transparent 70%)` }}
        />
        {inner}
      </Link>
    );
  }

  return (
    <div className={cardClass}>
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ background: `radial-gradient(80% 60% at 0% 0%, ${iconColor}0d 0%, transparent 70%)` }}
      />
      {inner}
    </div>
  );
}

function GlobalStrips({
  apps,
  fleetHealth,
  authCounts,
}: {
  apps: any[] | undefined;
  fleetHealth: Record<string, number>;
  authCounts: Record<string, number>;
}) {
  const hasHealthData = Object.keys(fleetHealth).length > 0;
  const hasApps = apps != null;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
      <div className="relative overflow-hidden bg-card border border-border shadow-sm p-3 flex flex-col gap-2 orbit-card-accent">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: "radial-gradient(80% 60% at 0% 0%, #10B98110 0%, transparent 70%)" }}
        />
        <div className="flex items-center gap-2">
          <span
            className="inline-flex items-center justify-center w-6 h-6 rounded-md"
            style={{ background: "#10B98122", border: "1px solid #10B98144", color: "#10B981" }}
          >
            <HeartPulse className="h-3.5 w-3.5" />
          </span>
          <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Fleet Health</div>
        </div>
        <div className="flex items-center gap-4 flex-wrap">
          {!hasApps ? (
            <Skeleton className="h-5 w-48" />
          ) : !hasHealthData ? (
            <span className="text-[12px] text-muted-foreground">Loading…</span>
          ) : (
            STATUS_ORDER.filter((s) => (fleetHealth[s] ?? 0) > 0).map((s) => (
              <div key={s} className="flex items-center gap-1.5">
                <span className={`text-lg font-semibold tabular-nums ${STATUS_COLORS[s]}`}>
                  {fleetHealth[s] ?? 0}
                </span>
                <span className="text-[12px] text-muted-foreground">{STATUS_LABELS[s]}</span>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="relative overflow-hidden bg-card border border-border shadow-sm p-3 flex flex-col gap-2 orbit-card-accent">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: "radial-gradient(80% 60% at 0% 0%, #7C3AED10 0%, transparent 70%)" }}
        />
        <div className="flex items-center gap-2">
          <span
            className="inline-flex items-center justify-center w-6 h-6 rounded-md"
            style={{ background: "#7C3AED22", border: "1px solid #7C3AED44", color: "#A78BFA" }}
          >
            <ShieldCheck className="h-3.5 w-3.5" />
          </span>
          <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Identity Landscape</div>
        </div>
        <div className="flex items-center gap-4 flex-wrap">
          {!hasApps ? (
            <Skeleton className="h-5 w-48" />
          ) : (
            (["clerk", "entra", "none"] as const)
              .filter((t) => (authCounts[t] ?? 0) > 0)
              .map((t) => (
                <div key={t} className="flex items-center gap-1.5">
                  <span className="text-lg font-semibold tabular-nums text-foreground">
                    {authCounts[t] ?? 0}
                  </span>
                  <span className="text-[12px] text-muted-foreground">{AUTH_LABELS[t]}</span>
                </div>
              ))
          )}
        </div>
      </div>
    </div>
  );
}

function UserActivityWidgets() {
  const { data: activity, isLoading, isFetching, dataUpdatedAt } = useListUserActivity({
    query: { queryKey: ["user-activity"], staleTime: 2 * 60 * 1000 },
  });

  const activityData = activity ?? [];
  
  // Calculate totals across all applications (similar to users page)
  const totals = useMemo(() => {
    return activityData.reduce(
      (acc, r) => ({
        members: acc.members + r.totalMembers,
        dau: acc.dau + r.dau,
        wau: acc.wau + r.wau,
        mau: acc.mau + r.mau,
        inactive: acc.inactive + r.inactive30d,
      }),
      { members: 0, dau: 0, wau: 0, mau: 0, inactive: 0 },
    );
  }, [activityData]);

  const stickiness = totals.mau > 0 ? (totals.dau / totals.mau) * 100 : 0;
  const isLoaded = !isLoading && activity != null;
  const isLive = isLoaded && activity.some((a) => a.dataSource === "live");

  return (
    <div className="space-y-2">
      {/* User Activity Tiles */}
      <div className="bg-card border border-border shadow-sm">
        <div className="flex items-center justify-between p-3 border-b border-border">
          <div className="flex items-center gap-2">
            <Wifi className="h-4 w-4 text-muted-foreground" />
            <h3 className="font-semibold text-sm">User Activity Overview</h3>
          </div>
          <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
            {isLive && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm border border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[10px] font-semibold uppercase tracking-wide">
                <Wifi className="h-3 w-3" />
                Live
              </span>
            )}
          </div>
        </div>

        <div className="p-3">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            <UserActivityTile title="Total members" value={isLoading ? null : num(totals.members)} sub="Across all applications" />
            <UserActivityTile title="DAU" value={isLoading ? null : num(totals.dau)} sub="Active in the last 24h" />
            <UserActivityTile title="WAU" value={isLoading ? null : num(totals.wau)} sub="Active in the last 7 days" />
            <UserActivityTile title="MAU" value={isLoading ? null : num(totals.mau)} sub="Active in the last 30 days" />
            <UserActivityTile
              title="DAU / MAU stickiness"
              value={isLoading ? null : `${stickiness.toFixed(1)}%`}
              sub={stickiness >= 20 ? "Healthy (≥20%)" : "Below target"}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function UserActivityTile({ title, value, sub }: { title: string; value: string | null; sub: string }) {
  return (
    <div className="bg-card border border-border p-3 shadow-sm flex flex-col justify-between">
      <div className="text-[12px] text-muted-foreground font-medium mb-1 truncate">{title}</div>
      {value === null ? <Skeleton className="h-7 w-20 mb-1" /> : <div className="text-xl font-semibold tabular-nums mb-1">{value}</div>}
      <div className="text-[11px] text-muted-foreground truncate">{sub}</div>
    </div>
  );
}

function BudgetTile() {
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

  // Fetch budget management data to get cost center budgets
  const { data: budgetManagement } = useQuery({
    queryKey: ["budget-management"],
    queryFn: () => fetch("/api/budget-management").then(r => r.json()),
    staleTime: 2 * 60 * 1000,
  });

  // Build cost center data from global cost summary and budget management data
  const costCenterData = useMemo(() => {
    const categories = globalCostSummary?.byCategory ?? [];
    const budgetByAppId = new Map(budgetManagement?.map((b: any) => [b.appId, b.monthlyBudget]) ?? []);
    
    return categories.map(cat => {
      // Map cost center category to budget app ID
      const budgetAppId = cat.category === "Other" ? "microsoft365" : cat.category.toLowerCase();
      const budget = (budgetByAppId.get(budgetAppId) as number | null) ?? 0;
      
      return {
        id: `cost-center-${cat.category}`,
        name: cat.category === "Other" ? "Microsoft365" : cat.category,
        category: cat.category,
        monthToDateCost: cat.monthToDate,
        budget,
        forecast: null, // Cost centers don't have individual forecasts
        environment: "cost-center",
      };
    });
  }, [globalCostSummary?.byCategory, budgetManagement]);

  // Calculate totals using budget management API as single source of truth for budgets
  const totals = useMemo(() => {
    // Use the correct total from global cost summary (sum of MTD spend across all apps)
    const totalSpent = globalCostSummary?.total ?? 0;
    
    // Sum of ALL budgets from budget management API (both apps and cost centers)
    const totalBudget = budgetManagement?.reduce((total: number, budget: any) => {
      return total + (budget.monthlyBudget ?? 0);
    }, 0) ?? 0;
    
    // Sum of all app forecasts from individual app cost data
    const appForecastTotal = apps?.reduce((total, app, index) => {
      const costData = costQueries[index]?.data;
      return total + (costData?.forecast ?? 0);
    }, 0) ?? 0;

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
  }, [costCenterData, apps, costQueries, globalCostSummary, budgetManagement]);

  const isLoading = apps === undefined || costQueries.some(q => q.isLoading) || !globalCostSummary;

  return (
    <div className="bg-card border border-border shadow-sm">
      <div className="flex items-center justify-between p-3 border-b border-border">
        <div className="flex items-center gap-2">
          <DollarSign className="h-4 w-4 text-muted-foreground" />
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
                <div className="flex items-center gap-2">
                  <span className="font-medium tabular-nums">{fmt(center.monthToDateCost)}</span>
                  {center.budget && center.budget > 0 && (
                    <span className="text-muted-foreground">/ {fmt(center.budget)}</span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function AzureSpendVsBudgetTile() {
  const { data: apps } = useApps();

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

  // Fetch budget management data to get cost center budgets
  const { data: budgetManagement } = useQuery({
    queryKey: ["budget-management"],
    queryFn: () => fetch("/api/budget-management").then(r => r.json()),
    staleTime: 2 * 60 * 1000,
  });

  // Calculate spend vs budget data
  const chartData = useMemo(() => {
    if (!apps || !globalCostSummary) return [];

    // Get cost center data
    const costCenterData = globalCostSummary?.byCategory ?? [];
    
    // Combine apps and cost centers for chart
    const data: Array<{
      name: string;
      type: string;
      spent: number;
      budget: number;
      utilization: number;
    }> = [];
    
    // Add cost centers with actual budgets from budget management API
    const budgetByAppId = new Map(budgetManagement?.map((b: any) => [b.appId, b.monthlyBudget]) ?? []);
    
    costCenterData.forEach(cat => {
      // Map cost center category to budget app ID
      const budgetAppId = cat.category === "Other" ? "microsoft365" : cat.category.toLowerCase();
      const budget = (budgetByAppId.get(budgetAppId) as number | null) ?? 0;
      const utilization = budget > 0 ? Math.min((cat.monthToDate / budget) * 100, 100) : 0;
      
      data.push({
        name: cat.category === "Other" ? "Microsoft365" : cat.category,
        type: "Cost Center",
        spent: cat.monthToDate,
        budget,
        utilization,
      });
    });
    
    // Add apps with budget data (but exclude apps that already exist as cost centers)
    const costCenterNames = new Set(costCenterData.map(cat => 
      cat.category === "Other" ? "Microsoft365" : cat.category
    ));
    
    apps?.forEach((app, index) => {
      const costData = costQueries[index]?.data;
      // Skip if app already exists as a cost center to avoid duplicates (case-insensitive check)
      const appNameLower = app.name.toLowerCase();
      const hasMatchingCostCenter = Array.from(costCenterNames).some(name => 
        name.toLowerCase() === appNameLower
      );
      
      if (costData?.budget && costData?.monthToDate && !hasMatchingCostCenter) {
        const utilization = Math.min((costData.monthToDate / costData.budget) * 100, 100);
        data.push({
          name: app.name,
          type: "App",
          spent: costData.monthToDate,
          budget: costData.budget,
          utilization,
        });
      }
    });
    
    // Sort by spent amount (descending) and take top 8
    return data
      .sort((a, b) => b.spent - a.spent)
      .slice(0, 8);
  }, [apps, costQueries, globalCostSummary, budgetManagement]);

  // Calculate totals
  const totals = useMemo(() => {
    // Use the correct total from global cost summary to avoid double counting
    const totalSpent = globalCostSummary?.total ?? 0;
    
    // Sum budgets from both apps and cost centers
    const totalBudget = chartData
      .reduce((sum, item) => sum + item.budget, 0);
    
    const utilizationPct = totalBudget > 0 ? Math.min((totalSpent / totalBudget) * 100, 100) : 0;
    
    return { totalSpent, totalBudget, utilizationPct };
  }, [chartData, globalCostSummary]);

  const isLoading = apps === undefined || costQueries.some(q => q.isLoading) || !globalCostSummary;

  return (
    <div className="bg-card border border-border shadow-sm">
      <div className="flex items-center justify-between p-3 border-b border-border">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-muted-foreground" />
          <h3 className="font-semibold text-sm">Azure Spend vs Budget</h3>
        </div>
        <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <span>{chartData.length} items</span>
        </div>
      </div>

      <div className="p-3 space-y-4">
        {/* Overall Utilization */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-[11px] text-muted-foreground">Overall Budget Utilization</div>
            {isLoading ? (
              <Skeleton className="h-4 w-12" />
            ) : (
              <div className="text-sm font-semibold tabular-nums">
                {totals.utilizationPct.toFixed(1)}%
              </div>
            )}
          </div>
          {isLoading ? (
            <Skeleton className="h-2 w-full" />
          ) : (
            <Progress 
              value={totals.utilizationPct} 
              className={`h-2 ${
                totals.utilizationPct >= 90 ? "[&>div]:bg-red-500" :
                totals.utilizationPct >= 75 ? "[&>div]:bg-amber-500" :
                "[&>div]:bg-emerald-500"
              }`}
            />
          )}
        </div>

        {/* Bar Chart */}
        <div className="space-y-2">
          <div className="text-[11px] text-muted-foreground">Top Spend Items (MTD)</div>
          {isLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : (
            <ResponsiveContainer width="100%" height={128}>
              <BarChart data={chartData} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis 
                  dataKey="name" 
                  tick={{ fontSize: 10 }}
                  angle={-45}
                  textAnchor="end"
                  height={60}
                  stroke="hsl(var(--muted-foreground))"
                />
                <YAxis 
                  tick={{ fontSize: 10 }}
                  stroke="hsl(var(--muted-foreground))"
                  tickFormatter={(value) => `$${(value / 1000).toFixed(0)}k`}
                />
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "4px",
                    fontSize: "11px"
                  }}
                  formatter={(value: number, name: string) => [
                    fmt(value),
                    name === "spent" ? "Spent" : "Budget"
                  ]}
                />
                <Bar 
                  dataKey="spent" 
                  fill="hsl(var(--primary))"
                  radius={[2, 2, 0, 0]}
                />
                <Bar 
                  dataKey="budget" 
                  fill="hsl(var(--muted))"
                  radius={[2, 2, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Summary Stats */}
        <div className="grid grid-cols-2 gap-3 pt-2 border-t border-border">
          <div className="space-y-1">
            <div className="text-[11px] text-muted-foreground">Total Spent</div>
            {isLoading ? (
              <Skeleton className="h-5 w-16" />
            ) : (
              <div className="text-sm font-semibold tabular-nums text-foreground">
                {fmt(totals.totalSpent)}
              </div>
            )}
          </div>
          <div className="space-y-1">
            <div className="text-[11px] text-muted-foreground">Total Budget</div>
            {isLoading ? (
              <Skeleton className="h-5 w-16" />
            ) : (
              <div className="text-sm font-semibold tabular-nums text-foreground">
                {totals.totalBudget > 0 ? fmt(totals.totalBudget) : "—"}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  const { hasGroup } = useAuth();
  const canSeeCost = hasGroup(COST_READER_GROUP.id);
  const recentAlerts = useRecentBudgetAlerts(canSeeCost);

  const { data: apps, isFetching: appsFetching } = useApps();
  const { data: globalHealth } = useGetGlobalHealth({
    query: { queryKey: getGetGlobalHealthQueryKey(), staleTime: 5 * 60 * 1000 },
  });

  // Calculate fleet health and auth counts
  const fleetHealth = useMemo(() => {
    if (!apps) return {};
    return apps.reduce((acc, app) => {
      const status = app.status || "unknown";
      acc[status] = (acc[status] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
  }, [apps]);

  const authCounts = useMemo(() => {
    if (!apps) return {};
    return apps.reduce((acc, app) => {
      const auth = app.userAuth || "none";
      acc[auth] = (acc[auth] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
  }, [apps]);

  // Calculate app counts for tiles
  const healthyApps = useMemo(() => {
    return apps?.filter(app => app.status === "healthy").length ?? 0;
  }, [apps]);

  const degradedApps = useMemo(() => {
    return apps?.filter(app => app.status === "degraded").length ?? 0;
  }, [apps]);

  const downApps = useMemo(() => {
    return apps?.filter(app => app.status === "unhealthy").length ?? 0;
  }, [apps]);

  const globalAppsOverBudget = useMemo(() => {
    if (!apps) return 0;
    return apps.filter(app => {
      if (app.budget == null || app.forecast == null) return false;
      return app.forecast > app.budget;
    }).length;
  }, [apps]);

  return (
    <div className="space-y-2">
      {/* Fleet Health and Identity Landscape Strips */}
      <GlobalStrips apps={apps} fleetHealth={fleetHealth} authCounts={authCounts} />

      {/* App Status Tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Tile
          title="Healthy Apps"
          value={appsFetching ? null : healthyApps}
          sub="Applications running normally"
          href="/apps"
          icon={<HeartPulse className="h-4 w-4" />}
          iconColor="#10B981"
        />
        <Tile
          title="Degraded Apps"
          value={appsFetching ? null : degradedApps}
          sub="Applications with issues"
          href="/apps"
          icon={<TrendingUp className="h-4 w-4" />}
          iconColor="#F59E0B"
        />
        <Tile
          title="Down Apps"
          value={appsFetching ? null : downApps}
          sub="Applications unavailable"
          href="/apps"
          icon={<TrendingDown className="h-4 w-4" />}
          iconColor="#EF4444"
        />
        <Tile
          title="Over Budget"
          value={appsFetching ? null : globalAppsOverBudget}
          sub={globalAppsOverBudget === 1 ? "App forecast exceeds budget" : "Apps forecast over budget"}
          href="/cost"
          icon={<DollarSign className="h-4 w-4" />}
          iconColor="#F59E0B"
        />
      </div>

      {/* User Activity Widgets */}
      <UserActivityWidgets />

      {/* Budget Overview Tiles */}
      {canSeeCost && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
          <BudgetTile />
          <AzureSpendVsBudgetTile />
        </div>
      )}
    </div>
  );
}
