import {
  useGetGlobalHealth,
  useListApps,
  useListGlobalAlerts,
  useGetApp,
  getGetAppQueryKey,
  getGetGlobalHealthQueryKey,
  getListGlobalAlertsQueryKey,
} from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RefreshCw, Download } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { ScopeSelect } from "@/lib/scope";
import { useScope } from "@/lib/scope-context";
import { useState, useEffect } from "react";
import { AuthBadge } from "@/components/auth-badge";

type UserAuthFilter = "all" | "clerk" | "entra" | "none";
type EnvFilter = "all" | "prod" | "staging" | "dev";

export default function Home() {
  const { scope, setScope, isGlobal } = useScope();
  const [authFilter, setAuthFilter] = useState<UserAuthFilter>("all");
  const [envFilter, setEnvFilter] = useState<EnvFilter>("all");

  useEffect(() => {
    if (!isGlobal) {
      setAuthFilter("all");
      setEnvFilter("all");
    }
  }, [isGlobal]);

  const { data: apps, isLoading: appsLoading } = useListApps();
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
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <Tile title="Total Applications" value={healthLoading ? null : health?.totalApps ?? 0} sub="Active resources" />
          <Tile
            title="Global Health"
            value={healthLoading ? null : health?.healthy ?? 0}
            sub={`${health?.degraded ?? 0} degraded, ${health?.unhealthy ?? 0} unhealthy`}
          />
          <Tile title="Active Alerts" value={alertsLoading ? null : alerts?.length ?? 0} sub="Requiring attention" />
          <Tile
            title="Active Regions"
            value={appsLoading ? null : activeRegions}
            sub="Geographic deployment footprint"
          />
        </div>
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
            </div>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="sm" className="h-7 text-xs px-2 rounded-sm text-primary hover:text-primary hover:bg-primary/10">
                <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                Refresh
              </Button>
              <Button variant="ghost" size="sm" className="h-7 text-xs px-2 rounded-sm text-primary hover:text-primary hover:bg-primary/10">
                <Download className="h-3.5 w-3.5 mr-1.5" />
                Export
              </Button>
            </div>
          </div>

          <div className="overflow-x-auto">
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
                        <Link href={`/apps/${app.id}`} className="text-primary hover:underline font-medium" onClick={(e) => e.stopPropagation()}>
                          {app.name}
                        </Link>
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
            <h2 className="text-sm font-semibold px-2">Application Details — {selectedApp?.name ?? ""}</h2>
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

function Tile({ title, value, sub }: { title: string; value: React.ReactNode; sub: string }) {
  return (
    <div className="bg-card border border-border p-3 shadow-sm flex flex-col justify-between">
      <div className="text-[12px] text-muted-foreground font-medium mb-1 truncate">{title}</div>
      {value === null ? (
        <Skeleton className="h-7 w-20 mb-1" />
      ) : (
        <div className="text-xl font-semibold text-foreground mb-1 tabular-nums">{value}</div>
      )}
      <div className="text-[11px] text-muted-foreground truncate">{sub}</div>
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

