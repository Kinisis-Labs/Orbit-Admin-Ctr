import { useState, useMemo, useEffect } from "react";
import { AreaChart, Area, ResponsiveContainer } from "recharts";
import { getListAppsQueryKey, getGetCostQueryKey, getCost, getGetAppQueryKey, getApp } from "@workspace/api-client-react";
import type { AppSummary, AppDetail } from "@workspace/api-client-react";
import type { UserAuthType } from "@workspace/api-client-react";
import type { DailyCostPoint } from "@/components/daily-spend-utils";
import { useApps } from "@/hooks/use-apps";
import { useApp } from "@/hooks/use-app";
import { useQueryClient, useQueries } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/status-badge";
import { ChevronRight, Bell, TrendingUp, X, TriangleAlert, Wifi, Smartphone, ExternalLink } from "lucide-react";
import { Link, useLocation, useSearch } from "wouter";
import { Button } from "@/components/ui/button";
import { ScopeSelect } from "@/lib/scope";
import { useScope } from "@/lib/scope-context";
import { RefreshCw } from "lucide-react";
import { AuthBadge } from "@/components/auth-badge";
import { useRecentBudgetAlerts } from "@/hooks/use-recent-budget-alerts";
import { useAuth } from "@/lib/auth";
import { COST_READER_GROUP } from "@/lib/auth-groups";
import { getBudgetThreshold } from "@/lib/spend-threshold";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Progress } from "@/components/ui/progress";
import { formatDistanceToNow } from "date-fns";
import { detectRecentAnomaly } from "@/pages/cost";
import { useCsvExport } from "@/hooks/use-csv-export";
import { CsvToolbar } from "@/components/csv-toolbar";
import { AdminAccessBadge } from "@/components/admin-access-badge";
import { LiveBadge } from "@/components/data-source-badge";

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

