import { useState, useMemo, useEffect } from "react";
import { AreaChart, Area, ResponsiveContainer, Tooltip as RechartsTooltip } from "recharts";
import { getListAppsQueryKey, getGetCostQueryKey, getCost, getGetAppQueryKey, getApp, useGetGlobalHealth, getGetGlobalHealthQueryKey, useGetGlobalCostSummary, getGetGlobalCostSummaryQueryKey, useGetCost } from "@workspace/api-client-react";
import type { AppSummary, AppDetail } from "@workspace/api-client-react";
import type { UserAuthType } from "@workspace/api-client-react";
import type { DailyCostPoint } from "@/components/daily-spend-utils";
import { useApps } from "@/hooks/use-apps";
import { useApp } from "@/hooks/use-app";
import { useQueryClient, useQueries } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/status-badge";
import { ChevronRight, ChevronUp, ChevronDown, ChevronsUpDown, Bell, TrendingUp, TrendingDown, X, TriangleAlert, Wifi, Smartphone, ExternalLink } from "lucide-react";
import { Link, useLocation, useSearch } from "wouter";
import { Button } from "@/components/ui/button";
import { ScopeSelect } from "@/lib/scope";
import { useScope } from "@/lib/scope-context";
import { RefreshCw } from "lucide-react";
import { AuthBadge } from "@/components/auth-badge";
import { useRecentBudgetAlerts } from "@/hooks/use-recent-budget-alerts";
import { useViolationLog } from "@/hooks/use-violation-log";
import { useAuth } from "@/lib/auth";
import { COST_READER_GROUP } from "@/lib/auth-groups";
import { getBudgetThreshold, DEFAULT_BUDGET_THRESHOLD, BUDGET_THRESHOLDS_STORAGE_KEY } from "@/lib/spend-threshold";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Progress } from "@/components/ui/progress";
import { formatDistanceToNow, format } from "date-fns";
import { detectRecentAnomaly } from "@/pages/cost";
import { useCsvExport } from "@/hooks/use-csv-export";
import { CsvToolbar } from "@/components/csv-toolbar";
import { AdminAccessBadge } from "@/components/admin-access-badge";
import { LiveBadge, DataSourceBadge } from "@/components/data-source-badge";
import { CostDataSourceBadge } from "@/components/cost-data-source-badge";
import { readLastTab } from "@/lib/last-tab";

function useAppAnomalies(apps: AppSummary[] | undefined, enabled: boolean): Set<string> {
  const queries = useQueries({
    queries: (apps ?? []).map((app) => ({
      queryKey: getGetCostQueryKey(app.id),
      queryFn: () => getCost(app.id),
      staleTime: 5 * 60 * 1000,
      enabled,
    })),
  });

  return useMemo(() => {
    const anomalousIds = new Set<string>();
    (apps ?? []).forEach((app, i) => {
      const data = queries[i]?.data;
      if (data?.daily && detectRecentAnomaly(data.daily)) {
        anomalousIds.add(app.id);
      }
    });
    return anomalousIds;
  }, [apps, queries]);
}

function useAppDailySpend(apps: AppSummary[] | undefined, enabled: boolean, days: 7 | 14): Map<string, DailyCostPoint[]> {
  const queries = useQueries({
    queries: (apps ?? []).map((app) => ({
      queryKey: getGetCostQueryKey(app.id),
      queryFn: () => getCost(app.id),
      staleTime: 5 * 60 * 1000,
      enabled,
    })),
  });

  return useMemo(() => {
    const map = new Map<string, DailyCostPoint[]>();
    (apps ?? []).forEach((app, i) => {
      const daily = queries[i]?.data?.daily;
      if (daily && daily.length > 0) {
        map.set(app.id, daily.slice(-days));
      }
    });
    return map;
  }, [apps, queries, days]);
}

function useAllAppDetails(apps: AppSummary[] | undefined, enabled: boolean): AppDetail[] {
  const queries = useQueries({
    queries: (apps ?? []).map((app) => ({
      queryKey: getGetAppQueryKey(app.id),
      queryFn: () => getApp(app.id),
      staleTime: 3 * 60 * 1000,
      enabled,
    })),
  });
  return useMemo(
    () => queries.map((q) => q.data).filter((d): d is AppDetail => d != null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queries],
  );
}

function SparklineTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: DailyCostPoint }>;
}) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  const ts = point.timestamp ? new Date(point.timestamp as string) : null;
  const formatted = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(point.value);
  return (
    <div
      style={{
        backgroundColor: "hsl(var(--card))",
        border: "1px solid hsl(var(--border))",
        borderRadius: 4,
        fontSize: 11,
        padding: "4px 8px",
        whiteSpace: "nowrap",
        boxShadow: "0 1px 4px rgba(0,0,0,0.12)",
        pointerEvents: "none",
        lineHeight: 1.4,
      }}
    >
      {ts && (
        <div style={{ color: "hsl(var(--muted-foreground))", marginBottom: 1 }}>
          {format(ts, "MMM d")}
        </div>
      )}
      <div style={{ color: "hsl(var(--foreground))", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
        {formatted}
      </div>
    </div>
  );
}

function BudgetSparkline({ data, status }: { data: DailyCostPoint[] | undefined; status: BudgetStatus }) {
  if (!data || data.length === 0) {
    return <span className="inline-block w-[72px] h-[24px]" />;
  }

  const color =
    status === "over"
      ? "hsl(0 84% 60%)"
      : status === "warning"
      ? "hsl(38 92% 50%)"
      : "hsl(160 84% 39%)";

  const fillId = `sf-${status}`;

  return (
    <span className="inline-block w-[72px] h-[24px] align-middle">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 2, right: 0, bottom: 2, left: 0 }}>
          <defs>
            <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={color} stopOpacity={0.35} />
              <stop offset="95%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <RechartsTooltip
            content={<SparklineTooltip />}
            cursor={false}
            wrapperStyle={{ zIndex: 50 }}
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={1.5}
            fill={`url(#${fillId})`}
            dot={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </span>
  );
}

