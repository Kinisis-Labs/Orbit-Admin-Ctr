import { getListAppsQueryKey } from "@workspace/api-client-react";
import { useApps } from "@/hooks/use-apps";
import { useApp } from "@/hooks/use-app";
import { useQueryClient } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/status-badge";
import { ChevronRight, Bell } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { ScopeSelect } from "@/lib/scope";
import { useScope } from "@/lib/scope-context";
import { RefreshCw } from "lucide-react";
import { AuthBadge } from "@/components/auth-badge";
import { useRecentBudgetAlerts } from "@/hooks/use-recent-budget-alerts";
import { useAuth, COST_READER_GROUP } from "@/lib/auth";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { formatDistanceToNow } from "date-fns";

export default function Home() {
  const { scope } = useScope();
  const { hasGroup } = useAuth();
  const canSeeCost = hasGroup(COST_READER_GROUP.id);
  const recentAlerts = useRecentBudgetAlerts(canSeeCost);

  const queryClient = useQueryClient();

  const { data: apps, isFetching: appsFetching } = useApps();

  const { data: appDetail, isLoading: appDetailLoading, queryKey: appQueryKey } = useApp(scope || undefined);

  const selectedApp = apps?.find((a) => a.id === scope);

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
        <ScopeSelect />
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
          sub={appDetail?.subscriptionId ? `Subscription ${appDetail.subscriptionId}` : ""}
        />
      </div>

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
            <Link href={`/apps/${scope}`} className="text-[12px] text-primary hover:underline">
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
              <Field label="Subscription" value={appDetail.subscriptionId} mono />
              <Field label="Location" value={appDetail.region} />
              <Field label="Environment" value={appDetail.environment} />
              <Field label="Auth type" value={<AuthBadge userAuth={appDetail.userAuth} />} />
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
