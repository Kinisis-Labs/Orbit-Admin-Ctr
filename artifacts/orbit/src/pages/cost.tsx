import {
  useGetGlobalCostSummary,
  useGetCost,
  useListApps,
  getGetGlobalCostSummaryQueryKey,
  getGetCostQueryKey,
} from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useForceRefresh } from "@/hooks/use-force-refresh";
import { ForceRefreshButton } from "@/components/force-refresh-button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { Link } from "wouter";
import { Download, PieChart, RefreshCw, TrendingUp, TrendingDown, Wifi, WifiOff, AlertTriangle, Clipboard, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScopeSelect } from "@/lib/scope";
import { useScope } from "@/lib/scope-context";
import { CostTabs } from "@/components/cost-tabs";
import { useState } from "react";

const STALE_COST_THRESHOLD_MS = 24 * 60 * 60 * 1000;

const fmt = (amount: number, currency = "USD") =>
  new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
const fmtInt = (n: number) => new Intl.NumberFormat("en-US").format(n);

function fmtDataAsOf(iso: string | undefined | null): string | null {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(d);
  } catch {
    return null;
  }
}

function DataSourceBadge({
  dataSource,
  dataAsOf,
}: {
  dataSource: "live" | "mock" | undefined;
  dataAsOf?: string | null;
}) {
  if (!dataSource) return null;
  if (dataSource === "live") {
    const asOf = fmtDataAsOf(dataAsOf);
    const isStale = dataAsOf
      ? Date.now() - new Date(dataAsOf).getTime() > STALE_COST_THRESHOLD_MS
      : false;
    return (
      <span className="inline-flex items-center gap-1.5 select-none flex-wrap">
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm border border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[10px] font-semibold uppercase tracking-wide">
          <Wifi className="h-3 w-3" />
          Live — Azure Cost Management
        </span>
        {asOf && (
          <span
            className={
              isStale
                ? "inline-flex items-center gap-0.5 text-[10px] text-amber-600 dark:text-amber-400"
                : "text-[10px] text-muted-foreground"
            }
          >
            {isStale && <AlertTriangle className="h-3 w-3" />}
            as of {asOf}
          </span>
        )}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm border border-border bg-muted/40 text-muted-foreground text-[10px] font-semibold uppercase tracking-wide select-none">
      <WifiOff className="h-3 w-3" />
      Demo data
    </span>
  );
}

export default function Cost() {
  const { scope, isGlobal } = useScope();
  const { data: apps } = useListApps();
  const selectedApp = apps?.find((a) => a.id === scope);

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-foreground tracking-tight">
            {isGlobal ? "Cost Management & Billing" : `Cost — ${selectedApp?.name ?? ""}`}
          </h1>
          <p className="text-[12px] text-muted-foreground mt-0.5">
            {isGlobal
              ? "Aggregated Azure spend across all applications"
              : `Scoped to ${selectedApp?.name ?? "application"}`}
          </p>
        </div>
        <ScopeSelect />
      </div>

      <CostTabs />

      {isGlobal ? <GlobalCost /> : <AppCost />}
    </div>
  );
}