function WoWTrendBadge({ trend, label = "Week-over-week spend trend (fleet total)" }: { trend: string | null | undefined; label?: string }) {
  if (!trend) return null;
  const isUp = trend.startsWith("+");
  const isDown = trend.startsWith("-");
  const Icon = isUp ? TrendingUp : isDown ? TrendingDown : null;
  const colorClass = isUp
    ? "text-destructive bg-destructive/10 border-destructive/30"
    : isDown
    ? "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/30"
    : "text-muted-foreground bg-muted border-border";
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm text-[11px] font-medium border ${colorClass}`}
          >
            {Icon && <Icon className="h-3 w-3 shrink-0" />}
            {trend}
          </span>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function deriveTrendFromServices(byService: Array<{ service: string; amount: number; trend?: string | null }>): string | null {
  let totalAmount = 0;
  let weightedPct = 0;
  let hasAny = false;
  for (const svc of byService) {
    if (!svc.trend) continue;
    const pct = parseFloat(svc.trend.replace("%", ""));
    if (!Number.isFinite(pct)) continue;
    totalAmount += svc.amount;
    weightedPct += pct * svc.amount;
    hasAny = true;
  }
  if (!hasAny || totalAmount === 0) return null;
  const avg = weightedPct / totalAmount;
  return (avg >= 0 ? "+" : "") + avg.toFixed(1) + "%";
}


const fmt = (amount: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(amount);

const AUTH_TYPES: { value: UserAuthType; label: string }[] = [
  { value: "clerk", label: "Clerk" },
  { value: "entra", label: "Entra ID" },
  { value: "none", label: "Public" },
];

export default function Home() {
  const { scope } = useScope();
  const isGlobal = scope === "global";
  const { hasGroup } = useAuth();
  const canSeeCost = hasGroup(COST_READER_GROUP.id);
  const recentAlerts = useRecentBudgetAlerts(canSeeCost);

  const queryClient = useQueryClient();

  const { data: apps, isFetching: appsFetching } = useApps();
  const appAnomalies = useAppAnomalies(apps, canSeeCost);

  const allAppDetails = useAllAppDetails(apps, isGlobal);

  const { data: appDetail, isLoading: appDetailLoading, queryKey: appQueryKey } = useApp(isGlobal ? undefined : (scope || undefined));

  const selectedApp = isGlobal ? undefined : apps?.find((a) => a.id === scope);

  const { data: appCost, isLoading: appCostLoading } = useGetCost(
    scope ?? "",
    {},
    { query: { queryKey: getGetCostQueryKey(scope ?? ""), enabled: !isGlobal && !!scope && canSeeCost, staleTime: 5 * 60 * 1000 } },
  );

  const appWoWTrend = useMemo(() => {
    if (!appCost?.byService) return null;
    return deriveTrendFromServices(appCost.byService);
  }, [appCost?.byService]);

  const search = useSearch();
  const [, navigate] = useLocation();

  const VALID_AUTH_TYPES: UserAuthType[] = ["clerk", "entra", "none"];

  const AUTH_FILTER_KEY = "orbit-home-auth-filter";

  const [authFilter, setAuthFilter] = useState<UserAuthType | null>(() => {
    const params = new URLSearchParams(search);
    const urlVal = params.get("auth");
    if (urlVal && (VALID_AUTH_TYPES as string[]).includes(urlVal)) {
      return urlVal as UserAuthType;
    }
    try {
      const stored = localStorage.getItem(AUTH_FILTER_KEY);
      if (stored && (VALID_AUTH_TYPES as string[]).includes(stored)) {
        return stored as UserAuthType;
      }
    } catch {
      // ignore
    }
    return null;
  });

  const BUDGET_BREACH_FILTER_KEY = "orbit:budgetBreachFilter";

  const [budgetBreachFilter, setBudgetBreachFilter] = useState<boolean>(() => {
    const params = new URLSearchParams(search);
    if (params.get("breach") === "1") return true;
    if (params.has("breach")) return false;
    try {
      return localStorage.getItem(BUDGET_BREACH_FILTER_KEY) === "1";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      if (authFilter) {
        localStorage.setItem(AUTH_FILTER_KEY, authFilter);
      } else {
        localStorage.removeItem(AUTH_FILTER_KEY);
      }
    } catch {
      // ignore
    }
    try {
      if (budgetBreachFilter) {
        localStorage.setItem(BUDGET_BREACH_FILTER_KEY, "1");
      } else {
        localStorage.removeItem(BUDGET_BREACH_FILTER_KEY);
      }
    } catch {
      // ignore
    }
    const params = new URLSearchParams(window.location.search);
    if (authFilter) {
      params.set("auth", authFilter);
    } else {
      params.delete("auth");
    }
    if (budgetBreachFilter) {
      params.set("breach", "1");
    } else {
      params.delete("breach");
    }
    const qs = params.toString();
    const next = qs ? `?${qs}` : window.location.pathname;
    navigate(next, { replace: true });
  }, [authFilter, budgetBreachFilter]);

  function toggleBudgetBreachFilter() {
    setBudgetBreachFilter((prev) => !prev);
  }

  function toggleAuthFilter(value: UserAuthType) {
    setAuthFilter(authFilter === value ? null : value);
  }

  function clearAuthFilter() {
    setAuthFilter(null);
  }

  const authCounts = useMemo(() => {
    if (!apps) return {} as Record<UserAuthType, number>;
    return apps.reduce<Record<string, number>>((acc, a) => {
      acc[a.userAuth] = (acc[a.userAuth] ?? 0) + 1;
      return acc;
    }, {});
  }, [apps]);

  function handleRefresh() {
    queryClient.invalidateQueries({ queryKey: getListAppsQueryKey() });
    queryClient.invalidateQueries({ queryKey: appQueryKey });
  }

  const globalTotalAlerts = useMemo(
    () => allAppDetails.reduce((sum, d) => sum + (d.activeAlerts ?? 0), 0),
    [allAppDetails],
  );
  const globalTotalMTD = useMemo(
    () => (apps ?? []).reduce((sum, a) => sum + a.monthToDateCost, 0),
    [apps],
  );
  const globalAppsOverBudget = useMemo(
    () => (apps ?? []).filter((a) => a.forecastOverBudget).length,
    [apps],
  );
  const fleetHealth = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const d of allAppDetails) {
      const s = d.status ?? "unknown";
      counts[s] = (counts[s] ?? 0) + 1;
    }
    return counts;
  }, [allAppDetails]);

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-foreground tracking-tight">
            {isGlobal ? "Dashboard — All Applications" : "Dashboard"}
          </h1>
          <p className="text-[12px] text-muted-foreground mt-0.5">
            {isGlobal
              ? "Organisation-wide fleet overview"
              : selectedApp
              ? `Scoped to ${selectedApp.name}`
              : "Select an application"}
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <AuthFilterPills
            authCounts={authCounts}
            authFilter={authFilter}
            onToggle={toggleAuthFilter}
            onClear={clearAuthFilter}
          />
          <ScopeSelect allowGlobal authFilter={authFilter} />
        </div>
      </div>

      {isGlobal ? (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Tile
              title="Total Apps"
              value={apps == null ? null : apps.length}
              sub="Tracked in this fleet"
            />
            <Tile
              title="Active Alerts"
              value={allAppDetails.length === 0 && apps && apps.length > 0 ? null : globalTotalAlerts}
              sub="Open across all apps"
            />
            <Tile
              title="MTD Spend"
              value={apps == null ? null : fmt(globalTotalMTD)}
              sub="Sum of month-to-date cost"
            />
            <Tile
              title="Apps Over Budget"
              value={apps == null ? null : globalAppsOverBudget}
              sub={globalAppsOverBudget === 1 ? "App forecast exceeds budget" : "Apps forecast over budget"}
            />
          </div>
          <GlobalStrips apps={apps} fleetHealth={fleetHealth} authCounts={authCounts} />
        </>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <Tile
            title="Status"
            value={appDetailLoading ? null : appDetail ? <StatusBadge status={appDetail.status} /> : "—"}
            sub={selectedApp ? `${selectedApp.environment} · ${selectedApp.region}` : ""}
          />
          <Tile title="Active Alerts" value={appDetailLoading ? null : appDetail?.activeAlerts ?? 0} sub="Open on this application" />
          {canSeeCost ? (
            <Tile
              title="MTD Spend"
              value={
                appCostLoading
                  ? null
                  : appCost
                  ? (
                    <span className="flex items-center gap-2 flex-wrap">
                      <span>{fmt(appCost.monthToDate)}</span>
                      <WoWTrendBadge trend={appWoWTrend} label="Week-over-week spend trend (this app)" />
                    </span>
                  )
                  : "—"
              }
              sub="Month-to-date cost"
            />
          ) : (
            <Tile
              title="Region"
              value={selectedApp ? selectedApp.region : "—"}
              sub={selectedApp ? `${selectedApp.environment} environment` : ""}
            />
          )}
          <Tile
            title="Resource Group"
            value={appDetailLoading ? null : appDetail?.resourceGroup ?? "—"}
            sub={
              appDetail?.subscriptionId
                ? `Sub: ${appDetail.subscriptionName ?? appDetail.subscriptionId}`
                : ""
            }
          />
        </div>
      )}

      {canSeeCost && isGlobal && (
        <BudgetSummaryWidget
          apps={apps}
          isFetching={appsFetching}
          recentAlerts={recentAlerts}
          anomalousApps={appAnomalies}
          authFilter={authFilter}
          onAuthBadgeClick={toggleAuthFilter}
          budgetBreachFilter={budgetBreachFilter}
          onToggleBudgetBreach={toggleBudgetBreachFilter}
          onClearAllFilters={() => {
            clearAuthFilter();
            setBudgetBreachFilter(false);
          }}
        />
      )}

      {canSeeCost && !isGlobal && selectedApp && (
        <PerAppBudgetPanel app={selectedApp} recentAlerts={recentAlerts} />
      )}

      {!isGlobal && (
        <div className="bg-card border border-border shadow-sm flex flex-col">
          <div className="flex items-center justify-between p-2 border-b border-border bg-card">
            <div className="flex items-center gap-2 px-2">
              <h2 className="text-sm font-semibold">Application Details — {selectedApp?.name ?? ""}</h2>
              {canSeeCost && scope && recentAlerts.has(scope) && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="inline-flex items-center">
                        <Bell className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      Budget alert sent{" "}
                      {formatDistanceToNow(recentAlerts.get(scope)!, { addSuffix: true })}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
            </div>
            <div className="flex items-center gap-1 pr-2">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs px-2 rounded-sm text-primary hover:text-primary hover:bg-primary/10"
                onClick={handleRefresh}
                disabled={appsFetching}
              >
                <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${appsFetching ? "animate-spin" : ""}`} />
                Refresh
              </Button>
              <Link
                href={`/apps/${scope}?tab=${readLastTab(scope)}`}
                className="text-[12px] text-primary hover:underline"
              >
                Open application →
              </Link>
            </div>
          </div>
          <div className="p-4 text-[13px]">
            {appDetailLoading || !appDetail ? (
              <div className="space-y-2">
                <Skeleton className="h-5 w-1/3" />
                <Skeleton className="h-5 w-1/2" />
                <Skeleton className="h-5 w-1/4" />
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3">
                <Field label="Resource group" value={appDetail.resourceGroup} mono />
                <Field
                  label="Subscription"
                  value={
                    appDetail.subscriptionId ? (
                      <a
                        href={`https://portal.azure.com/#resource/subscriptions/${appDetail.subscriptionId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-primary hover:underline"
                      >
                        {appDetail.subscriptionName ? (
                          <>
                            <span className="font-medium">{appDetail.subscriptionName}</span>
                            <span className="font-mono text-[11px] text-muted-foreground ml-1.5">{appDetail.subscriptionId}</span>
                          </>
                        ) : (
                          <span className="font-mono">{appDetail.subscriptionId}</span>
                        )}
                        <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" />
                      </a>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )
                  }
                />
                <Field label="Location" value={appDetail.region} />
                <Field label="Environment" value={appDetail.environment} />
                <Field
                  label="Auth type"
                  value={
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="inline-flex">
                            <AuthBadge
                              userAuth={appDetail.userAuth}
                              active={authFilter === appDetail.userAuth}
                              onClick={() => toggleAuthFilter(appDetail.userAuth)}
                            />
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>
                          {authFilter === appDetail.userAuth
                            ? "Click to clear auth filter"
                            : "Click to filter apps by this auth type"}
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  }
                />
                <Field label="Owners" value={appDetail.owners?.join(", ") || "Unassigned"} />
                <Field
                  label="Tags"
                  value={
                    Object.entries(appDetail.tags || {}).length > 0
                      ? Object.entries(appDetail.tags || {})
                          .map(([k, v]) => `${k}: ${v}`)
                          .join(" · ")
                      : "None"
                  }
                />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function AuthFilterPills({
  authCounts,
  authFilter,
  onToggle,
  onClear,
}: {
  authCounts: Record<string, number>;
  authFilter: UserAuthType | null;
  onToggle: (v: UserAuthType) => void;
  onClear: () => void;
}) {
  const hasAny = Object.keys(authCounts).length > 0;
  if (!hasAny) return null;

  return (
    <div className="flex items-center gap-1.5">
      {authFilter && (
        <button
          type="button"
          onClick={onClear}
          className="flex items-center gap-0.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
          title="Clear auth filter"
        >
          <X className="h-3 w-3" />
          <span>Clear</span>
        </button>
      )}
      {AUTH_TYPES.filter((t) => (authCounts[t.value] ?? 0) > 0).map((t) => (
        <AuthBadge
          key={t.value}
          userAuth={t.value}
          active={authFilter === t.value}
          onClick={() => onToggle(t.value)}
        />
      ))}
    </div>
  );
}

type BudgetStatus = "over" | "warning" | "ok" | "none";
type BudgetSortCol = "name" | "auth" | "spent" | "budget" | "forecast" | "utilization" | "status" | "wow" | "trend";
type SortDir = "asc" | "desc";

const BUDGET_STATUS_RANK: Record<BudgetStatus, number> = { over: 0, warning: 1, ok: 2, none: 3 };

function budgetStatus(app: AppSummary, threshold: number = DEFAULT_BUDGET_THRESHOLD): BudgetStatus {
  if (app.budget == null) return "none";
  if (app.forecastOverBudget) return "over";
  const pct = app.budget > 0 ? (app.monthToDateCost / app.budget) * 100 : 0;
  if (pct >= threshold) return "warning";
  return "ok";
}

function StatusPill({ status }: { status: BudgetStatus }) {
  if (status === "over") {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm text-[10px] font-semibold uppercase tracking-wide bg-red-500/10 text-red-500 border border-red-500/30">
        Over forecast
      </span>
    );
  }
  if (status === "warning") {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm text-[10px] font-semibold uppercase tracking-wide bg-amber-500/10 text-amber-500 border border-amber-500/30">
        ≥ 80%
      </span>
    );
  }
  if (status === "ok") {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm text-[10px] font-semibold uppercase tracking-wide bg-emerald-500/10 text-emerald-500 border border-emerald-500/30">
        On track
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm text-[10px] font-medium uppercase tracking-wide bg-muted text-muted-foreground border border-border">
      No budget
    </span>
  );
}

type EnvFilter = "all" | "prod" | "staging" | "dev";

function FilterButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-1.5 py-0.5 rounded-sm text-[11px] font-medium border transition-colors ${
        active
          ? "bg-primary/10 text-primary border-primary/30"
          : "bg-transparent text-muted-foreground border-border hover:bg-muted/60 hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function BudgetTh({
  col,
  sortCol,
  sortDir,
  onSort,
  children,
  align = "left",
  className,
}: {
  col: BudgetSortCol;
  sortCol: BudgetSortCol;
  sortDir: SortDir;
  onSort: (col: BudgetSortCol) => void;
  children: React.ReactNode;
  align?: "left" | "right";
  className?: string;
}) {
  const active = sortCol === col;
  const Icon = active ? (sortDir === "asc" ? ChevronUp : ChevronDown) : ChevronsUpDown;
  return (
    <th
      className={`font-medium text-muted-foreground py-2 cursor-pointer select-none hover:text-foreground transition-colors ${align === "right" ? "text-right" : "text-left"} ${className ?? ""}`}
      onClick={() => onSort(col)}
    >
      <span className={`inline-flex items-center gap-0.5 ${align === "right" ? "flex-row-reverse" : ""}`}>
        <Icon className={`h-3 w-3 shrink-0 ${active ? "text-foreground" : "opacity-40"}`} />
        {children}
      </span>
    </th>
  );
}

function parseTrend(trend: string | undefined | null): number {
  if (!trend) return -Infinity;
  const n = parseFloat(trend.replace(/[^0-9.\-+]/g, ""));
  return isNaN(n) ? -Infinity : n;
}

function BudgetSummaryWidget({
  apps,
  isFetching,
  recentAlerts,
  anomalousApps,
  authFilter,
  onAuthBadgeClick,
  budgetBreachFilter,
  onToggleBudgetBreach,
  onClearAllFilters,
}: {
  apps: AppSummary[] | undefined;
  isFetching: boolean;
  recentAlerts: Map<string, Date>;
  anomalousApps: Set<string>;
  authFilter: UserAuthType | null;
  onAuthBadgeClick: (v: UserAuthType) => void;
  budgetBreachFilter: boolean;
  onToggleBudgetBreach: () => void;
  onClearAllFilters: () => void;
}) {
  const { setScope } = useScope();
  const [, navigate] = useLocation();

  const { entries: violationEntries } = useViolationLog();
  const unseenViolationsByApp = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of violationEntries) {
      if (!e.seen && !e.dismissed) {
        map.set(e.appId, (map.get(e.appId) ?? 0) + 1);
      }
    }
    return map;
  }, [violationEntries]);

  const [thresholdVersion, setThresholdVersion] = useState(0);
  useEffect(() => {
    const refresh = () => setThresholdVersion((v) => v + 1);
    const onStorage = (e: StorageEvent) => {
      if (e.key === BUDGET_THRESHOLDS_STORAGE_KEY) refresh();
    };
    window.addEventListener("orbit-budget-threshold-changed", refresh);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("orbit-budget-threshold-changed", refresh);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const [sortCol, setSortCol] = useState<BudgetSortCol>("status");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  function handleSort(col: BudgetSortCol) {
    if (sortCol === col) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortCol(col);
      setSortDir("asc");
    }
  }

  const [sparklineRange, setSparklineRange] = useState<7 | 14>(() => {
    try {
      const stored = localStorage.getItem("orbit-budget-sparkline-range");
      return stored === "7" ? 7 : 14;
    } catch {
      return 14;
    }
  });

  function handleSparklineRange(days: 7 | 14) {
    setSparklineRange(days);
    try {
      localStorage.setItem("orbit-budget-sparkline-range", String(days));
    } catch {
      // ignore
    }
  }

  const dailySpend = useAppDailySpend(apps, true, sparklineRange);

  const { data: globalCostSummary } = useGetGlobalCostSummary({
    query: { queryKey: getGetGlobalCostSummaryQueryKey(), staleTime: 5 * 60 * 1000 },
  });
  const trendByAppId = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of globalCostSummary?.byApp ?? []) {
      if (item.trend) map.set(item.appId, item.trend);
    }
    return map;
  }, [globalCostSummary?.byApp]);

  const [envFilter, setEnvFilterRaw] = useState<EnvFilter>(() => {
    try {
      const stored = localStorage.getItem("orbit-budget-env-filter");
      if (stored === "prod" || stored === "staging" || stored === "dev") return stored;
    } catch {
      // ignore
    }
    return "all";
  });

  function setEnvFilter(value: EnvFilter) {
    setEnvFilterRaw(value);
    try {
      if (value === "all") {
        localStorage.removeItem("orbit-budget-env-filter");
      } else {
        localStorage.setItem("orbit-budget-env-filter", value);
      }
    } catch {
      // ignore
    }
  }

  const filteredApps = useMemo(() => {
    if (!apps) return undefined;
    const filtered = apps.filter((a) => {
      if (authFilter !== null && a.userAuth !== authFilter) return false;
      if (envFilter !== "all" && a.environment !== envFilter) return false;
      if (budgetBreachFilter && !a.forecastOverBudget) return false;
      return true;
    });
    return [...filtered].sort((a, b) => {
      let diff = 0;
      if (sortCol === "status") {
        diff =
          BUDGET_STATUS_RANK[budgetStatus(a, getBudgetThreshold(a.id))] -
          BUDGET_STATUS_RANK[budgetStatus(b, getBudgetThreshold(b.id))];
        if (diff === 0) diff = b.monthToDateCost - a.monthToDateCost;
      } else if (sortCol === "name") {
        diff = a.name.localeCompare(b.name);
      } else if (sortCol === "auth") {
        diff = a.userAuth.localeCompare(b.userAuth);
      } else if (sortCol === "spent") {
        diff = a.monthToDateCost - b.monthToDateCost;
      } else if (sortCol === "budget") {
        if (a.budget == null && b.budget == null) diff = 0;
        else if (a.budget == null) diff = 1;
        else if (b.budget == null) diff = -1;
        else diff = a.budget - b.budget;
      } else if (sortCol === "forecast") {
        if (a.forecast == null && b.forecast == null) diff = 0;
        else if (a.forecast == null) diff = 1;
        else if (b.forecast == null) diff = -1;
        else diff = a.forecast - b.forecast;
      } else if (sortCol === "utilization") {
        const pctA = a.budget != null && a.budget > 0 ? (a.monthToDateCost / a.budget) * 100 : -1;
        const pctB = b.budget != null && b.budget > 0 ? (b.monthToDateCost / b.budget) * 100 : -1;
        diff = pctA - pctB;
      } else if (sortCol === "wow") {
        diff = parseTrend(trendByAppId.get(a.id)) - parseTrend(trendByAppId.get(b.id));
      } else if (sortCol === "trend") {
        const seriesA = dailySpend.get(a.id);
        const seriesB = dailySpend.get(b.id);
        const lastA = seriesA && seriesA.length > 0 ? seriesA[seriesA.length - 1].value : -Infinity;
        const lastB = seriesB && seriesB.length > 0 ? seriesB[seriesB.length - 1].value : -Infinity;
        diff = lastA - lastB;
      }
      return sortDir === "asc" ? diff : -diff;
    });
  }, [apps, authFilter, envFilter, budgetBreachFilter, thresholdVersion, sortCol, sortDir, trendByAppId, dailySpend]);

  function goToCost(appId: string) {
    setScope(appId);
    if (isFiltered && filterSummary) {
      navigate(`/cost?from=${encodeURIComponent(filterSummary)}`);
    } else {
      navigate("/cost");
    }
  }

  const overCount = filteredApps?.filter((a) => a.forecastOverBudget).length ?? 0;
  const warningCount = useMemo(() => {
    return filteredApps?.filter((a) => {
      if (a.forecastOverBudget || a.budget == null) return false;
      const pct = a.budget > 0 ? (a.monthToDateCost / a.budget) * 100 : 0;
      return pct >= getBudgetThreshold(a.id);
    }).length ?? 0;
  }, [filteredApps, thresholdVersion]);

  const totalSpentMTD = filteredApps?.reduce((s, a) => s + a.monthToDateCost, 0) ?? 0;
  const topSpenderId = filteredApps && filteredApps.length >= 2
    ? filteredApps.reduce((top, a) => a.monthToDateCost > top.monthToDateCost ? a : top, filteredApps[0]).id
    : null;
  const budgetedApps = filteredApps?.filter((a) => a.budget != null) ?? [];
  const totalBudget = budgetedApps.reduce((s, a) => s + (a.budget ?? 0), 0);
  const totalForecast = budgetedApps.reduce((s, a) => s + (a.forecast ?? 0), 0);
  const totalVariance = totalBudget > 0 ? totalBudget - totalForecast : null;
  const budgetedAppCount = budgetedApps.length;
  const totalUtilizationPct = totalBudget > 0 ? Math.min((totalSpentMTD / totalBudget) * 100, 100) : null;
  const totalUtilizationStatus: BudgetStatus =
    totalBudget === 0
      ? "none"
      : totalVariance != null && totalVariance < 0
      ? "over"
      : totalUtilizationPct != null && totalUtilizationPct >= 80
      ? "warning"
      : "ok";

  const appsWithSource = filteredApps?.filter((a) => a.costDataSource != null) ?? [];
  const liveCount = appsWithSource.filter((a) => a.costDataSource === "live").length;
  const totalSourced = appsWithSource.length;
  const allLive = liveCount > 0 && liveCount === totalSourced;
  const someLive = liveCount > 0 && liveCount < totalSourced;
  const liveAppNames = appsWithSource.filter((a) => a.costDataSource === "live").map((a) => a.name);
  const estimatedAppNames = appsWithSource.filter((a) => a.costDataSource !== "live").map((a) => a.name);
  const costLiveBadge = allLive ? (
    <LiveBadge className="mt-1.5" />
  ) : someLive ? (
    <LiveBadge
      label={`${liveCount}/${totalSourced} Live`}
      className="mt-1.5"
      liveApps={liveAppNames}
      estimatedApps={estimatedAppNames}
    />
  ) : null;

  const { data: globalHealth } = useGetGlobalHealth({
    query: { queryKey: getGetGlobalHealthQueryKey(), staleTime: 5 * 60 * 1000 },
  });
  const globalCostSource = globalHealth?.costDataSource;
  const globalCostSourceBadge =
    globalCostSource && globalCostSource !== "mock" ? (
      <div className="mt-1.5">
        <DataSourceBadge dataSource={globalCostSource} dataAsOf={globalCostSummary?.dataAsOf} label="Azure Cost Management" />
      </div>
    ) : null;

  const isFiltered = authFilter !== null || envFilter !== "all" || budgetBreachFilter;

  function clearAllFilters() {
    setEnvFilter("all");
    onClearAllFilters();
  }

  const filterSummaryParts: string[] = [];
  if (authFilter !== null) filterSummaryParts.push(authFilter.charAt(0).toUpperCase() + authFilter.slice(1));
  if (envFilter !== "all") filterSummaryParts.push(envFilter.charAt(0).toUpperCase() + envFilter.slice(1));
  if (budgetBreachFilter) filterSummaryParts.push("Budget breach");
  const filterSummary = filterSummaryParts.join(" · ");

  const appCount = filteredApps?.length ?? apps?.length;

  const csvHeaders = ["Application", "Environment", "Auth", "Spent MTD (USD)", "Budget (USD)", "Forecast (USD)", "Utilization %", "Status", "Budget breach", "WoW Trend"];
  const csvRows = useMemo(() => {
    if (!filteredApps) return null;
    const appRows = filteredApps.map((app) => {
      const status = budgetStatus(app, getBudgetThreshold(app.id));
      const pct = app.budget != null && app.budget > 0
        ? Math.round(Math.min((app.monthToDateCost / app.budget) * 100, 100))
        : null;
      return [
        app.name,
        app.environment,
        app.userAuth,
        app.monthToDateCost.toFixed(2),
        app.budget != null ? app.budget.toFixed(2) : "",
        app.forecast != null ? app.forecast.toFixed(2) : "",
        pct != null ? String(pct) : "",
        status,
        app.forecastOverBudget ? "Yes" : "No",
        trendByAppId.get(app.id) ?? "",
      ];
    });

    const unbudgetedCount = filteredApps.filter((a) => a.budget == null).length;
    const totalRow = [
      "Total",
      "",
      "",
      totalSpentMTD.toFixed(2),
      totalBudget > 0 ? totalBudget.toFixed(2) : "",
      totalBudget > 0 ? totalForecast.toFixed(2) : "",
      totalUtilizationPct != null ? String(Math.round(totalUtilizationPct)) : "",
      totalUtilizationStatus,
      "",
      globalCostSummary?.wowTrend ?? "",
    ];

    const rows: string[][] = [...appRows, totalRow];
    if (unbudgetedCount > 0) {
      rows.push([
        `Note: ${unbudgetedCount} app${unbudgetedCount === 1 ? "" : "s"} not included in budget/forecast totals (no budget set)`,
        "", "", "", "", "", "", "", "", "",
      ]);
    }
    return rows;
  }, [filteredApps, totalSpentMTD, totalBudget, totalForecast, totalUtilizationPct, totalUtilizationStatus, trendByAppId, globalCostSummary?.wowTrend]);

  const { copied, disabled: csvDisabled, handleExport, handleCopy } = useCsvExport(csvRows, csvHeaders, "app-services-budget");

  return (
    <div className="bg-card border border-border shadow-sm flex flex-col">
      <div className="flex items-center justify-between p-2 border-b border-border bg-card">
        <div className="flex items-center gap-2 px-2">
          <TrendingUp className="h-3.5 w-3.5 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Budget Status</h2>
          {apps && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded-sm text-[10px] font-medium bg-muted text-muted-foreground border border-border">
              {appCount} {appCount === 1 ? "app" : "apps"}
            </span>
          )}
          {isFiltered && filterSummary && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded-sm text-[10px] font-medium bg-primary/10 text-primary border border-primary/30">
              {filterSummary}
            </span>
          )}
          {isFiltered && (
            <button
              type="button"
              onClick={clearAllFilters}
              className="flex items-center gap-0.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
              title="Clear all filters"
            >
              <X className="h-3 w-3" />
              <span>Clear all</span>
            </button>
          )}
          {overCount > 0 && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded-sm text-[10px] font-semibold bg-red-500/10 text-red-500 border border-red-500/30">
              {overCount} over forecast
            </span>
          )}
          {overCount === 0 && warningCount > 0 && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded-sm text-[10px] font-semibold bg-amber-500/10 text-amber-500 border border-amber-500/30">
              {warningCount} near limit
            </span>
          )}
          <AdminAccessBadge />
        </div>
        <div className="flex items-center gap-2 pr-2">
          <span className="text-[11px] text-muted-foreground">Month to date</span>
          <div className="flex items-center gap-0.5">
            <FilterButton active={sparklineRange === 7} onClick={() => handleSparklineRange(7)}>7d</FilterButton>
            <FilterButton active={sparklineRange === 14} onClick={() => handleSparklineRange(14)}>14d</FilterButton>
          </div>
          <CsvToolbar
            handleExport={handleExport}
            handleCopy={handleCopy}
            disabled={csvDisabled}
            copied={copied}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 border-b border-border divide-x divide-border">
        {/* Spent MTD */}
        <div className="p-3 flex flex-col gap-0.5">
          <div className="text-[11px] text-muted-foreground font-medium">Spent MTD</div>
          {!filteredApps ? (
            <Skeleton className="h-6 w-20 mt-1" />
          ) : (
            <div className="flex items-center gap-2 flex-wrap">
              <div className="text-lg font-semibold tabular-nums">{fmt(totalSpentMTD)}</div>
              <WoWTrendBadge trend={globalCostSummary?.wowTrend ?? null} />
            </div>
          )}
          <div className="text-[10px] text-muted-foreground mt-0.5">
            {filteredApps ? `Across ${filteredApps.length} app${filteredApps.length !== 1 ? "s" : ""}` : ""}
          </div>
          {globalCostSourceBadge}
        </div>

        {/* Total Budget */}
        <div className="p-3 flex flex-col gap-0.5">
          <div className="text-[11px] text-muted-foreground font-medium">Total Budget</div>
          {!filteredApps ? (
            <Skeleton className="h-6 w-20 mt-1" />
          ) : (
            <div className="text-lg font-semibold tabular-nums">
              {totalBudget > 0 ? fmt(totalBudget) : <span className="text-muted-foreground/50">—</span>}
            </div>
          )}
          {costLiveBadge}
        </div>

        {/* Forecast EOM */}
        <div className="p-3 flex flex-col gap-0.5">
          <div className="text-[11px] text-muted-foreground font-medium">Forecast EOM</div>
          {!filteredApps ? (
            <Skeleton className="h-6 w-20 mt-1" />
          ) : (
            <div className="text-lg font-semibold tabular-nums">
              {totalForecast > 0 ? fmt(totalForecast) : <span className="text-muted-foreground/50">—</span>}
            </div>
          )}
          {costLiveBadge}
        </div>

        {/* Variance */}
        <div className="p-3 flex flex-col gap-0.5">
          <div className="text-[11px] text-muted-foreground font-medium">Variance</div>
          {!filteredApps ? (
            <Skeleton className="h-6 w-20 mt-1" />
          ) : (
            <div className={`text-lg font-semibold tabular-nums ${totalVariance == null ? "" : totalVariance < 0 ? "text-destructive" : "text-emerald-500"}`}>
              {totalVariance == null ? (
                <span className="text-muted-foreground/50">—</span>
              ) : (
                fmt(totalVariance)
              )}
            </div>
          )}
          <div className="text-[10px] text-muted-foreground mt-0.5">
            {totalVariance == null ? "" : totalVariance >= 0 ? "Remaining headroom" : "Over forecast"}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3 px-4 py-1.5 border-b border-border bg-muted/20 flex-wrap">
        <div className="flex items-center gap-1">
          <span className="text-[11px] text-muted-foreground font-medium mr-0.5">Env:</span>
          <FilterButton active={envFilter === "all"} onClick={() => setEnvFilter("all")}>All</FilterButton>
          <FilterButton active={envFilter === "prod"} onClick={() => setEnvFilter("prod")}>Prod</FilterButton>
          <FilterButton active={envFilter === "staging"} onClick={() => setEnvFilter("staging")}>Staging</FilterButton>
          <FilterButton active={envFilter === "dev"} onClick={() => setEnvFilter("dev")}>Dev</FilterButton>
        </div>
        <div className="w-px h-3.5 bg-border" />
        <button
          type="button"
          onClick={onToggleBudgetBreach}
          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm text-[11px] font-medium border transition-colors ${
            budgetBreachFilter
              ? "bg-red-500/10 text-red-500 border-red-500/30"
              : "bg-transparent text-muted-foreground border-border hover:bg-muted/60 hover:text-foreground"
          }`}
        >
          <TriangleAlert className={`h-3 w-3 ${budgetBreachFilter ? "text-red-500" : ""}`} />
          Budget breach
        </button>
      </div>

      {someLive && filteredApps && (
        <div className="flex items-center gap-1.5 px-4 py-1.5 border-b border-border bg-muted/10 text-[11px] text-muted-foreground">
          <span>
            {liveCount} of {totalSourced} app{totalSourced !== 1 ? "s" : ""} showing live data
          </span>
          <span className="text-border">·</span>
          <span>{estimatedAppNames.length} estimated</span>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <BudgetTh col="name" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} className="px-4 w-[180px]">Application</BudgetTh>
              <BudgetTh col="auth" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} className="px-3">Auth</BudgetTh>
              <BudgetTh col="spent" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} align="right" className="px-3">Spent MTD</BudgetTh>
              <BudgetTh col="budget" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} align="right" className="px-3">Budget</BudgetTh>
              <BudgetTh col="forecast" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} align="right" className="px-3">Forecast</BudgetTh>
              <BudgetTh col="utilization" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} className="px-3 w-[120px]">Utilization</BudgetTh>
              <BudgetTh col="status" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} className="px-3">Status</BudgetTh>
              <BudgetTh col="wow" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} align="right" className="px-3 w-[60px]">WoW</BudgetTh>
              <BudgetTh col="trend" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} className="px-3 w-[88px]">{sparklineRange}d trend</BudgetTh>
              <th className="w-8 px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {!filteredApps ? (
              Array.from({ length: 3 }).map((_, i) => (
                <tr key={i} className="border-b border-border last:border-0">
                  <td className="px-4 py-2.5"><Skeleton className="h-4 w-28" /></td>
                  <td className="px-3 py-2.5"><Skeleton className="h-4 w-12" /></td>
                  <td className="px-3 py-2.5 text-right"><Skeleton className="h-4 w-16 ml-auto" /></td>
                  <td className="px-3 py-2.5 text-right"><Skeleton className="h-4 w-16 ml-auto" /></td>
                  <td className="px-3 py-2.5 text-right"><Skeleton className="h-4 w-16 ml-auto" /></td>
                  <td className="px-3 py-2.5"><Skeleton className="h-3 w-full" /></td>
                  <td className="px-3 py-2.5"><Skeleton className="h-5 w-16" /></td>
                  <td className="px-3 py-2.5 text-right"><Skeleton className="h-4 w-10 ml-auto" /></td>
                  <td className="px-3 py-2.5"><Skeleton className="h-6 w-[72px]" /></td>
                  <td className="px-2 py-2.5" />
                </tr>
              ))
            ) : filteredApps.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-4 py-6 text-center text-[13px] text-muted-foreground">
                  No apps match the active filters.
                </td>
              </tr>
            ) : (
              filteredApps.map((app) => {
                const threshold = getBudgetThreshold(app.id);
                const status = budgetStatus(app, threshold);
                const pct = app.budget != null && app.budget > 0
                  ? Math.min((app.monthToDateCost / app.budget) * 100, 100)
                  : null;
                const hasAlert = recentAlerts.has(app.id);
                const hasAnomaly = anomalousApps.has(app.id);
                const unseenViolations = unseenViolationsByApp.get(app.id) ?? 0;

                return (
                  <tr
                    key={app.id}
                    className="border-b border-border last:border-0 hover:bg-muted/30 cursor-pointer transition-colors"
                    onClick={() => goToCost(app.id)}
                  >
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium text-foreground truncate max-w-[140px]">{app.name}</span>
                        {app.androidPackage && (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <a
                                  href={`https://play.google.com/store/apps/details?id=${app.androidPackage}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center shrink-0 text-[#3DDC84] hover:opacity-70 transition-opacity"
                                  onClick={(e) => e.stopPropagation()}
                                  aria-label="View on Google Play"
                                >
                                  <Smartphone className="h-3 w-3" />
                                </a>
                              </TooltipTrigger>
                              <TooltipContent>View on Google Play</TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}
                        {app.iosBundle && (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <a
                                  href={`https://apps.apple.com/app/${app.iosBundle}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center shrink-0 text-muted-foreground hover:opacity-70 transition-opacity"
                                  onClick={(e) => e.stopPropagation()}
                                  aria-label="View on App Store"
                                >
                                  <Smartphone className="h-3 w-3" />
                                </a>
                              </TooltipTrigger>
                              <TooltipContent>View on App Store</TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}
                        {hasAnomaly && (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="inline-flex items-center shrink-0">
                                  <TriangleAlert className="h-3 w-3 text-amber-500" />
                                </span>
                              </TooltipTrigger>
                              <TooltipContent>
                                Cost anomaly detected in the last 3 days — click to view
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}
                        {hasAlert && (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Bell className="h-3 w-3 text-amber-500 shrink-0" />
                              </TooltipTrigger>
                              <TooltipContent>
                                Budget alert sent {formatDistanceToNow(recentAlerts.get(app.id)!, { addSuffix: true })}
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}
                        {unseenViolations > 0 && (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full text-[9px] font-bold bg-red-500 text-white shrink-0 tabular-nums">
                                  {unseenViolations > 99 ? "99+" : unseenViolations}
                                </span>
                              </TooltipTrigger>
                              <TooltipContent>
                                {unseenViolations} unseen infra threshold {unseenViolations === 1 ? "violation" : "violations"} — open app to review
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}
                      </div>
                    </td>
                    <td
                      className="px-3 py-2.5"
                      onClick={(e) => { e.stopPropagation(); onAuthBadgeClick(app.userAuth); }}
                    >
                      <AuthBadge
                        userAuth={app.userAuth}
                        active={authFilter === app.userAuth}
                        onClick={() => onAuthBadgeClick(app.userAuth)}
                      />
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-foreground">
                      <div className="flex items-center justify-end gap-1.5">
                        {app.costDataSource && app.costDataSource !== "mock" && (
                          <CostDataSourceBadge dataSource={app.costDataSource} />
                        )}
                        <div className="flex flex-col items-end gap-0.5">
                          {fmt(app.monthToDateCost)}
                          {filteredApps.length >= 2 && totalSpentMTD > 0 && (() => {
                            const sharePct = Math.round((app.monthToDateCost / totalSpentMTD) * 100);
                            const isTop = app.id === topSpenderId;
                            return (
                              <div className="flex items-center gap-1">
                                {isTop && (
                                  <TooltipProvider>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <span className="inline-flex items-center px-1 py-0 rounded-sm bg-amber-500/10 border border-amber-500/30 text-amber-500 text-[9px] font-semibold uppercase tracking-wide leading-4 cursor-default">top</span>
                                      </TooltipTrigger>
                                      <TooltipContent>Highest spend this month</TooltipContent>
                                    </Tooltip>
                                  </TooltipProvider>
                                )}
                                <TooltipProvider>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <div className="flex items-center gap-1 cursor-default">
                                        <div className="w-16 h-1 bg-muted rounded-full overflow-hidden">
                                          <div
                                            className={`h-full rounded-full ${isTop ? "bg-amber-500" : "bg-primary/60"}`}
                                            style={{ width: `${sharePct}%` }}
                                          />
                                        </div>
                                        <span className={`text-[10px] tabular-nums ${isTop ? "text-amber-500 font-semibold" : "text-muted-foreground"}`}>{sharePct}%</span>
                                      </div>
                                    </TooltipTrigger>
                                    <TooltipContent>{sharePct}% of total MTD spend</TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                              </div>
                            );
                          })()}
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                      {app.budget != null ? fmt(app.budget) : <span className="text-muted-foreground/50">—</span>}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                      {app.forecast != null ? fmt(app.forecast) : <span className="text-muted-foreground/50">—</span>}
                    </td>
                    <td className="px-3 py-2.5">
                      {pct !== null ? (
                        <div className="flex items-center gap-2">
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Progress
                                  value={pct}
                                  className={`h-1.5 w-20 cursor-default ${
                                    status === "over"
                                      ? "[&>div]:bg-red-500"
                                      : status === "warning"
                                      ? "[&>div]:bg-amber-500"
                                      : "[&>div]:bg-emerald-500"
                                  }`}
                                />
                              </TooltipTrigger>
                              <TooltipContent>Alert at {threshold}% · {Math.round(pct)}% utilized</TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                          <span className="text-[11px] text-muted-foreground tabular-nums">{Math.round(pct)}%</span>
                        </div>
                      ) : (
                        <span className="text-muted-foreground/50 text-[11px]">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1.5">
                        {status === "over" && (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="inline-flex shrink-0">
                                  <TriangleAlert className="h-3 w-3 text-amber-500" />
                                </span>
                              </TooltipTrigger>
                              <TooltipContent>Forecast exceeds budget cap</TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}
                        <StatusPill status={status} />
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums" onClick={(e) => e.stopPropagation()}>
                      {(() => {
                        const trend = trendByAppId.get(app.id) ?? null;
                        if (!trend) return <span className="text-muted-foreground/50 text-[11px]">—</span>;
                        const isPos = trend.startsWith("+");
                        const isNeg = trend.startsWith("-");
                        const cls = isPos
                          ? "text-red-500"
                          : isNeg
                          ? "text-emerald-500"
                          : "text-muted-foreground";
                        return (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className={`font-mono text-[11px] font-medium ${cls}`}>{trend}</span>
                              </TooltipTrigger>
                              <TooltipContent>Week-over-week cost change</TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        );
                      })()}
                    </td>
                    <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                      <BudgetSparkline data={dailySpend.get(app.id)} status={status} />
                    </td>
                    <td className="px-2 py-2.5 text-muted-foreground/40">
                      <ChevronRight className="h-3.5 w-3.5" />
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
          {filteredApps && filteredApps.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-border bg-muted/40">
                <td className="px-4 py-2.5">
                  <div className="flex flex-col gap-0.5">
                    <span className="font-semibold text-foreground">Total</span>
                    {budgetedAppCount < filteredApps.length && (
                      <span className="text-[10px] text-muted-foreground">
                        {budgetedAppCount} of {filteredApps.length} apps budgeted
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-3 py-2.5" />
                <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-foreground">
                  {fmt(totalSpentMTD)}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-foreground">
                  {totalBudget > 0 ? fmt(totalBudget) : <span className="text-muted-foreground/50">—</span>}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-foreground">
                  {totalForecast > 0 ? fmt(totalForecast) : <span className="text-muted-foreground/50">—</span>}
                </td>
                <td className="px-3 py-2.5">
                  {totalUtilizationPct !== null ? (
                    <div className="flex items-center gap-2">
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Progress
                              value={totalUtilizationPct}
                              className={`h-1.5 w-20 cursor-default ${
                                totalUtilizationStatus === "over"
                                  ? "[&>div]:bg-red-500"
                                  : totalUtilizationStatus === "warning"
                                  ? "[&>div]:bg-amber-500"
                                  : "[&>div]:bg-emerald-500"
                              }`}
                            />
                          </TooltipTrigger>
                          <TooltipContent>
                            {Math.round(totalUtilizationPct)}% of combined budget spent MTD
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                      <span className="text-[11px] text-muted-foreground tabular-nums font-semibold">
                        {Math.round(totalUtilizationPct)}%
                      </span>
                    </div>
                  ) : (
                    <span className="text-muted-foreground/50 text-[11px]">—</span>
                  )}
                </td>
                <td className="px-3 py-2.5" />
                <td className="px-3 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                  {(() => {
                    const trend = globalCostSummary?.wowTrend ?? null;
                    if (!trend) return <span className="text-muted-foreground/50 text-[11px]">—</span>;
                    const isPos = trend.startsWith("+");
                    const isNeg = trend.startsWith("-");
                    const cls = isPos
                      ? "text-red-500"
                      : isNeg
                      ? "text-emerald-500"
                      : "text-muted-foreground";
                    return (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className={`font-mono text-[11px] font-semibold ${cls}`}>{trend}</span>
                          </TooltipTrigger>
                          <TooltipContent>Fleet-wide week-over-week cost change</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    );
                  })()}
                </td>
                <td className="px-3 py-2.5" />
                <td className="px-2 py-2.5" />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {isFetching && (
        <div className="px-4 py-1.5 border-t border-border bg-muted/20 text-[11px] text-muted-foreground flex items-center gap-1.5">
          <RefreshCw className="h-3 w-3 animate-spin" />
          Refreshing…
        </div>
      )}
    </div>
  );
}

const STATUS_ORDER = ["healthy", "degraded", "down", "unknown"] as const;
const STATUS_LABELS: Record<string, string> = {
  healthy: "Healthy",
  degraded: "Degraded",
  down: "Down",
  unknown: "Unknown",
};
const STATUS_COLORS: Record<string, string> = {
  healthy: "text-emerald-500",
  degraded: "text-amber-500",
  down: "text-red-500",
  unknown: "text-muted-foreground",
};

const AUTH_LABELS: Record<UserAuthType, string> = {
  clerk: "Clerk",
  entra: "Entra ID",
  none: "Public",
};

function PerAppBudgetPanel({
  app,
  recentAlerts,
}: {
  app: AppSummary;
  recentAlerts: Map<string, Date>;
}) {
  const threshold = getBudgetThreshold(app.id);
  const status = budgetStatus(app, threshold);
  const pct =
    app.budget != null && app.budget > 0
      ? Math.min((app.monthToDateCost / app.budget) * 100, 100)
      : null;
  const hasAlert = recentAlerts.has(app.id);

  return (
    <div className="bg-card border border-border shadow-sm">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border">
        <TrendingUp className="h-3.5 w-3.5 text-muted-foreground" />
        <h2 className="text-sm font-semibold">Budget Status</h2>
        {hasAlert && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex items-center">
                  <Bell className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                </span>
              </TooltipTrigger>
              <TooltipContent>
                Budget alert sent {formatDistanceToNow(recentAlerts.get(app.id)!, { addSuffix: true })}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
        {app.costDataSource && app.costDataSource !== "mock" && (
          <CostDataSourceBadge dataSource={app.costDataSource} />
        )}
      </div>
      <div className="flex flex-wrap divide-x divide-border">
        <div className="px-6 py-3 flex flex-col gap-0.5 min-w-[150px]">
          <div className="text-[11px] text-muted-foreground font-medium">Spent MTD</div>
          <div className="flex items-center gap-1.5 flex-wrap">
            {app.costDataSource && app.costDataSource !== "mock" && (
              <CostDataSourceBadge dataSource={app.costDataSource} />
            )}
            <span className="text-lg font-semibold tabular-nums">{fmt(app.monthToDateCost)}</span>
          </div>
        </div>
        <div className="px-6 py-3 flex flex-col gap-0.5 min-w-[120px]">
          <div className="text-[11px] text-muted-foreground font-medium">Budget</div>
          <div className="text-lg font-semibold tabular-nums text-foreground">
            {app.budget != null ? fmt(app.budget) : <span className="text-muted-foreground/50 text-base">—</span>}
          </div>
        </div>
        <div className="px-6 py-3 flex flex-col gap-0.5 min-w-[120px]">
          <div className="text-[11px] text-muted-foreground font-medium">Forecast</div>
          <div className="text-lg font-semibold tabular-nums text-foreground">
            {app.forecast != null ? fmt(app.forecast) : <span className="text-muted-foreground/50 text-base">—</span>}
          </div>
        </div>
        <div className="px-6 py-3 flex flex-col gap-1 min-w-[160px]">
          <div className="text-[11px] text-muted-foreground font-medium">Utilization</div>
          {pct !== null ? (
            <div className="flex items-center gap-2">
              <Progress
                value={pct}
                className={`h-1.5 w-24 ${
                  status === "over"
                    ? "[&>div]:bg-red-500"
                    : status === "warning"
                    ? "[&>div]:bg-amber-500"
                    : "[&>div]:bg-emerald-500"
                }`}
              />
              <span className="text-sm tabular-nums text-foreground">{Math.round(pct)}%</span>
            </div>
          ) : (
            <span className="text-muted-foreground/50">—</span>
          )}
        </div>
        <div className="px-6 py-3 flex flex-col gap-1 min-w-[140px]">
          <div className="text-[11px] text-muted-foreground font-medium">Status</div>
          <StatusPill status={status} />
        </div>
      </div>
    </div>
  );
}

function GlobalStrips({
  apps,
  fleetHealth,
  authCounts,
}: {
  apps: AppSummary[] | undefined;
  fleetHealth: Record<string, number>;
  authCounts: Record<string, number>;
}) {
  const hasHealthData = Object.keys(fleetHealth).length > 0;
  const hasApps = apps != null;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
      <div className="bg-card border border-border shadow-sm p-3 flex flex-col gap-2">
        <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Fleet Health</div>
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

      <div className="bg-card border border-border shadow-sm p-3 flex flex-col gap-2">
        <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Identity Landscape</div>
        <div className="flex items-center gap-4 flex-wrap">
          {!hasApps ? (
            <Skeleton className="h-5 w-48" />
          ) : (
            (["clerk", "entra", "none"] as UserAuthType[])
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

function Tile({ title, value, sub, href }: { title: string; value: React.ReactNode; sub: string; href?: string }) {
  const inner = (
    <>
      <div className="flex items-center justify-between gap-1 mb-1">
        <div className="text-[12px] text-muted-foreground font-medium truncate">{title}</div>
        {href && <ChevronRight className="h-3 w-3 text-muted-foreground/50 shrink-0" />}
      </div>
      {value === null ? (
        <Skeleton className="h-7 w-20 mb-1" />
      ) : (
        <div className="text-xl font-semibold text-foreground mb-1 tabular-nums">{value}</div>
      )}
      <div className="text-[11px] text-muted-foreground truncate">{sub}</div>
    </>
  );

  if (href) {
    return (
      <Link href={href} className="bg-card border border-border p-3 shadow-sm flex flex-col justify-between hover:bg-muted/40 hover:border-border/80 transition-colors cursor-pointer">
        {inner}
      </Link>
    );
  }

  return (
    <div className="bg-card border border-border p-3 shadow-sm flex flex-col justify-between">
      {inner}
    </div>
  );
}

function Field({ label, value, mono = false }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      <div className="text-muted-foreground font-medium">{label}</div>
      <div className={`col-span-2 ${mono ? "font-mono text-[12px]" : ""} text-foreground truncate`}>{value}</div>
    </div>
  );
}
