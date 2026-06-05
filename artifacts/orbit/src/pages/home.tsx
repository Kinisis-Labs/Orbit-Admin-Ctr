import {
  useGetGlobalHealth,
  useListApps,
  useListGlobalAlerts,
  useGetApp,
  getGetAppQueryKey,
  getGetGlobalHealthQueryKey,
  getListGlobalAlertsQueryKey,
  getListAppsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RefreshCw, Download, ChevronRight, Clipboard, Check, AlertTriangle, TriangleAlert, Bell } from "lucide-react";
import { Link, useSearch, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { ScopeSelect } from "@/lib/scope";
import { useScope } from "@/lib/scope-context";
import { useEffect } from "react";
import { AuthBadge } from "@/components/auth-badge";
import { useCsvExport } from "@/hooks/use-csv-export";
import { useOverBudgetDays } from "@/hooks/use-over-budget-days";
import { useRecentBudgetAlerts } from "@/hooks/use-recent-budget-alerts";
import { useAuth, COST_READER_GROUP } from "@/lib/auth";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { formatDistanceToNow } from "date-fns";

type UserAuthFilter = "all" | "clerk" | "entra" | "none";
type EnvFilter = "all" | "prod" | "staging" | "dev";

const AUTH_VALUES: UserAuthFilter[] = ["all", "clerk", "entra", "none"];
const ENV_VALUES: EnvFilter[] = ["all", "prod", "staging", "dev"];

function parseAuthFilter(value: string | null): UserAuthFilter {
  return AUTH_VALUES.includes(value as UserAuthFilter) ? (value as UserAuthFilter) : "all";
}
function parseEnvFilter(value: string | null): EnvFilter {
  return ENV_VALUES.includes(value as EnvFilter) ? (value as EnvFilter) : "all";
}

export default function Home() {
  const { scope, setScope, isGlobal } = useScope();
  const search = useSearch();
  const [, navigate] = useLocation();
  const { hasGroup } = useAuth();
  const canSeeCost = hasGroup(COST_READER_GROUP.id);
  const { overBudgetCount } = useOverBudgetDays(isGlobal && canSeeCost);
  const recentAlerts = useRecentBudgetAlerts(canSeeCost);

  const params = new URLSearchParams(search);
  const authFilter = parseAuthFilter(params.get("auth"));
  const envFilter = parseEnvFilter(params.get("env"));

  function setAuthFilter(value: UserAuthFilter) {
    const next = new URLSearchParams(search);
    if (value === "all") next.delete("auth"); else next.set("auth", value);
    const qs = next.toString();
    navigate(qs ? `/?${qs}` : "/", { replace: true });
  }

  function setEnvFilter(value: EnvFilter) {
    const next = new URLSearchParams(search);
    if (value === "all") next.delete("env"); else next.set("env", value);
    const qs = next.toString();
    navigate(qs ? `/?${qs}` : "/", { replace: true });
  }

  useEffect(() => {
    if (!isGlobal) {
      const next = new URLSearchParams(search);
      next.delete("auth");
      next.delete("env");
      const qs = next.toString();
      navigate(qs ? `/?${qs}` : "/", { replace: true });
    }
  }, [isGlobal]);

  const queryClient = useQueryClient();

  const { data: apps, isLoading: appsLoading, isFetching: appsFetching } = useListApps();

  function handleRefresh() {
    queryClient.invalidateQueries({ queryKey: getListAppsQueryKey() });
  }

  const { data: health, isLoading: healthLoading } = useGetGlobalHealth({
    query: { enabled: isGlobal, queryKey: getGetGlobalHealthQueryKey() },
  });
  const { data: alerts, isLoading: alertsLoading } = useListGlobalAlerts(undefined, {
    query: { enabled: isGlobal, queryKey: getListGlobalAlertsQueryKey() },
  });

  const { data: appDetail, isLoading: appDetailLoading } = useGetApp(scope, {
    query: { enabled: !isGlobal, queryKey: getGetAppQueryKey(scope) },
  });

  const filteredApps = apps?.filter(
    (a) =>
      (authFilter === "all" || a.userAuth === authFilter) &&
      (envFilter === "all" || a.environment === envFilter),
  );
  const activeRegions = apps ? new Set(apps.map((a) => a.region)).size : 0;
  const selectedApp = apps?.find((a) => a.id === scope);

  const csvRows = filteredApps?.map((a) => [
    a.name,
    a.status,
    a.userAuth,
    a.environment,
    a.region,
    String(a.activeAlerts ?? 0),
  ]);
  const { copied, disabled: csvDisabled, handleExport, handleCopy } = useCsvExport(
    csvRows ?? null,
    ["Name", "Status", "Identity", "Environment", "Region", "Active Alerts"],
    "app-services",
  );

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-foreground tracking-tight">Dashboard</h1>
          <p className="text-[12px] text-muted-foreground mt-0.5">
            {isGlobal
              ? "Organization-wide view of all Azure resources"
              : `Scoped to ${selectedApp?.name ?? "application"}`}
          </p>
        </div>
        <ScopeSelect />
      </div>

      {isGlobal ? (
        <>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <Tile title="Total Applications" value={healthLoading ? null : health?.totalApps ?? 0} sub="Active resources" href="/health" />
          <Tile
            title="Global Health"
            value={healthLoading ? null : health?.healthy ?? 0}
            sub={`${health?.degraded ?? 0} degraded, ${health?.unhealthy ?? 0} unhealthy`}
          />
          <Tile title="Active Alerts" value={alertsLoading ? null : alerts?.length ?? 0} sub="Requiring attention" href="/alerts" />
          <Tile
            title="Active Regions"
            value={appsLoading ? null : activeRegions}
            sub="Geographic deployment footprint"
          />
        </div>
        {canSeeCost && overBudgetCount > 0 && (
          <Link href="/cost">
            <div className="flex items-center gap-3 px-3 py-2.5 rounded-sm border border-destructive/40 bg-destructive/8 text-destructive dark:text-red-400 hover:bg-destructive/12 transition-colors cursor-pointer">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span className="text-[13px] font-medium">
                Cost alert —{" "}
                <span className="font-semibold">
                  {overBudgetCount} {overBudgetCount === 1 ? "day has" : "days have"} exceeded the daily budget
                </span>{" "}
                in the current window.
              </span>
              <span className="ml-auto text-[12px] font-medium flex items-center gap-1 shrink-0">
                View Cost <ChevronRight className="h-3.5 w-3.5" />
              </span>
            </div>
          </Link>
        )}
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
            sub={appDetail?.subscriptionId ? `Subscription ${appDetail.subscriptionId}` : ""}
          />
        </div>
      )}

      {isGlobal ? (
        <div className="bg-card border border-border shadow-sm flex flex-col">
          <div className="flex items-center justify-between p-2 border-b border-border bg-card">
            <div className="flex items-center gap-3 flex-wrap">
              <h2 className="text-sm font-semibold px-2">App Services</h2>
              <div className="flex items-center gap-1">
                {(["all", "clerk", "entra", "none"] as UserAuthFilter[]).map((f) => (
                  <button
                    key={f}
                    onClick={() => setAuthFilter(f)}
                    className={`h-6 px-2 rounded-sm text-[11px] font-medium transition-colors ${
                      authFilter === f
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted"
                    }`}
                  >
                    {f === "all" ? "All" : f === "clerk" ? "Clerk" : f === "entra" ? "Entra" : "None"}
                  </button>
                ))}
              </div>
              <div className="w-px h-4 bg-border" />
              <div className="flex items-center gap-1">
                {(["all", "prod", "staging", "dev"] as EnvFilter[]).map((f) => (
                  <button
                    key={f}
                    onClick={() => setEnvFilter(f)}
                    className={`h-6 px-2 rounded-sm text-[11px] font-medium transition-colors ${
                      envFilter === f
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted"
                    }`}
                  >
                    {f === "all" ? "All envs" : f === "prod" ? "Prod" : f === "staging" ? "Staging" : "Dev"}
                  </button>
                ))}
              </div>
              {(authFilter !== "all" || envFilter !== "all") && !appsLoading && (
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                    {filteredApps?.length ?? 0} {(filteredApps?.length ?? 0) === 1 ? "app" : "apps"}
                  </span>
                  <button
                    onClick={() => { setAuthFilter("all"); setEnvFilter("all"); }}
                    className="text-[11px] text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
                  >
                    Clear
                  </button>
                </div>
              )}
            </div>
            <div className="flex items-center gap-1">
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
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs px-2 rounded-sm text-primary hover:text-primary hover:bg-primary/10"
                onClick={handleExport}
                disabled={csvDisabled}
              >
                <Download className="h-3.5 w-3.5 mr-1.5" />
                Export
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs px-2 rounded-sm text-primary hover:text-primary hover:bg-primary/10"
                onClick={handleCopy}
                disabled={csvDisabled}
              >
                {copied ? (
                  <>
                    <Check className="h-3.5 w-3.5 mr-1.5 text-green-500" />
                    <span className="text-green-500">Copied!</span>
                  </>
                ) : (
                  <>
                    <Clipboard className="h-3.5 w-3.5 mr-1.5" />
                    Copy
                  </>
                )}
              </Button>
            </div>
          </div>

          {appsFetching && !appsLoading && (
            <div className="h-0.5 w-full overflow-hidden bg-transparent">
              <div className="h-full bg-primary/60 animate-[progress-bar_1.2s_ease-in-out_infinite]" />
            </div>
          )}

          <div className={`overflow-x-auto transition-opacity duration-200 ${appsFetching && !appsLoading ? "opacity-60" : "opacity-100"}`}>
            {appsLoading ? (
              <div className="p-4 space-y-2">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
              </div>
            ) : (
              <Table className="text-[13px]">
                <TableHeader className="bg-muted/50 hover:bg-muted/50 border-b border-border">
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="h-8 font-semibold text-foreground w-[250px]">Name</TableHead>
                    <TableHead className="h-8 font-semibold text-foreground">Status</TableHead>
                    <TableHead className="h-8 font-semibold text-foreground">Identity</TableHead>
                    <TableHead className="h-8 font-semibold text-foreground">Environment</TableHead>
                    <TableHead className="h-8 font-semibold text-foreground">Location</TableHead>
                    <TableHead className="h-8 font-semibold text-foreground text-right">Alerts</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredApps?.map((app) => (
                    <TableRow
                      key={app.id}
                      className="h-8 border-b border-border/50 hover:bg-muted/40 cursor-pointer"
                      onClick={() => setScope(app.id)}
                    >
                      <TableCell className="py-1">
                        <div className="flex items-center gap-1.5">
                          <Link href={`/apps/${app.id}`} className="text-primary hover:underline font-medium" onClick={(e) => e.stopPropagation()}>
                            {app.name}
                          </Link>
                          {canSeeCost && app.forecastOverBudget && (
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="inline-flex items-center">
                                    <TriangleAlert className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent>Forecast exceeds budget cap</TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          )}
                          {canSeeCost && recentAlerts.has(app.id) && (
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="inline-flex items-center">
                                    <Bell className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent>
                                  Budget alert sent{" "}
                                  {formatDistanceToNow(recentAlerts.get(app.id)!, { addSuffix: true })}
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="py-1">
                        <StatusBadge status={app.status} />
                      </TableCell>
                      <TableCell className="py-1">
                        <AuthBadge userAuth={app.userAuth} />
                      </TableCell>
                      <TableCell className="py-1 text-muted-foreground">{app.environment}</TableCell>
                      <TableCell className="py-1 text-muted-foreground">{app.region}</TableCell>
                      <TableCell className="py-1 text-right tabular-nums">{app.activeAlerts || 0}</TableCell>
                    </TableRow>
                  ))}
                  {filteredApps?.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-6 text-muted-foreground">
                        No applications found.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </div>
        </div>
      ) : (
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
            <Link href={`/apps/${scope}`} className="text-[12px] text-primary hover:underline pr-2">
              Open application →
            </Link>
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
                <Field label="Subscription" value={appDetail.subscriptionId} mono />
                <Field label="Location" value={appDetail.region} />
                <Field label="Environment" value={appDetail.environment} />
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

