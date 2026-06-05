import {
  useGetCost,
  getGetCostQueryKey,
} from "@workspace/api-client-react";
import { useApps } from "@/hooks/use-apps";
import { BudgetAlertHistory } from "@/components/budget-alert-history";
import { Skeleton } from "@/components/ui/skeleton";
import { useForceRefresh } from "@/hooks/use-force-refresh";
import { ForceRefreshButton } from "@/components/force-refresh-button";
import { StaleCacheBanner } from "@/components/stale-cache-banner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { Link, useSearch, useLocation } from "wouter";
import { Download, PieChart, RefreshCw, TrendingUp, TrendingDown, Wifi, WifiOff, AlertTriangle, X, ChevronDown, ChevronUp, TableIcon, CalendarSearch, Database, TriangleAlert } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { ScopeSelect } from "@/lib/scope";
import { useScope } from "@/lib/scope-context";
import { CsvToolbar } from "@/components/csv-toolbar";
import { useCsvExport } from "@/hooks/use-csv-export";
import { useMemo, useState } from "react";
import { DailySpendChart, type DailyCostPoint } from "@/components/daily-spend-chart";
import { computeAnomalies } from "@/components/daily-spend-utils";
import { format, parseISO, isValid } from "date-fns";

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
  dataSource: "live" | "cached" | "mock" | undefined;
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
  if (dataSource === "cached") {
    const asOf = fmtDataAsOf(dataAsOf);
    return (
      <span className="inline-flex items-center gap-1.5 select-none flex-wrap">
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm border border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400 text-[10px] font-semibold uppercase tracking-wide">
          <Database className="h-3 w-3" />
          Cached — DB snapshot
        </span>
        {asOf && (
          <span className="inline-flex items-center gap-0.5 text-[10px] text-amber-600 dark:text-amber-400">
            <AlertTriangle className="h-3 w-3" />
            as of {asOf}
          </span>
        )}
      </span>
    );
  }
  return null;
}

const ANOMALY_SIGMAS = 2;
const ANOMALY_WINDOW = 30;
const ANOMALY_RECENT_DAYS = 3;

function isoDate(ts: string | Date): string {
  return new Date(ts).toISOString().slice(0, 10);
}

function detectRecentAnomaly(daily: DailyCostPoint[] | undefined | null): {
  date: Date;
  dateKey: string;
  value: number;
  vsAvgMultiple: number;
  excess: number;
  currency?: string;
} | null {
  if (!daily || daily.length < 3) return null;

  const window = daily.slice(-ANOMALY_WINDOW);
  const enriched = computeAnomalies(window, ANOMALY_WINDOW, ANOMALY_SIGMAS);

  const now = new Date();
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - ANOMALY_RECENT_DAYS);
  cutoff.setHours(0, 0, 0, 0);

  const recent = enriched
    .filter((d) => d.anomaly?.isAnomaly && new Date(d.timestamp) >= cutoff)
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  if (!recent.length) return null;

  const hit = recent[0];
  const vsAvgMultiple = hit.anomaly!.vsAvgMultiple;
  const mean = vsAvgMultiple > 0 ? hit.value / vsAvgMultiple : 0;
  const excess = hit.value - mean;

  return {
    date: new Date(hit.timestamp),
    dateKey: isoDate(hit.timestamp),
    value: hit.value,
    vsAvgMultiple,
    excess,
  };
}

const LS_KEY_PREFIX = "orbit-cost-anomaly-dismissed-";

