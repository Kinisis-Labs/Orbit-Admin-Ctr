import {
  useGetCost,
  getGetCostQueryKey,
  useListAnomalyDismissals,
  getListAnomalyDismissalsQueryKey,
  useDismissAnomaly,
  getCost,
  useGetGlobalCostSummary,
  getGetGlobalCostSummaryQueryKey,
} from "@workspace/api-client-react";
import { useQueries } from "@tanstack/react-query";
import { AdminAccessBadge } from "@/components/admin-access-badge";
import { useApps } from "@/hooks/use-apps";
import { useBudgetThreshold } from "@/lib/spend-threshold";
import { BudgetAlertHistory } from "@/components/budget-alert-history";
import { Skeleton } from "@/components/ui/skeleton";
import { useForceRefresh } from "@/hooks/use-force-refresh";
import { ForceRefreshButton } from "@/components/force-refresh-button";
import { StaleCacheBanner } from "@/components/stale-cache-banner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { Link, useSearch, useLocation } from "wouter";
import { Download, PieChart, RefreshCw, TrendingUp, TrendingDown, AlertTriangle, X, ChevronDown, ChevronUp, TableIcon, CalendarSearch, TriangleAlert, ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";
import { DataSourceBadge } from "@/components/data-source-badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { ScopeSelect } from "@/lib/scope";
import { useScope } from "@/lib/scope-context";
import { CsvToolbar } from "@/components/csv-toolbar";
import { useCsvExport } from "@/hooks/use-csv-export";
import { useMemo, useState, useEffect, useRef } from "react";
import { DailySpendChart, type DailyCostPoint, type DailySpendRange } from "@/components/daily-spend-chart";
import { computeAnomalies } from "@/components/daily-spend-utils";
import { format, parseISO, isValid } from "date-fns";

const fmt = (amount: number, currency = "USD") =>
  new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
const fmtInt = (n: number) => new Intl.NumberFormat("en-US").format(n);

const ANOMALY_SIGMAS = 2;
const ANOMALY_WINDOW = 30;
const ANOMALY_RECENT_DAYS = 3;

function isoDate(ts: string | Date): string {
  return new Date(ts).toISOString().slice(0, 10);
}

export function detectRecentAnomaly(daily: DailyCostPoint[] | undefined | null): {
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
const LS_DAILY_TABLE_KEY = (scope: string) => `orbit-cost-daily-table-${scope}`;

function AnomalyAlertBanner({
  appId,
  anomaly,
  formatCurrency,
  onViewInChart,
}: {
  appId: string;
  anomaly: ReturnType<typeof detectRecentAnomaly>;
  formatCurrency: (v: number) => string;
  onViewInChart?: () => void;
}) {
  // Optimistic localStorage check — prevents a visible flash on repeat visits
  const [dismissedLocally, setDismissedLocally] = useState<boolean>(() => {
    try {
      return localStorage.getItem(LS_KEY_PREFIX + (anomaly?.dateKey ?? "")) === "1";
    } catch {
      return false;
    }
  });

  // Server-side dismissal state — survives browser storage clears & private windows
  const dismissalsQueryKey = getListAnomalyDismissalsQueryKey({ appId });
  const { data: serverDismissals } = useListAnomalyDismissals(
    { appId },
    { query: { enabled: !!appId && !!anomaly, queryKey: dismissalsQueryKey } },
  );
  const { mutate: serverDismiss } = useDismissAnomaly();

  if (!anomaly) return null;

  const dismissedOnServer = serverDismissals?.dismissedDateKeys.includes(anomaly.dateKey) ?? false;
  if (dismissedLocally || dismissedOnServer) return null;

  function dismiss() {
    if (!anomaly) return;
    // Optimistic local update first
    try { localStorage.setItem(LS_KEY_PREFIX + anomaly.dateKey, "1"); } catch { /* ignore */ }
    setDismissedLocally(true);
    // Persist server-side keyed to the session
    serverDismiss({ data: { appId, dateKey: anomaly.dateKey } });
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
          .
        </span>
        {onViewInChart && (
          <button
            onClick={onViewInChart}
            className="ml-2 inline-flex items-center gap-1 text-[12px] font-semibold underline underline-offset-2 decoration-amber-500/60 hover:decoration-amber-600 dark:decoration-amber-400/60 dark:hover:decoration-amber-300 transition-colors"
          >
            <CalendarSearch className="h-3 w-3 shrink-0" />
            View in chart
          </button>
        )}
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
  const isGlobal = scope === "global";

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-foreground tracking-tight">
            {isGlobal ? "Cost — All Applications" : `Cost — ${selectedApp?.name ?? ""}`}
          </h1>
          <p className="text-[12px] text-muted-foreground mt-0.5">
            {isGlobal ? "Cost and revenue across all tracked applications" : `Scoped to ${selectedApp?.name ?? "application"}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <AdminAccessBadge />
          <ScopeSelect allowGlobal />
        </div>
      </div>

      {isGlobal ? (
        <>
          <GlobalCostPanel />
          <GlobalCost />
        </>
      ) : <AppCost />}
    </div>
  );
}

function GlobalCostPanel() {
  const { data, isLoading } = useGetGlobalCostSummary({
    query: { queryKey: getGetGlobalCostSummaryQueryKey(), staleTime: 5 * 60 * 1000 },
  });

  const totalApps = data?.byApp.length ?? 0;
  const maxMtd = data?.byApp.reduce((m, r) => Math.max(m, r.monthToDate), 0) ?? 0;

  return (
    <Panel title="Cost by Application">
      <Table className="text-[13px]">
        <THead>
          <TableHead className="h-8 font-semibold text-foreground">Application</TableHead>
          <TableHead className="h-8 font-semibold text-foreground">Env</TableHead>
          <TableHead className="h-8 font-semibold text-foreground text-right w-[130px]">Cost (MTD)</TableHead>
          <TableHead className="h-8 font-semibold text-foreground text-right w-[80px]">WoW</TableHead>
          <TableHead className="h-8 font-semibold text-foreground w-[160px]"></TableHead>
        </THead>
        <TableBody>
          {isLoading || !data ? (
            <SkeletonRows cols={5} rows={3} />
          ) : (
            data.byApp.map((row) => {
              const trend = row.trend ?? null;
              const isPos = trend?.startsWith("+");
              const isNeg = trend?.startsWith("-");
              const trendClass = isPos
                ? "text-destructive"
                : isNeg
                  ? "text-emerald-500"
                  : "text-muted-foreground";
              return (
                <TableRow key={row.appId} className="h-8 border-b border-border/50 hover:bg-muted/40">
                  <TableCell className="py-1 font-medium">{row.appName}</TableCell>
                  <TableCell className="py-1 text-[11px] text-muted-foreground">{row.environment}</TableCell>
                  <TableCell className="py-1 text-right font-mono text-[12px]">{fmt(row.monthToDate)}</TableCell>
                  <TableCell className={`py-1 text-right font-mono text-[11px] ${trendClass}`}>
                    {trend ?? <span className="text-muted-foreground/50">—</span>}
                  </TableCell>
                  <TableCell className="py-1">
                    <Progress
                      value={maxMtd > 0 ? (row.monthToDate / maxMtd) * 100 : 0}
                      className="h-1.5 rounded-none bg-muted"
                    />
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
      {!isLoading && data && (
        <div className="px-3 py-2 border-t border-border bg-muted/30 flex items-center justify-between text-[11px] text-muted-foreground">
          <span>{totalApps} application{totalApps !== 1 ? "s" : ""}</span>
          <span className="font-mono font-semibold text-foreground">{fmt(data.total)} total MTD</span>
        </div>
      )}
    </Panel>
  );
}


function GlobalCost() {
  const { data: apps, isLoading: appsLoading } = useApps();

  const costQueries = useQueries({
    queries: (apps ?? []).map((app) => ({
      queryKey: getGetCostQueryKey(app.id),
      queryFn: () => getCost(app.id),
      staleTime: 5 * 60 * 1000,
    })),
  });

  const isLoading = appsLoading || costQueries.some((q) => q.isLoading);

  const currency = costQueries.find((q) => q.data)?.data?.currency ?? "USD";

  const tableRows = useMemo(() => {
    if (!apps || isLoading) return null;
    return apps.map((app, i) => {
      const costData = costQueries[i]?.data;
      const cost = costData?.monthToDate ?? app.monthToDateCost;
      const stripe = costData?.revenue.bySource.find((s) => s.source === "stripe")?.amount ?? 0;
      const appStore = costData?.revenue.bySource.find((s) => s.source === "app_store")?.amount ?? 0;
      const playStore = costData?.revenue.bySource.find((s) => s.source === "play_store")?.amount ?? 0;
      const revenue = costData?.revenue.total ?? stripe + appStore + playStore;
      const net = revenue - cost;
      const marginPct = revenue > 0 ? (net / revenue) * 100 : null;
      return { app, cost, stripe, appStore, playStore, revenue, net, marginPct };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apps, isLoading, costQueries.map((q) => q.dataUpdatedAt).join(",")]);

  const csvHeaders = ["Application", "Cost", "Stripe", "App Store", "Play Store", "Revenue", "Net", "Margin %"];
  const csvRows = useMemo(() => {
    if (!tableRows) return null;
    return tableRows.map((r) => [
      r.app.name,
      r.cost.toFixed(2),
      r.stripe.toFixed(2),
      r.appStore.toFixed(2),
      r.playStore.toFixed(2),
      r.revenue.toFixed(2),
      r.net.toFixed(2),
      r.marginPct != null ? r.marginPct.toFixed(1) + "%" : "—",
    ]);
  }, [tableRows]);

  const {
    copied,
    disabled: csvDisabled,
    handleExport,
    handleCopy,
  } = useCsvExport(csvRows, csvHeaders, "cost-vs-revenue-by-app");

  return (
    <Panel
      title="Cost vs Revenue by Application"
      toolbar={
        <div className="flex items-center gap-1">
          <CsvToolbar
            handleExport={handleExport}
            handleCopy={handleCopy}
            disabled={csvDisabled}
            copied={copied}
          />
        </div>
      }
    >
      <Table className="text-[13px]">
        <THead>
          <TableHead className="h-8 font-semibold text-foreground">Application</TableHead>
          <TableHead className="h-8 font-semibold text-foreground text-right w-[110px]">Cost</TableHead>
          <TableHead className="h-8 font-semibold text-foreground text-right w-[100px]">Stripe</TableHead>
          <TableHead className="h-8 font-semibold text-foreground text-right w-[110px]">App Store</TableHead>
          <TableHead className="h-8 font-semibold text-foreground text-right w-[110px]">Play Store</TableHead>
          <TableHead className="h-8 font-semibold text-foreground text-right w-[110px]">Revenue</TableHead>
          <TableHead className="h-8 font-semibold text-foreground text-right w-[110px]">Net</TableHead>
          <TableHead className="h-8 font-semibold text-foreground text-right w-[90px]">Margin %</TableHead>
        </THead>
        <TableBody>
          {isLoading ? (
            <SkeletonRows cols={8} rows={3} />
          ) : (
            (tableRows ?? []).map((row) => {
              const netClass =
                row.net > 0
                  ? "text-emerald-600 dark:text-emerald-400"
                  : row.net < 0
                    ? "text-destructive"
                    : "text-muted-foreground";
              const marginClass =
                row.marginPct == null
                  ? "text-muted-foreground"
                  : row.marginPct > 0
                    ? "text-emerald-600 dark:text-emerald-400"
                    : row.marginPct < 0
                      ? "text-destructive"
                      : "text-muted-foreground";
              return (
                <TableRow key={row.app.id} className="h-8 border-b border-border/50 hover:bg-muted/40">
                  <TableCell className="py-1 font-medium">
                    {row.app.name}
                    <span className="text-muted-foreground text-[11px] ml-1.5">· {row.app.environment}</span>
                  </TableCell>
                  <TableCell className="py-1 text-right font-mono text-[12px] tabular-nums">{fmt(row.cost, currency)}</TableCell>
                  <TableCell className="py-1 text-right font-mono text-[12px] tabular-nums text-muted-foreground">
                    {row.stripe > 0 ? fmt(row.stripe, currency) : <span className="opacity-30">—</span>}
                  </TableCell>
                  <TableCell className="py-1 text-right font-mono text-[12px] tabular-nums text-muted-foreground">
                    {row.appStore > 0 ? fmt(row.appStore, currency) : <span className="opacity-30">—</span>}
                  </TableCell>
                  <TableCell className="py-1 text-right font-mono text-[12px] tabular-nums text-muted-foreground">
                    {row.playStore > 0 ? fmt(row.playStore, currency) : <span className="opacity-30">—</span>}
                  </TableCell>
                  <TableCell className="py-1 text-right font-mono text-[12px] tabular-nums">{fmt(row.revenue, currency)}</TableCell>
                  <TableCell className={`py-1 text-right font-mono text-[12px] tabular-nums font-semibold ${netClass}`}>{fmt(row.net, currency)}</TableCell>
                  <TableCell className={`py-1 text-right font-mono text-[12px] tabular-nums font-semibold ${marginClass}`}>
                    {row.marginPct != null ? `${row.marginPct.toFixed(1)}%` : "—"}
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
    </Panel>
  );
}

function AppCost() {
  const { scope } = useScope();
  const { data: apps } = useApps();
  const selectedApp = apps?.find((a) => a.id === scope);
  const queryKey = getGetCostQueryKey(scope);
  const { data, isLoading, isFetching } = useGetCost(scope, undefined, {
    query: { queryKey, staleTime: 5 * 60 * 1000 },
  });
  const { isRefreshing, isCoolingDown, forceRefresh } = useForceRefresh(`/api/apps/${scope}/cost`, queryKey);
  const budgetPercent = data ? (data.monthToDate / data.budget) * 100 : 0;
  const budgetThreshold = useBudgetThreshold(scope);
  const net = data ? data.revenue.total - data.monthToDate : 0;
  const marginPct = data && data.revenue.total > 0 ? (net / data.revenue.total) * 100 : null;
  const netClass = net >= 0 ? "text-emerald-500" : "text-destructive";

  const [showDailyTable, setShowDailyTable] = useState(() => {
    try {
      return localStorage.getItem(LS_DAILY_TABLE_KEY(scope)) === "1";
    } catch {
      return false;
    }
  });
  const [copiedDaily, setCopiedDaily] = useState(false);

  useEffect(() => {
    try {
      setShowDailyTable(localStorage.getItem(LS_DAILY_TABLE_KEY(scope)) === "1");
    } catch {
      setShowDailyTable(false);
    }
  }, [scope]);

  type ServiceSortCol = "amount" | "trend";
  type SortDir = "asc" | "desc";
  const [serviceSortCol, setServiceSortCol] = useState<ServiceSortCol>("amount");
  const [serviceSortDir, setServiceSortDir] = useState<SortDir>("desc");

  function handleServiceSortClick(col: ServiceSortCol) {
    setServiceSortCol((prev) => {
      if (prev === col) {
        setServiceSortDir((d) => (d === "asc" ? "desc" : "asc"));
        return col;
      }
      setServiceSortDir(col === "amount" ? "desc" : "desc");
      return col;
    });
  }

  function parseTrend(trend: string | undefined | null): number {
    if (!trend) return -Infinity;
    const n = parseFloat(trend.replace(/[^0-9.\-+]/g, ""));
    return isNaN(n) ? -Infinity : n;
  }

  const chartRef = useRef<HTMLDivElement>(null);
  const [chartRange, setChartRange] = useState<DailySpendRange>(30);

  const anomaly = useMemo(() => detectRecentAnomaly(data?.daily), [data?.daily]);

  function handleViewInChart() {
    if (!anomaly || !data?.daily) return;
    const visibleSlice = data.daily.slice(-chartRange);
    const isVisible = visibleSlice.some((d) => isoDate(d.timestamp as string) === anomaly.dateKey);
    if (!isVisible) {
      setChartRange(30);
    }
    setTimeout(() => {
      chartRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  }

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

  const sortedByService = useMemo(() => {
    if (!data?.byService) return data?.byService;
    const mul = serviceSortDir === "asc" ? 1 : -1;
    return [...data.byService].sort((a, b) => {
      if (serviceSortCol === "amount") return mul * (a.amount - b.amount);
      return mul * (parseTrend(a.trend) - parseTrend(b.trend));
    });
  }, [data?.byService, serviceSortCol, serviceSortDir]);

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
          <DataSourceBadge dataSource={data.dataSource} dataAsOf={data.dataAsOf} label="Azure Cost Management" />
        </div>
      )}
      {!isLoading && data && (
        <StaleCacheBanner source="azure-cost" dataSource={data.dataSource} dataAsOf={data.dataAsOf} />
      )}
      {isFetching && !isLoading && (
        <div className="h-0.5 w-full overflow-hidden bg-transparent">
          <div className="h-full bg-primary/60 animate-[progress-bar_1.2s_ease-in-out_infinite]" />
        </div>
      )}
      {!isLoading && data?.daily && (
        <AnomalyAlertBanner
          appId={scope}
          anomaly={anomaly}
          formatCurrency={(v) => fmt(v, data.currency)}
          onViewInChart={anomaly ? handleViewInChart : undefined}
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
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Progress value={budgetPercent} className="h-1.5 rounded-none bg-muted cursor-default" />
                  </TooltipTrigger>
                  <TooltipContent>Alert at {budgetThreshold}% · {budgetPercent.toFixed(0)}% utilized</TooltipContent>
                </Tooltip>
              </TooltipProvider>
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

      <div ref={chartRef} className="bg-card border border-border shadow-sm flex flex-col">
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
                onClick={() => setShowDailyTable((v) => {
                  const next = !v;
                  try { localStorage.setItem(LS_DAILY_TABLE_KEY(scope), next ? "1" : "0"); } catch { /* ignore */ }
                  return next;
                })}
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
              range={chartRange}
              onRangeChange={setChartRange}
              sensitivityKey="orbit:anomaly-sigma:cost"
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
              <TableHead className="h-8 font-semibold text-foreground text-right w-[130px] p-0">
                <button
                  type="button"
                  onClick={() => handleServiceSortClick("amount")}
                  className="flex items-center justify-end gap-1 h-full w-full px-4 hover:text-foreground/70 transition-colors"
                >
                  Cost (MTD)
                  {serviceSortCol === "amount" ? (
                    serviceSortDir === "asc" ? <ArrowUp className="h-3 w-3 shrink-0" /> : <ArrowDown className="h-3 w-3 shrink-0" />
                  ) : (
                    <ArrowUpDown className="h-3 w-3 shrink-0 opacity-40" />
                  )}
                </button>
              </TableHead>
              <TableHead className="h-8 font-semibold text-foreground text-right w-[80px] p-0">
                <button
                  type="button"
                  onClick={() => handleServiceSortClick("trend")}
                  className="flex items-center justify-end gap-1 h-full w-full px-4 hover:text-foreground/70 transition-colors"
                >
                  WoW
                  {serviceSortCol === "trend" ? (
                    serviceSortDir === "asc" ? <ArrowUp className="h-3 w-3 shrink-0" /> : <ArrowDown className="h-3 w-3 shrink-0" />
                  ) : (
                    <ArrowUpDown className="h-3 w-3 shrink-0 opacity-40" />
                  )}
                </button>
              </TableHead>
              <TableHead className="h-8 font-semibold text-foreground w-[160px]"></TableHead>
            </THead>
            <TableBody>
              {isLoading || !data ? (
                <SkeletonRows cols={4} rows={5} />
              ) : (
                (sortedByService ?? []).map((svc, i) => {
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