function readLastTab(): string {
  try {
    const t = localStorage.getItem("orbit-last-tab") ?? "overview";
    return (["overview", "infrastructure", "network", "telemetry", "cost", "ledger", "alerts"] as string[]).includes(t) ? t : "overview";
  } catch {
    return "overview";
  }
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

  const [budgetBreachFilter, setBudgetBreachFilter] = useState<boolean>(() => {
    const params = new URLSearchParams(search);
    return params.get("breach") === "1";
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
          <Tile
            title="Region"
            value={selectedApp ? selectedApp.region : "—"}
            sub={selectedApp ? `${selectedApp.environment} environment` : ""}
          />
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

      {canSeeCost && (
        <BudgetSummaryWidget
          apps={apps}
          isFetching={appsFetching}
          recentAlerts={recentAlerts}
          anomalousApps={appAnomalies}
          authFilter={authFilter}
          onAuthBadgeClick={toggleAuthFilter}
          budgetBreachFilter={budgetBreachFilter}
          onToggleBudgetBreach={toggleBudgetBreachFilter}
        />
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
                href={(() => {
                  const t = readLastTab();
                  return t !== "overview" ? `/apps/${scope}?tab=${t}` : `/apps/${scope}`;
                })()}
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

const BUDGET_STATUS_RANK: Record<BudgetStatus, number> = { over: 0, warning: 1, ok: 2, none: 3 };

function budgetStatus(app: AppSummary): BudgetStatus {
  if (app.budget == null) return "none";
  if (app.forecastOverBudget) return "over";
  const pct = app.budget > 0 ? (app.monthToDateCost / app.budget) * 100 : 0;
  if (pct >= 80) return "warning";
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

function BudgetSummaryWidget({
  apps,
  isFetching,
  recentAlerts,
  anomalousApps,
  authFilter,
  onAuthBadgeClick,
  budgetBreachFilter,
  onToggleBudgetBreach,
}: {
  apps: AppSummary[] | undefined;
  isFetching: boolean;
  recentAlerts: Map<string, Date>;
  anomalousApps: Set<string>;
  authFilter: UserAuthType | null;
  onAuthBadgeClick: (v: UserAuthType) => void;
  budgetBreachFilter: boolean;
  onToggleBudgetBreach: () => void;
}) {
  const { setScope } = useScope();
  const [, navigate] = useLocation();

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
      const rankDiff = BUDGET_STATUS_RANK[budgetStatus(a)] - BUDGET_STATUS_RANK[budgetStatus(b)];
      if (rankDiff !== 0) return rankDiff;
      return b.monthToDateCost - a.monthToDateCost;
    });
  }, [apps, authFilter, envFilter, budgetBreachFilter]);

  function goToCost(appId: string) {
    setScope(appId);
    if (isFiltered && filterSummary) {
      navigate(`/cost?from=${encodeURIComponent(filterSummary)}`);
    } else {
      navigate("/cost");
    }
  }

  const overCount = filteredApps?.filter((a) => a.forecastOverBudget).length ?? 0;
  const warningCount = filteredApps?.filter((a) => {
    if (a.forecastOverBudget || a.budget == null) return false;
    return a.budget > 0 && (a.monthToDateCost / a.budget) * 100 >= 80;
  }).length ?? 0;

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
  const costLiveBadge = allLive ? (
    <LiveBadge className="mt-1.5" />
  ) : someLive ? (
    <LiveBadge label={`${liveCount}/${totalSourced} Live`} className="mt-1.5" />
  ) : null;

  const isFiltered = authFilter !== null || envFilter !== "all" || budgetBreachFilter;

  const filterSummaryParts: string[] = [];
  if (authFilter !== null) filterSummaryParts.push(authFilter.charAt(0).toUpperCase() + authFilter.slice(1));
  if (envFilter !== "all") filterSummaryParts.push(envFilter.charAt(0).toUpperCase() + envFilter.slice(1));
  if (budgetBreachFilter) filterSummaryParts.push("Budget breach");
  const filterSummary = filterSummaryParts.join(" · ");

  const appCount = filteredApps?.length ?? apps?.length;

  const csvHeaders = ["Application", "Environment", "Auth", "Spent MTD (USD)", "Budget (USD)", "Forecast (USD)", "Utilization %", "Status", "Budget breach"];
  const csvRows = useMemo(() => {
    if (!filteredApps) return null;
    const appRows = filteredApps.map((app) => {
      const status = budgetStatus(app);
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
    ];

    const rows: string[][] = [...appRows, totalRow];
    if (unbudgetedCount > 0) {
      rows.push([
        `Note: ${unbudgetedCount} app${unbudgetedCount === 1 ? "" : "s"} not included in budget/forecast totals (no budget set)`,
        "", "", "", "", "", "", "", "",
      ]);
    }
    return rows;
  }, [filteredApps, totalSpentMTD, totalBudget, totalForecast, totalUtilizationPct, totalUtilizationStatus]);

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
            <div className="text-lg font-semibold tabular-nums">{fmt(totalSpentMTD)}</div>
          )}
          <div className="text-[10px] text-muted-foreground mt-0.5">
            {filteredApps ? `Across ${filteredApps.length} app${filteredApps.length !== 1 ? "s" : ""}` : ""}
          </div>
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

      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="text-left font-medium text-muted-foreground px-4 py-2 w-[180px]">Application</th>
              <th className="text-left font-medium text-muted-foreground px-3 py-2">Auth</th>
              <th className="text-right font-medium text-muted-foreground px-3 py-2">Spent MTD</th>
              <th className="text-right font-medium text-muted-foreground px-3 py-2">Budget</th>
              <th className="text-right font-medium text-muted-foreground px-3 py-2">Forecast</th>
              <th className="text-left font-medium text-muted-foreground px-3 py-2 w-[120px]">Utilization</th>
              <th className="text-left font-medium text-muted-foreground px-3 py-2">Status</th>
              <th className="text-left font-medium text-muted-foreground px-3 py-2 w-[88px]">{sparklineRange}d trend</th>
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
                  <td className="px-3 py-2.5"><Skeleton className="h-6 w-[72px]" /></td>
                  <td className="px-2 py-2.5" />
                </tr>
              ))
            ) : filteredApps.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-6 text-center text-[13px] text-muted-foreground">
                  No apps match the active filters.
                </td>
              </tr>
            ) : (
              filteredApps.map((app) => {
                const status = budgetStatus(app);
                const pct = app.budget != null && app.budget > 0
                  ? Math.min((app.monthToDateCost / app.budget) * 100, 100)
                  : null;
                const hasAlert = recentAlerts.has(app.id);
                const hasAnomaly = anomalousApps.has(app.id);

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
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className={`inline-flex items-center px-1 py-0.5 rounded-sm text-[9px] font-semibold uppercase tracking-wide border cursor-default ${
                                  app.costDataSource === "live"
                                    ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/30"
                                    : "bg-amber-500/10 text-amber-500 border-amber-500/30"
                                }`}>
                                  {app.costDataSource}
                                </span>
                              </TooltipTrigger>
                              <TooltipContent>
                                {app.costDataSource === "live"
                                  ? "Cost figure is from live Azure Cost Management"
                                  : "Cost figure is from a cached DB snapshot — live Azure data unavailable"}
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
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
                              <TooltipContent>Alert at {getBudgetThreshold(app.id)}% · {Math.round(pct)}% utilized</TooltipContent>
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
