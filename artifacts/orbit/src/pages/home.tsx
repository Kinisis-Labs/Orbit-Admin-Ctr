import { useState, useMemo, useEffect } from "react";
import { getListAppsQueryKey, getGetCostQueryKey, getCost } from "@workspace/api-client-react";
import type { AppSummary } from "@workspace/api-client-react";
import type { UserAuthType } from "@workspace/api-client-react";
import { useApps } from "@/hooks/use-apps";
import { useApp } from "@/hooks/use-app";
import { useQueryClient, useQueries } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/status-badge";
import { ChevronRight, Bell, TrendingUp, X, TriangleAlert } from "lucide-react";
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
  const { hasGroup } = useAuth();
  const canSeeCost = hasGroup(COST_READER_GROUP.id);
  const recentAlerts = useRecentBudgetAlerts(canSeeCost);

  const queryClient = useQueryClient();

  const { data: apps, isFetching: appsFetching } = useApps();
  const appAnomalies = useAppAnomalies(apps, canSeeCost);

  const { data: appDetail, isLoading: appDetailLoading, queryKey: appQueryKey } = useApp(scope || undefined);

  const selectedApp = apps?.find((a) => a.id === scope);

  const [authFilter, setAuthFilter] = useState<UserAuthType | null>(null);
  const search = useSearch();
  const [, navigate] = useLocation();

  const [budgetBreachFilter, setBudgetBreachFilter] = useState<boolean>(() => {
    const params = new URLSearchParams(search);
    return params.get("breach") === "1";
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (budgetBreachFilter) {
      params.set("breach", "1");
    } else {
      params.delete("breach");
    }
    const qs = params.toString();
    const next = qs ? `?${qs}` : window.location.pathname;
    navigate(next, { replace: true });
  }, [budgetBreachFilter]);

  function toggleBudgetBreachFilter() {
    setBudgetBreachFilter((prev) => !prev);
  }

  function toggleAuthFilter(value: UserAuthType) {
    setAuthFilter((prev) => (prev === value ? null : value));
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

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-foreground tracking-tight">Dashboard</h1>
          <p className="text-[12px] text-muted-foreground mt-0.5">
            {selectedApp ? `Scoped to ${selectedApp.name}` : "Select an application"}
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <AuthFilterPills
            authCounts={authCounts}
            authFilter={authFilter}
            onToggle={toggleAuthFilter}
            onClear={clearAuthFilter}
          />
          <ScopeSelect authFilter={authFilter} />
        </div>
      </div>

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
                  appDetail.subscriptionName ? (
                    <span>
                      <span className="font-medium">{appDetail.subscriptionName}</span>
                      <span className="font-mono text-[11px] text-muted-foreground ml-1.5">{appDetail.subscriptionId}</span>
                    </span>
                  ) : (
                    appDetail.subscriptionId
                  )
                }
                mono={!appDetail.subscriptionName}
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

  const [envFilter, setEnvFilter] = useState<EnvFilter>("all");

  const filteredApps = useMemo(() => {
    if (!apps) return undefined;
    return apps.filter((a) => {
      if (authFilter !== null && a.userAuth !== authFilter) return false;
      if (envFilter !== "all" && a.environment !== envFilter) return false;
      if (budgetBreachFilter && !a.forecastOverBudget) return false;
      return true;
    });
  }, [apps, authFilter, envFilter, budgetBreachFilter]);

  function goToCost(appId: string) {
    setScope(appId);
    navigate("/cost");
  }

  const overCount = filteredApps?.filter((a) => a.forecastOverBudget).length ?? 0;
  const warningCount = filteredApps?.filter((a) => {
    if (a.forecastOverBudget || a.budget == null) return false;
    return a.budget > 0 && (a.monthToDateCost / a.budget) * 100 >= 80;
  }).length ?? 0;

  const isFiltered = authFilter !== null || envFilter !== "all" || budgetBreachFilter;

  const filterSummaryParts: string[] = [];
  if (authFilter !== null) filterSummaryParts.push(authFilter.charAt(0).toUpperCase() + authFilter.slice(1));
  if (envFilter !== "all") filterSummaryParts.push(envFilter.charAt(0).toUpperCase() + envFilter.slice(1));
  if (budgetBreachFilter) filterSummaryParts.push("Budget breach");
  const filterSummary = filterSummaryParts.join(" · ");

  const appCount = filteredApps?.length ?? apps?.length;

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
        </div>
        <span className="text-[11px] text-muted-foreground pr-3">Month to date</span>
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
                  <td className="px-2 py-2.5" />
                </tr>
              ))
            ) : filteredApps.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-center text-[13px] text-muted-foreground">
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
                        {fmt(app.monthToDateCost)}
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
                      <StatusPill status={status} />
                    </td>
                    <td className="px-2 py-2.5 text-muted-foreground/40">
                      <ChevronRight className="h-3.5 w-3.5" />
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
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
