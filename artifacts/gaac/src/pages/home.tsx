import {
  useGetGlobalHealth,
  useListApps,
  useListGlobalAlerts,
  useGetGlobalCostSummary,
  useGetApp,
  useGetCost,
  getGetAppQueryKey,
  getGetCostQueryKey,
  getGetGlobalHealthQueryKey,
  getGetGlobalCostSummaryQueryKey,
  getListGlobalAlertsQueryKey,
} from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { RefreshCw, Filter, Download } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { useState } from "react";

const GLOBAL = "__global__";

export default function Home() {
  const [scope, setScope] = useState<string>(GLOBAL);
  const isGlobal = scope === GLOBAL;

  const { data: apps, isLoading: appsLoading } = useListApps();
  const { data: health, isLoading: healthLoading } = useGetGlobalHealth({
    query: { enabled: isGlobal, queryKey: getGetGlobalHealthQueryKey() },
  });
  const { data: alerts, isLoading: alertsLoading } = useListGlobalAlerts({
    query: { enabled: isGlobal, queryKey: getListGlobalAlertsQueryKey() },
  });
  const { data: globalCost, isLoading: globalCostLoading } = useGetGlobalCostSummary({
    query: { enabled: isGlobal, queryKey: getGetGlobalCostSummaryQueryKey() },
  });

  const { data: appDetail, isLoading: appDetailLoading } = useGetApp(scope, {
    query: { enabled: !isGlobal, queryKey: getGetAppQueryKey(scope) },
  });
  const { data: appCost, isLoading: appCostLoading } = useGetCost(scope, {
    query: { enabled: !isGlobal, queryKey: getGetCostQueryKey(scope) },
  });

  const formatCurrency = (amount: number, currency = "USD") =>
    new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);

  const selectedApp = apps?.find((a) => a.id === scope);

  return (
    <div className="space-y-4">
      {/* Title + scope picker */}
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-foreground tracking-tight">Dashboard</h1>
          <p className="text-[12px] text-muted-foreground mt-0.5">
            {isGlobal
              ? "Organization-wide view of all Azure resources"
              : `Scoped to ${selectedApp?.name ?? "application"}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="scope-select" className="text-[12px] text-muted-foreground font-medium">Scope</label>
          <Select value={scope} onValueChange={setScope}>
            <SelectTrigger
              id="scope-select"
              aria-label="Dashboard scope"
              className="h-8 w-[260px] rounded-sm border-border bg-card text-[13px]"
              data-testid="scope-select"
            >
              <SelectValue placeholder="Select scope" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={GLOBAL}>Global — All Azure Costs</SelectItem>
              {apps?.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* KPI Tiles */}
      {isGlobal ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <Tile
            title="Total Applications"
            value={healthLoading ? null : health?.totalApps ?? 0}
            sub="Active resources"
          />
          <Tile
            title="Global Health"
            value={healthLoading ? null : health?.healthy ?? 0}
            sub={`${health?.degraded ?? 0} degraded, ${health?.unhealthy ?? 0} unhealthy`}
          />
          <Tile
            title="Active Alerts"
            value={alertsLoading ? null : alerts?.length ?? 0}
            sub="Requiring attention"
          />
          <Tile
            title="MTD Azure Spend"
            value={
              globalCostLoading
                ? null
                : globalCost
                  ? formatCurrency(globalCost.monthToDate, globalCost.currency)
                  : "$0.00"
            }
            sub="Month to date"
          />
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <Tile
            title="Status"
            value={
              appDetailLoading ? null : appDetail ? (
                <StatusBadge status={appDetail.status} />
              ) : (
                "—"
              )
            }
            sub={selectedApp ? `${selectedApp.environment} · ${selectedApp.region}` : ""}
          />
          <Tile
            title="Active Alerts"
            value={appDetailLoading ? null : appDetail?.activeAlerts ?? 0}
            sub="Open on this application"
          />
          <Tile
            title="MTD Spend"
            value={
              appCostLoading
                ? null
                : appCost
                  ? formatCurrency(appCost.monthToDate, appCost.currency)
                  : "$0.00"
            }
            sub={appCost ? `Forecast ${formatCurrency(appCost.forecast, appCost.currency)}` : ""}
          />
          <Tile
            title="API Calls (MTD)"
            value={
              appCostLoading
                ? null
                : appCost
                  ? new Intl.NumberFormat("en-US").format(appCost.apiUsage.totalCalls)
                  : 0
            }
            sub={
              appCost
                ? `${formatCurrency(appCost.apiUsage.cost, appCost.currency)} @ ${formatCurrency(appCost.apiUsage.costPerMillion, appCost.currency)}/M`
                : ""
            }
          />
        </div>
      )}

      {/* Main panel */}
      {isGlobal ? (
        <div className="bg-card border border-border shadow-sm flex flex-col">
          <div className="flex items-center justify-between p-2 border-b border-border bg-card">
            <h2 className="text-sm font-semibold px-2">App Services</h2>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="sm" className="h-7 text-xs px-2 rounded-sm text-primary hover:text-primary hover:bg-primary/10">
                <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                Refresh
              </Button>
              <Button variant="ghost" size="sm" className="h-7 text-xs px-2 rounded-sm text-primary hover:text-primary hover:bg-primary/10">
                <Filter className="h-3.5 w-3.5 mr-1.5" />
                Add filter
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
                    <TableHead className="h-8 font-semibold text-foreground">Environment</TableHead>
                    <TableHead className="h-8 font-semibold text-foreground">Location</TableHead>
                    <TableHead className="h-8 font-semibold text-foreground text-right">Alerts</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {apps?.map((app) => (
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
                      <TableCell className="py-1 text-muted-foreground">{app.environment}</TableCell>
                      <TableCell className="py-1 text-muted-foreground">{app.region}</TableCell>
                      <TableCell className="py-1 text-right tabular-nums">{app.activeAlerts || 0}</TableCell>
                    </TableRow>
                  ))}
                  {apps?.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-6 text-muted-foreground">
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
            <h2 className="text-sm font-semibold px-2">
              Cost by API Name — {selectedApp?.name ?? ""}
            </h2>
            <Link
              href={`/apps/${scope}`}
              className="text-[12px] text-primary hover:underline pr-2"
            >
              Open application →
            </Link>
          </div>
          <div className="overflow-x-auto">
            {appCostLoading || !appCost ? (
              <div className="p-4 space-y-2">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
              </div>
            ) : (
              <Table className="text-[13px]">
                <TableHeader className="bg-muted/50 hover:bg-muted/50 border-b border-border">
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="h-8 font-semibold text-foreground">API Name</TableHead>
                    <TableHead className="h-8 font-semibold text-foreground text-right w-[160px]">Calls (MTD)</TableHead>
                    <TableHead className="h-8 font-semibold text-foreground text-right w-[120px]">Cost</TableHead>
                    <TableHead className="h-8 font-semibold text-foreground w-[180px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {appCost.apiUsage.byApi?.map((row, idx) => {
                    const maxCost = appCost.apiUsage.byApi[0]?.cost || 1;
                    return (
                      <TableRow key={`${row.name}-${idx}`} className="h-8 border-b border-border/50 hover:bg-muted/40">
                        <TableCell className="py-1 font-mono text-[12px] font-medium">{row.name}</TableCell>
                        <TableCell className="py-1 text-right font-mono text-[12px] tabular-nums text-muted-foreground">
                          {new Intl.NumberFormat("en-US").format(row.totalCalls)}
                        </TableCell>
                        <TableCell className="py-1 text-right font-mono text-[12px] tabular-nums">
                          {formatCurrency(row.cost, appCost.currency)}
                        </TableCell>
                        <TableCell className="py-1">
                          <Progress value={(row.cost / maxCost) * 100} className="h-1.5 rounded-none bg-muted" />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
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