function AnomalyAlertBanner({
  daily,
  formatCurrency,
}: {
  daily: DailyCostPoint[] | undefined | null;
  formatCurrency: (v: number) => string;
}) {
  const anomaly = useMemo(() => detectRecentAnomaly(daily), [daily]);
  const [dismissed, setDismissed] = useState<string | null>(() => {
    try {
      return localStorage.getItem(LS_KEY_PREFIX + (anomaly?.dateKey ?? "")) ?? null;
    } catch {
      return null;
    }
  });

  if (!anomaly) return null;

  const lsKey = LS_KEY_PREFIX + anomaly.dateKey;
  if (dismissed === "1") return null;

  function dismiss() {
    try { localStorage.setItem(lsKey, "1"); } catch { /* ignore */ }
    setDismissed("1");
  }

  const dateLabel = format(anomaly.date, "EEE, MMM d");
  const multipleLabel = `${anomaly.vsAvgMultiple.toFixed(1)}×`;

  return (
    <div className="flex items-start gap-3 px-3 py-2.5 rounded-sm border border-amber-500/50 bg-amber-500/10 text-amber-800 dark:text-amber-300">
      <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-amber-500" />
      <div className="flex-1 min-w-0 text-[13px] leading-snug">
        <span className="font-semibold">Cost anomaly detected — </span>
        <span>
          {dateLabel} was {multipleLabel} the 30-day average
          {anomaly.excess > 0 && (
            <>, an estimated <span className="font-semibold">{formatCurrency(anomaly.excess)}</span> above baseline</>
          )}
          . Check the Daily Spend chart below.
        </span>
      </div>
      <button
        onClick={dismiss}
        className="shrink-0 text-amber-600 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-200 transition-colors"
        aria-label="Dismiss anomaly alert"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

export default function Cost() {
  const { scope } = useScope();
  const { data: apps } = useApps();
  const selectedApp = apps?.find((a) => a.id === scope);

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-foreground tracking-tight">
            {`Cost — ${selectedApp?.name ?? ""}`}
          </h1>
          <p className="text-[12px] text-muted-foreground mt-0.5">
            {`Scoped to ${selectedApp?.name ?? "application"}`}
          </p>
        </div>
        <ScopeSelect />
      </div>

      <AppCost />
    </div>
  );
}


function AppCost() {
  const { scope } = useScope();
  const { data: apps } = useApps();
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

  const [showDailyTable, setShowDailyTable] = useState(false);
  const [copiedDaily, setCopiedDaily] = useState(false);

  const breakdownHeaders = ["Service", "Resource Group", "Environment", "Cost (USD)", "% of Total", "Trend"];
  const breakdownRows = useMemo(() => {
    if (!data?.byService?.length) return null;
    const resourceGroup = selectedApp?.resourceGroup ?? "";
    const environment = selectedApp?.environment ?? "";
    return data.byService.map((svc) => [
      svc.service,
      resourceGroup,
      environment,
      svc.amount.toFixed(2),
      data.monthToDate > 0 ? ((svc.amount / data.monthToDate) * 100).toFixed(1) + "%" : "0.0%",
      svc.trend ?? "N/A",
    ]);
  }, [data, selectedApp]);

  const {
    copied,
    disabled: breakdownDisabled,
    handleExport: handleBreakdownExport,
    handleCopy: handleBreakdownCopy,
  } = useCsvExport(breakdownRows, breakdownHeaders, `cost-breakdown-${scope}`);

  const search = useSearch();
  const [, navigate] = useLocation();
  const dateParam = new URLSearchParams(search).get("date");
  const dateFilter = (() => {
    if (!dateParam) return null;
    const parsed = parseISO(dateParam);
    return isValid(parsed) ? parsed : null;
  })();

  function dismissDateFilter() {
    const params = new URLSearchParams(search);
    params.delete("date");
    const qs = params.toString();
    navigate(qs ? `/cost?${qs}` : "/cost", { replace: true });
  }

  function buildDailyCsv() {
    if (!data?.daily?.length) return null;
    const headers = ["Date", "Spend (USD)", "vs Last Week (%)"];
    const rows = [...data.daily].reverse().map((day) => {
      const dateLabel = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(day.timestamp as string));
      const pct = day.vsLastWeek;
      const pctLabel = pct == null ? "" : `${pct > 0 ? "+" : ""}${pct.toFixed(1)}%`;
      return [dateLabel, day.value.toFixed(2), pctLabel];
    });
    return [headers, ...rows]
      .map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
      .join("\n");
  }

  function handleDailyExport() {
    const csv = buildDailyCsv();
    if (!csv) return;
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `daily-spend-${scope}-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function handleDailyCopy() {
    const csv = buildDailyCsv();
    if (!csv) return;
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(csv).then(() => {
        setCopiedDaily(true);
        setTimeout(() => setCopiedDaily(false), 2000);
      }).catch(() => fallbackCopyDaily(csv));
    } else {
      fallbackCopyDaily(csv);
    }
  }

  function fallbackCopyDaily(text: string) {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try {
      document.execCommand("copy");
      setCopiedDaily(true);
      setTimeout(() => setCopiedDaily(false), 2000);
    } catch {
      // clipboard unavailable — silently skip
    } finally {
      document.body.removeChild(ta);
    }
  }

  return (
    <>
      {dateFilter && (
        <div className="flex items-center gap-2 px-3 py-2 border border-amber-500/30 bg-amber-500/8 rounded-sm text-[13px]">
          <CalendarSearch className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
          <span className="text-foreground font-medium">
            Drilled in from anomaly on{" "}
            <span className="font-semibold">{format(dateFilter, "EEEE, MMMM d, yyyy")}</span>
          </span>
          <span className="text-muted-foreground text-[11px] ml-1">— service breakdown below shows the full month</span>
          <button
            onClick={dismissDateFilter}
            className="ml-auto flex items-center justify-center h-5 w-5 rounded-sm hover:bg-amber-500/20 text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Dismiss date filter"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      {!isLoading && data && (
        <div className="flex items-center justify-end gap-2">
          {data.dataSource === "live" && (
            <ForceRefreshButton isRefreshing={isRefreshing} isCoolingDown={isCoolingDown} onRefresh={forceRefresh} />
          )}
          <DataSourceBadge dataSource={data.dataSource} dataAsOf={data.dataAsOf} />
        </div>
      )}
      {!isLoading && data && (
        <StaleCacheBanner dataSource={data.dataSource} dataAsOf={data.dataAsOf} />
      )}
      {isFetching && !isLoading && (
        <div className="h-0.5 w-full overflow-hidden bg-transparent">
          <div className="h-full bg-primary/60 animate-[progress-bar_1.2s_ease-in-out_infinite]" />
        </div>
      )}
      {!isLoading && data?.daily && (
        <AnomalyAlertBanner
          daily={data.daily}
          formatCurrency={(v) => fmt(v, data.currency)}
        />
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

      {!isLoading && data && data.revenue.total === 0 && (
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center px-1.5 py-0.5 border border-border bg-muted/40 text-muted-foreground font-semibold tracking-wide uppercase text-[10px]">No data</span>
          No revenue recorded this month. Stripe, App Store Connect, and Google Play sources will appear here once active.
        </div>
      )}

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

      <div className="bg-card border border-border shadow-sm flex flex-col">
        <div className="p-3 border-b border-border bg-card flex items-center justify-between">
          <h2 className="text-sm font-semibold">Daily Spend</h2>
          {!isLoading && data && data.daily.length > 0 && (
            <div className="flex items-center gap-1">
              {showDailyTable && (
                <CsvToolbar
                  handleExport={handleDailyExport}
                  handleCopy={handleDailyCopy}
                  disabled={false}
                  copied={copiedDaily}
                />
              )}
              <button
                onClick={() => setShowDailyTable((v) => !v)}
                className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors ml-1"
              >
                <TableIcon className="h-3.5 w-3.5" />
                {showDailyTable ? "Hide table" : "Show table"}
                {showDailyTable ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </button>
            </div>
          )}
        </div>
        <div className="p-4 h-72">
          {isLoading ? (
            <Skeleton className="h-full w-full" />
          ) : data?.daily?.length ? (
            <DailySpendChart
              daily={data.daily}
              formatCurrency={(v) => fmt(v, data.currency)}
              showAnomalies
              highlightPeak
              colorByTrend
              showLegend
            />
          ) : (
            <div className="h-full flex items-center justify-center text-muted-foreground text-sm">No daily data available</div>
          )}
        </div>
        {showDailyTable && data && data.daily.length > 0 && (
          <div className="border-t border-border overflow-x-auto">
            <Table className="text-[13px]">
              <TableHeader className="bg-muted/50 border-b border-border">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="h-8 font-semibold text-foreground w-[140px]">Date</TableHead>
                  <TableHead className="h-8 font-semibold text-foreground text-right w-[140px]">Spend</TableHead>
                  <TableHead className="h-8 font-semibold text-foreground text-right w-[140px]">vs Last Week</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {([...data.daily] as DailyCostPoint[]).reverse().map((day) => {
                  const pct = day.vsLastWeek;
                  const pctClass =
                    pct == null
                      ? "text-muted-foreground/50"
                      : pct > 15
                        ? "text-destructive"
                        : pct > 0
                          ? "text-amber-500 dark:text-amber-400"
                          : "text-emerald-600 dark:text-emerald-400";
                  const pctLabel =
                    pct == null
                      ? "—"
                      : `${pct > 0 ? "+" : ""}${pct.toFixed(1)}%`;
                  return (
                    <TableRow key={day.timestamp as string} className="h-8 border-b border-border/50 hover:bg-muted/40">
                      <TableCell className="py-1 font-medium tabular-nums text-[12px]">
                        {new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(day.timestamp as string))}
                      </TableCell>
                      <TableCell className="py-1 text-right font-mono text-[12px] tabular-nums">
                        {fmt(day.value, data.currency)}
                      </TableCell>
                      <TableCell className={`py-1 text-right font-mono text-[12px] tabular-nums font-semibold ${pctClass}`}>
                        {pctLabel}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Panel
          title="Cost by Service"
          toolbar={
            <div className="flex items-center gap-1">
              <CsvToolbar
                handleExport={handleBreakdownExport}
                handleCopy={handleBreakdownCopy}
                disabled={breakdownDisabled}
                copied={copied}
              />
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

      <BudgetAlertHistory appId={scope} />
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