function GlobalCost() {
  const queryKey = getGetGlobalCostSummaryQueryKey();
  const { data: cost, isLoading, isFetching } = useGetGlobalCostSummary(undefined, {
    query: { queryKey },
  });
  const { isRefreshing, isCoolingDown, forceRefresh } = useForceRefresh("/api/global/cost-summary", queryKey);
  const budgetPercent = cost ? (cost.monthToDate / cost.budget) * 100 : 0;
  const netClass = cost && cost.revenue.total - cost.monthToDate >= 0 ? "text-emerald-500" : "text-destructive";
  const net = cost ? cost.revenue.total - cost.monthToDate : 0;
  const marginPct = cost && cost.revenue.total > 0 ? (net / cost.revenue.total) * 100 : null;

  return (
    <>
      {!isLoading && cost && (
        <div className="flex items-center justify-end gap-2">
          {cost.dataSource === "live" && (
            <ForceRefreshButton isRefreshing={isRefreshing} isCoolingDown={isCoolingDown} onRefresh={forceRefresh} />
          )}
          <DataSourceBadge dataSource={cost.dataSource} dataAsOf={cost.dataAsOf} />
        </div>
      )}
      {isFetching && !isLoading && (
        <div className="h-0.5 w-full overflow-hidden bg-transparent">
          <div className="h-full bg-primary/60 animate-[progress-bar_1.2s_ease-in-out_infinite]" />
        </div>
      )}
      <div className={`space-y-4 transition-opacity duration-200 ${isFetching && !isLoading ? "opacity-60" : "opacity-100"}`}>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
        <Tile
          title="Actual cost (MTD)"
          value={isLoading ? null : cost ? fmt(cost.monthToDate, cost.currency) : "$0.00"}
        />
        <Tile title="Forecasted cost" value={isLoading ? null : cost ? fmt(cost.forecast, cost.currency) : "$0.00"} />
        <div className="bg-card border border-border p-3 shadow-sm flex flex-col justify-between">
          <div className="text-[12px] text-muted-foreground font-medium mb-1">API usage (MTD)</div>
          {isLoading ? <Skeleton className="h-7 w-20 mt-1" /> : (
            <>
              <div className="text-xl font-semibold text-foreground mt-1 tabular-nums">
                {fmt(cost?.apiCost || 0, cost?.currency || "USD")}
              </div>
              <div className="text-[11px] text-muted-foreground tabular-nums mt-0.5">
                {fmtInt(cost?.apiCalls || 0)} calls across all apps
              </div>
            </>
          )}
        </div>
        <div className="bg-card border border-border p-3 shadow-sm flex flex-col justify-between">
          <div className="text-[12px] text-muted-foreground font-medium mb-1">Budget utilization</div>
          {isLoading ? <Skeleton className="h-7 w-full mt-1" /> : (
            <div className="space-y-1 mt-1">
              <div className="flex justify-between text-[11px]">
                <span className="font-semibold text-foreground tabular-nums">{fmt(cost?.monthToDate || 0, cost?.currency || "USD")}</span>
                <span className="text-muted-foreground tabular-nums">{fmt(cost?.budget || 0, cost?.currency || "USD")}</span>
              </div>
              <Progress value={budgetPercent} className="h-1.5 rounded-none bg-muted" />
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center px-1.5 py-0.5 border border-border bg-muted/40 text-foreground font-semibold tracking-wide uppercase text-[10px]">Mock</span>
        Revenue figures below are sample data. Real values would come from Stripe, App Store Connect, and Google Play.
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
        <div className="bg-card border border-border p-3 shadow-sm flex flex-col justify-between">
          <div className="text-[12px] text-muted-foreground font-medium mb-1">Revenue (MTD)</div>
          {isLoading || !cost ? <Skeleton className="h-7 w-20 mt-1" /> : (
            <>
              <div className="text-xl font-semibold text-foreground mt-1 tabular-nums">
                {fmt(cost.revenue.total, cost.revenue.currency)}
              </div>
              <div className="text-[11px] text-muted-foreground tabular-nums mt-0.5 truncate">
                Stripe + App Store + Play Store
              </div>
            </>
          )}
        </div>
        <div className="bg-card border border-border p-3 shadow-sm flex flex-col justify-between">
          <div className="text-[12px] text-muted-foreground font-medium mb-1">Net (Revenue − Cost)</div>
          {isLoading || !cost ? <Skeleton className="h-7 w-20 mt-1" /> : (
            <div className={`text-xl font-semibold mt-1 tabular-nums flex items-center gap-1.5 ${netClass}`}>
              {net >= 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
              {fmt(net, cost.currency)}
            </div>
          )}
        </div>
        <div className="bg-card border border-border p-3 shadow-sm flex flex-col justify-between">
          <div className="text-[12px] text-muted-foreground font-medium mb-1">Gross margin</div>
          {isLoading || !cost ? <Skeleton className="h-7 w-20 mt-1" /> : (
            <div className={`text-xl font-semibold mt-1 tabular-nums ${netClass}`}>
              {marginPct === null ? "—" : `${marginPct.toFixed(1)}%`}
            </div>
          )}
        </div>
        <div className="bg-card border border-border p-3 shadow-sm flex flex-col justify-between">
          <div className="text-[12px] text-muted-foreground font-medium mb-1">Revenue by source</div>
          {isLoading || !cost ? <Skeleton className="h-7 w-full mt-1" /> : (
            <div className="space-y-0.5 mt-1 text-[11px] tabular-nums">
              {cost.revenue.bySource.map((s) => (
                <div key={s.source} className="flex justify-between">
                  <span className="text-muted-foreground truncate pr-2">{s.label}</span>
                  <span className="font-mono text-foreground">{fmt(s.amount, cost.revenue.currency)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <Panel
        title="Cost vs Revenue by Application"
        rightHeader={<span className="text-[11px] text-muted-foreground pr-2">Mocked sources: Stripe, Apple App Store, Google Play</span>}
        bodyClassName="overflow-x-auto"
      >
        <Table className="text-[13px]">
          <THead>
            <TableHead className="h-8 font-semibold text-foreground">Application</TableHead>
            <TableHead className="h-8 font-semibold text-foreground text-right w-[110px]">Cost</TableHead>
            <TableHead className="h-8 font-semibold text-foreground text-right w-[110px]">Stripe</TableHead>
            <TableHead className="h-8 font-semibold text-foreground text-right w-[110px]">App Store</TableHead>
            <TableHead className="h-8 font-semibold text-foreground text-right w-[110px]">Play Store</TableHead>
            <TableHead className="h-8 font-semibold text-foreground text-right w-[120px]">Revenue</TableHead>
            <TableHead className="h-8 font-semibold text-foreground text-right w-[120px]">Net</TableHead>
            <TableHead className="h-8 font-semibold text-foreground text-right w-[90px]">Margin</TableHead>
          </THead>
          <TableBody>
            {isLoading || !cost ? (
              <SkeletonRows cols={8} rows={5} />
            ) : (
              cost.revenueByApp.map((row) => {
                const positive = row.net >= 0;
                const rowClass = positive ? "text-emerald-500" : "text-destructive";
                return (
                  <TableRow key={row.appId} className="h-8 border-b border-border/50 hover:bg-muted/40">
                    <TableCell className="py-1 font-medium">
                      <Link href={`/apps/${row.appId}`} className="hover:underline text-primary">{row.appName}</Link>
                    </TableCell>
                    <TableCell className="py-1 text-right font-mono text-[12px] tabular-nums">{fmt(row.cost, cost.currency)}</TableCell>
                    <TableCell className="py-1 text-right font-mono text-[12px] tabular-nums text-muted-foreground">{row.stripe > 0 ? fmt(row.stripe, cost.currency) : "—"}</TableCell>
                    <TableCell className="py-1 text-right font-mono text-[12px] tabular-nums text-muted-foreground">{row.appStore > 0 ? fmt(row.appStore, cost.currency) : "—"}</TableCell>
                    <TableCell className="py-1 text-right font-mono text-[12px] tabular-nums text-muted-foreground">{row.playStore > 0 ? fmt(row.playStore, cost.currency) : "—"}</TableCell>
                    <TableCell className="py-1 text-right font-mono text-[12px] tabular-nums font-semibold">{fmt(row.total, cost.currency)}</TableCell>
                    <TableCell className={`py-1 text-right font-mono text-[12px] tabular-nums font-semibold ${rowClass}`}>{fmt(row.net, cost.currency)}</TableCell>
                    <TableCell className={`py-1 text-right font-mono text-[12px] tabular-nums ${rowClass}`}>
                      {row.marginPercent === null || row.marginPercent === undefined ? "—" : `${row.marginPercent.toFixed(1)}%`}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </Panel>

      <Panel
        title="Cost by Application"
        toolbar={
          <div className="flex items-center gap-1">
            <ToolbarBtn icon={RefreshCw}>Refresh</ToolbarBtn>
            <ToolbarBtn icon={PieChart}>View Chart</ToolbarBtn>
            <ToolbarBtn icon={Download}>Download CSV</ToolbarBtn>
          </div>
        }
      >
        <Table className="text-[13px]">
          <THead>
            <TableHead className="h-8 font-semibold text-foreground">Resource Name</TableHead>
            <TableHead className="h-8 font-semibold text-foreground text-right w-[150px]">Cost</TableHead>
            <TableHead className="h-8 font-semibold text-foreground w-[200px]"></TableHead>
          </THead>
          <TableBody>
            {isLoading ? (
              <SkeletonRows cols={3} rows={3} />
            ) : cost?.byApp.length === 0 ? (
              <TableRow><TableCell colSpan={3} className="text-center py-6 text-muted-foreground">No cost data available</TableCell></TableRow>
            ) : (
              cost?.byApp.map((item) => (
                <TableRow key={item.appId} className="h-8 border-b border-border/50 hover:bg-muted/40">
                  <TableCell className="py-1 font-medium">
                    <Link href={`/apps/${item.appId}`} className="hover:underline text-primary">{item.appName}</Link>
                  </TableCell>
                  <TableCell className="py-1 text-right font-mono text-[12px]">{fmt(item.amount, cost.currency)}</TableCell>
                  <TableCell className="py-1">
                    <Progress value={(item.amount / cost.monthToDate) * 100} className="h-1.5 rounded-none bg-muted" />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Panel>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Panel
          title="Cost by Resource"
          rightHeader={<span className="text-[11px] text-muted-foreground pr-2">Aggregated across all apps</span>}
          toolbar={
            <ToolbarBtn icon={Download} onClick={() => {
              if (!cost?.byResource?.length) return;
              const headers = ["Resource Type", "Cost (MTD)", "% of Total", "WoW Trend"];
              const rows = cost.byResource.map((item) => [
                item.service,
                item.amount.toFixed(2),
                cost.monthToDate > 0 ? ((item.amount / cost.monthToDate) * 100).toFixed(1) + "%" : "0.0%",
                item.trend ?? "N/A",
              ]);
              const csv = [headers, ...rows]
                .map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
                .join("\n");
              const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
              const url = URL.createObjectURL(blob);
              const anchor = document.createElement("a");
              anchor.href = url;
              anchor.download = `cost-by-resource-${new Date().toISOString().slice(0, 10)}.csv`;
              anchor.click();
              URL.revokeObjectURL(url);
            }}>Download CSV</ToolbarBtn>
          }
        >
          <Table className="text-[13px]">
            <THead>
              <TableHead className="h-8 font-semibold text-foreground">Resource Type</TableHead>
              <TableHead className="h-8 font-semibold text-foreground text-right w-[130px]">Cost (MTD)</TableHead>
              <TableHead className="h-8 font-semibold text-foreground text-right w-[80px]">WoW</TableHead>
              <TableHead className="h-8 font-semibold text-foreground w-[140px]"></TableHead>
            </THead>
            <TableBody>
              {isLoading ? (
                <SkeletonRows cols={4} rows={4} />
              ) : (
                cost?.byResource?.map((item) => {
                  const trend = item.trend;
                  const isPos = trend?.startsWith("+");
                  const isNeg = trend?.startsWith("-");
                  const trendClass = isPos
                    ? "text-destructive"
                    : isNeg
                      ? "text-emerald-500"
                      : "text-muted-foreground";
                  return (
                    <TableRow key={item.service} className="h-8 border-b border-border/50 hover:bg-muted/40">
                      <TableCell className="py-1 font-medium">{item.service}</TableCell>
                      <TableCell className="py-1 text-right font-mono text-[12px]">{fmt(item.amount, cost.currency)}</TableCell>
                      <TableCell className={`py-1 text-right font-mono text-[11px] ${trendClass}`}>
                        {trend ?? <span className="text-muted-foreground/50">—</span>}
                      </TableCell>
                      <TableCell className="py-1">
                        <Progress value={(item.amount / (cost?.monthToDate || 1)) * 100} className="h-1.5 rounded-none bg-muted" />
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </Panel>

        <Panel
          title="API Usage by Application"
          rightHeader={<span className="text-[11px] text-muted-foreground pr-2">{cost ? `${fmt(cost.apiCost, cost.currency)} of ${fmt(cost.monthToDate, cost.currency)} MTD` : ""}</span>}
        >
          <Table className="text-[13px]">
            <THead>
              <TableHead className="h-8 font-semibold text-foreground">Application</TableHead>
              <TableHead className="h-8 font-semibold text-foreground text-right w-[140px]">Calls (MTD)</TableHead>
              <TableHead className="h-8 font-semibold text-foreground text-right w-[110px]">Unit ($/M)</TableHead>
              <TableHead className="h-8 font-semibold text-foreground text-right w-[110px]">Cost</TableHead>
            </THead>
            <TableBody>
              {isLoading ? (
                <SkeletonRows cols={4} rows={5} />
              ) : (
                cost?.apiByApp?.map((row) => (
                  <TableRow key={row.appId} className="h-8 border-b border-border/50 hover:bg-muted/40">
                    <TableCell className="py-1 font-medium">
                      <Link href={`/apps/${row.appId}`} className="hover:underline text-primary">{row.appName}</Link>
                    </TableCell>
                    <TableCell className="py-1 text-right font-mono text-[12px] tabular-nums">{fmtInt(row.totalCalls)}</TableCell>
                    <TableCell className="py-1 text-right font-mono text-[12px] tabular-nums text-muted-foreground">{fmt(row.costPerMillion, cost.currency)}</TableCell>
                    <TableCell className="py-1 text-right font-mono text-[12px] tabular-nums">{fmt(row.cost, cost.currency)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </Panel>
      </div>

      <Panel
        title="Cost by API Name (by Application)"
        rightHeader={<span className="text-[11px] text-muted-foreground pr-2">Top {cost?.apiByName?.length ?? 0} endpoints, sorted by cost</span>}
        bodyClassName="overflow-x-auto max-h-[480px] overflow-y-auto"
      >
        <Table className="text-[13px]">
          <TableHeader className="bg-muted/50 hover:bg-muted/50 border-b border-border sticky top-0 z-10">
            <TableRow className="hover:bg-transparent">
              <TableHead className="h-8 font-semibold text-foreground w-[180px]">Application</TableHead>
              <TableHead className="h-8 font-semibold text-foreground">API Name</TableHead>
              <TableHead className="h-8 font-semibold text-foreground text-right w-[160px]">Calls (MTD)</TableHead>
              <TableHead className="h-8 font-semibold text-foreground text-right w-[120px]">Cost</TableHead>
              <TableHead className="h-8 font-semibold text-foreground w-[140px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <SkeletonRows cols={5} rows={6} />
            ) : (
              cost?.apiByName?.map((row, idx) => {
                const maxCost = cost.apiByName[0]?.cost || 1;
                return (
                  <TableRow key={`${row.appId}-${row.apiName}-${idx}`} className="h-8 border-b border-border/50 hover:bg-muted/40">
                    <TableCell className="py-1 font-medium">
                      <Link href={`/apps/${row.appId}`} className="hover:underline text-primary">{row.appName}</Link>
                    </TableCell>
                    <TableCell className="py-1 font-mono text-[12px] text-foreground">{row.apiName}</TableCell>
                    <TableCell className="py-1 text-right font-mono text-[12px] tabular-nums text-muted-foreground">{fmtInt(row.totalCalls)}</TableCell>
                    <TableCell className="py-1 text-right font-mono text-[12px] tabular-nums">{fmt(row.cost, cost.currency)}</TableCell>
                    <TableCell className="py-1">
                      <Progress value={(row.cost / maxCost) * 100} className="h-1.5 rounded-none bg-muted" />
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </Panel>
      </div>
    </>
  );
}

function AppCost() {
  const { scope } = useScope();
  const { data: apps } = useListApps();
  const selectedApp = apps?.find((a) => a.id === scope);
  const queryKey = getGetCostQueryKey(scope);
  const { data, isLoading, isFetching } = useGetCost(scope, undefined, {
    query: { queryKey },
  });
  const { isRefreshing, isCoolingDown, forceRefresh } = useForceRefresh(`/api/apps/${scope}/cost`, queryKey);
  const budgetPercent = data ? (data.monthToDate / data.budget) * 100 : 0;
  const net = data ? data.revenue.total - data.monthToDate : 0;
  const marginPct = data && data.revenue.total > 0 ? (net / data.revenue.total) * 100 : null;
  const netClass = net >= 0 ? "text-emerald-500" : "text-destructive";

  const [copied, setCopied] = useState(false);

  function buildBreakdownCsv() {
    if (!data?.byService?.length) return null;
    const resourceGroup = selectedApp?.resourceGroup ?? "";
    const environment = selectedApp?.environment ?? "";
    const headers = ["Service", "Resource Group", "Environment", "Cost (USD)", "% of Total", "Trend"];
    const rows = data.byService.map((svc) => [
      svc.service,
      resourceGroup,
      environment,
      svc.amount.toFixed(2),
      data.monthToDate > 0 ? ((svc.amount / data.monthToDate) * 100).toFixed(1) + "%" : "0.0%",
      svc.trend ?? "N/A",
    ]);
    return [headers, ...rows]
      .map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
      .join("\n");
  }

  function handleBreakdownExport() {
    const csv = buildBreakdownCsv();
    if (!csv) return;
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `cost-breakdown-${scope}-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function handleBreakdownCopy() {
    const csv = buildBreakdownCsv();
    if (!csv) return;
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(csv).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }).catch(() => fallbackCopy(csv));
    } else {
      fallbackCopy(csv);
    }
  }

  function fallbackCopy(text: string) {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try {
      document.execCommand("copy");
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard unavailable — silently skip
    } finally {
      document.body.removeChild(ta);
    }
  }

  return (
    <>
      {!isLoading && data && (
        <div className="flex items-center justify-end gap-2">
          {data.dataSource === "live" && (
            <ForceRefreshButton isRefreshing={isRefreshing} isCoolingDown={isCoolingDown} onRefresh={forceRefresh} />
          )}
          <DataSourceBadge dataSource={data.dataSource} dataAsOf={data.dataAsOf} />
        </div>
      )}
      {isFetching && !isLoading && (
        <div className="h-0.5 w-full overflow-hidden bg-transparent">
          <div className="h-full bg-primary/60 animate-[progress-bar_1.2s_ease-in-out_infinite]" />
        </div>
      )}
      <div className={`space-y-4 transition-opacity duration-200 ${isFetching && !isLoading ? "opacity-60" : "opacity-100"}`}>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
        <Tile
          title="Actual cost (MTD)"
          value={isLoading ? null : data ? fmt(data.monthToDate, data.currency) : "$0.00"}
        />
        <Tile title="Forecasted cost" value={isLoading ? null : data ? fmt(data.forecast, data.currency) : "$0.00"} />
        <div className="bg-card border border-border p-3 shadow-sm flex flex-col justify-between">
          <div className="text-[12px] text-muted-foreground font-medium mb-1">API usage (MTD)</div>
          {isLoading || !data ? <Skeleton className="h-7 w-20 mt-1" /> : (
            <>
              <div className="text-xl font-semibold text-foreground mt-1 tabular-nums">{fmt(data.apiUsage.cost, data.currency)}</div>
              <div className="text-[11px] text-muted-foreground tabular-nums mt-0.5">{fmtInt(data.apiUsage.totalCalls)} calls</div>
            </>
          )}
        </div>
        <div className="bg-card border border-border p-3 shadow-sm flex flex-col justify-between">
          <div className="text-[12px] text-muted-foreground font-medium mb-1">Budget utilization</div>
          {isLoading || !data ? <Skeleton className="h-7 w-full mt-1" /> : (
            <div className="space-y-1 mt-1">
              <div className="flex justify-between text-[11px]">
                <span className="font-semibold text-foreground tabular-nums">{fmt(data.monthToDate, data.currency)}</span>
                <span className="text-muted-foreground tabular-nums">{fmt(data.budget, data.currency)}</span>
              </div>
              <Progress value={budgetPercent} className="h-1.5 rounded-none bg-muted" />
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center px-1.5 py-0.5 border border-border bg-muted/40 text-foreground font-semibold tracking-wide uppercase text-[10px]">Mock</span>
        Revenue figures below are sample data. Real values would come from Stripe, App Store Connect, and Google Play.
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
        <Tile title="Revenue (MTD)" value={isLoading || !data ? null : fmt(data.revenue.total, data.revenue.currency)} />
        <div className="bg-card border border-border p-3 shadow-sm flex flex-col justify-between">
          <div className="text-[12px] text-muted-foreground font-medium mb-1">Net (Revenue − Cost)</div>
          {isLoading || !data ? <Skeleton className="h-7 w-20 mt-1" /> : (
            <div className={`text-xl font-semibold mt-1 tabular-nums flex items-center gap-1.5 ${netClass}`}>
              {net >= 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
              {fmt(net, data.currency)}
            </div>
          )}
        </div>
        <div className="bg-card border border-border p-3 shadow-sm flex flex-col justify-between">
          <div className="text-[12px] text-muted-foreground font-medium mb-1">Gross margin</div>
          {isLoading || !data ? <Skeleton className="h-7 w-20 mt-1" /> : (
            <div className={`text-xl font-semibold mt-1 tabular-nums ${netClass}`}>
              {marginPct === null ? "—" : `${marginPct.toFixed(1)}%`}
            </div>
          )}
        </div>
        <div className="bg-card border border-border p-3 shadow-sm flex flex-col justify-between">
          <div className="text-[12px] text-muted-foreground font-medium mb-1">Revenue by source</div>
          {isLoading || !data ? <Skeleton className="h-7 w-full mt-1" /> : data.revenue.total === 0 ? (
            <div className="text-[11px] text-muted-foreground mt-2">No revenue sources configured (internal app).</div>
          ) : (
            <div className="space-y-0.5 mt-1 text-[11px] tabular-nums">
              {data.revenue.bySource.map((s) => (
                <div key={s.source} className="flex justify-between">
                  <span className="text-muted-foreground truncate pr-2">{s.label}</span>
                  <span className="font-mono text-foreground">{fmt(s.amount, data.revenue.currency)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Panel
          title="Cost by Service"
          toolbar={
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs px-2 rounded-sm text-primary hover:text-primary hover:bg-primary/10"
                onClick={handleBreakdownExport}
                disabled={!data?.byService?.length}
              >
                <Download className="h-3.5 w-3.5 mr-1.5" />
                Export
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs px-2 rounded-sm text-primary hover:text-primary hover:bg-primary/10"
                onClick={handleBreakdownCopy}
                disabled={!data?.byService?.length}
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
          }
        >
          <Table className="text-[13px]">
            <THead>
              <TableHead className="h-8 font-semibold text-foreground">Service</TableHead>
              <TableHead className="h-8 font-semibold text-foreground text-right w-[130px]">Cost (MTD)</TableHead>
              <TableHead className="h-8 font-semibold text-foreground text-right w-[80px]">WoW</TableHead>
              <TableHead className="h-8 font-semibold text-foreground w-[160px]"></TableHead>
            </THead>
            <TableBody>
              {isLoading || !data ? (
                <SkeletonRows cols={4} rows={5} />
              ) : (
                data.byService.map((svc, i) => {
                  const trend = svc.trend;
                  const isPos = trend?.startsWith("+");
                  const isNeg = trend?.startsWith("-");
                  const trendClass = isPos
                    ? "text-destructive"
                    : isNeg
                      ? "text-emerald-500"
                      : "text-muted-foreground";
                  return (
                    <TableRow key={i} className="h-8 border-b border-border/50 hover:bg-muted/40">
                      <TableCell className="py-1 font-medium">{svc.service}</TableCell>
                      <TableCell className="py-1 text-right font-mono text-[12px]">{fmt(svc.amount, data.currency)}</TableCell>
                      <TableCell className={`py-1 text-right font-mono text-[11px] ${trendClass}`}>
                        {trend ?? <span className="text-muted-foreground/50">—</span>}
                      </TableCell>
                      <TableCell className="py-1">
                        <Progress value={(svc.amount / data.monthToDate) * 100} className="h-1.5 rounded-none bg-muted" />
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </Panel>

        <Panel
          title="Cost by API Name"
          rightHeader={data ? <span className="text-[11px] text-muted-foreground pr-2">{fmt(data.apiUsage.cost, data.currency)} @ {fmt(data.apiUsage.costPerMillion, data.currency)}/M calls</span> : null}
        >
          <Table className="text-[13px]">
            <THead>
              <TableHead className="h-8 font-semibold text-foreground">API Name</TableHead>
              <TableHead className="h-8 font-semibold text-foreground text-right w-[140px]">Calls (MTD)</TableHead>
              <TableHead className="h-8 font-semibold text-foreground text-right w-[110px]">Cost</TableHead>
              <TableHead className="h-8 font-semibold text-foreground w-[140px]"></TableHead>
            </THead>
            <TableBody>
              {isLoading || !data ? (
                <SkeletonRows cols={4} rows={6} />
              ) : (
                data.apiUsage.byApi?.map((row, idx) => {
                  const maxCost = data.apiUsage.byApi[0]?.cost || 1;
                  return (
                    <TableRow key={`${row.name}-${idx}`} className="h-8 border-b border-border/50 hover:bg-muted/40">
                      <TableCell className="py-1 font-mono text-[12px] font-medium">{row.name}</TableCell>
                      <TableCell className="py-1 text-right font-mono text-[12px] tabular-nums text-muted-foreground">{fmtInt(row.totalCalls)}</TableCell>
                      <TableCell className="py-1 text-right font-mono text-[12px] tabular-nums">{fmt(row.cost, data.currency)}</TableCell>
                      <TableCell className="py-1">
                        <Progress value={(row.cost / maxCost) * 100} className="h-1.5 rounded-none bg-muted" />
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </Panel>
      </div>
      </div>
    </>
  );
}

/* --- small layout helpers --- */

function Panel({
  title,
  toolbar,
  rightHeader,
  bodyClassName = "overflow-x-auto",
  children,
}: {
  title: string;
  toolbar?: React.ReactNode;
  rightHeader?: React.ReactNode;
  bodyClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-card border border-border shadow-sm flex flex-col">
      <div className="flex items-center justify-between p-2 border-b border-border bg-card">
        <h2 className="text-sm font-semibold px-2">{title}</h2>
        {toolbar ?? rightHeader}
      </div>
      <div className={bodyClassName}>{children}</div>
    </div>
  );
}

function THead({ children }: { children: React.ReactNode }) {
  return (
    <TableHeader className="bg-muted/50 hover:bg-muted/50 border-b border-border">
      <TableRow className="hover:bg-transparent">{children}</TableRow>
    </TableHeader>
  );
}

function SkeletonRows({ cols, rows }: { cols: number; rows: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, i) => (
        <TableRow key={i} className="h-8 border-b border-border/50">
          {Array.from({ length: cols }).map((__, j) => (
            <TableCell key={j}><Skeleton className="h-4 w-24" /></TableCell>
          ))}
        </TableRow>
      ))}
    </>
  );
}

function ToolbarBtn({ icon: Icon, children, onClick }: { icon: React.ComponentType<{ className?: string }>; children: React.ReactNode; onClick?: () => void }) {
  return (
    <Button variant="ghost" size="sm" className="h-7 text-xs px-2 rounded-sm text-primary hover:text-primary hover:bg-primary/10" onClick={onClick}>
      <Icon className="h-3.5 w-3.5 mr-1.5" />
      {children}
    </Button>
  );
}

function Tile({ title, value, badge }: { title: string; value: React.ReactNode; badge?: React.ReactNode }) {
  return (
    <div className="bg-card border border-border p-3 shadow-sm flex flex-col justify-between">
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="text-[12px] text-muted-foreground font-medium truncate">{title}</div>
        {badge}
      </div>
      {value === null ? (
        <Skeleton className="h-7 w-20 mt-1" />
      ) : (
        <div className="text-xl font-semibold text-foreground mt-1 tabular-nums">{value}</div>
      )}
    </div>
  );
}
