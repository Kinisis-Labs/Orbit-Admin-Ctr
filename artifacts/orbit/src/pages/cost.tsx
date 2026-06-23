import {
  useGetCost,
  getGetCostQueryKey,
  useListAnomalyDismissals,
  getListAnomalyDismissalsQueryKey,
  useDismissAnomaly,
  useUndismissAnomaly,
  getCost,
  useGetGlobalCostSummary,
  getGetGlobalCostSummaryQueryKey,
  useGetGlobalHealth,
  getGetGlobalHealthQueryKey,
  getListAppsQueryKey,
  type OpsCostSummary,
} from "@workspace/api-client-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useUnacknowledgedBudgetAlerts } from "@/hooks/use-unacknowledged-budget-alerts";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { AdminAccessBadge } from "@/components/admin-access-badge";
import { useApps } from "@/hooks/use-apps";
import { useBudgetThreshold } from "@/lib/spend-threshold";
import { BudgetThresholdPopover, getBudgetBarClass } from "@/components/budget-threshold-popover";
import { BudgetAlertHistory } from "@/components/budget-alert-history";
import { Skeleton } from "@/components/ui/skeleton";
import { useForceRefresh } from "@/hooks/use-force-refresh";
import { ForceRefreshButton } from "@/components/force-refresh-button";
import { StaleCacheBanner } from "@/components/stale-cache-banner";
import { RefreshingBar } from "@/components/refreshing-bar";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { Link, useSearch, useLocation } from "wouter";
import {
  Download,
  PieChart,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  X,
  ChevronDown,
  ChevronUp,
  TableIcon,
  CalendarSearch,
  TriangleAlert,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  Filter,
  Users,
  RotateCcw,
  Building2,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DataSourceBadge } from "@/components/data-source-badge";
import { CostDataSourceBadge } from "@/components/cost-data-source-badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { ScopeSelect } from "@/lib/scope";
import { useScope } from "@/lib/scope-context";
import { CsvToolbar } from "@/components/csv-toolbar";
import { useCsvExport } from "@/hooks/use-csv-export";
import { useMemo, useState, useEffect, useRef, useCallback } from "react";
import {
  DailySpendChart,
  type DailyCostPoint,
  type DailySpendRange,
  readSigma,
} from "@/components/daily-spend-chart";
import { computeAnomalies } from "@/components/daily-spend-utils";
import { format, parseISO, isValid } from "date-fns";

const fmt = (amount: number, currency = "USD") =>
  new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
const fmtInt = (n: number) => new Intl.NumberFormat("en-US").format(n);

function fmtRelativeTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  try {
    const diffMs = Date.now() - new Date(iso).getTime();
    if (diffMs < 60_000) return "just now";
    if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)}m ago`;
    if (diffMs < 86_400_000) return `${Math.floor(diffMs / 3_600_000)}h ago`;
    return `${Math.floor(diffMs / 86_400_000)}d ago`;
  } catch {
    return null;
  }
}

const ANOMALY_SIGMAS = 2;
const ANOMALY_WINDOW = 30;
const ANOMALY_RECENT_DAYS = 3;
const SENSITIVITY_KEY = "orbit:anomaly-sigma:cost";

function isoDate(ts: string | Date): string {
  return new Date(ts).toISOString().slice(0, 10);
}

export function detectRecentAnomaly(
  daily: DailyCostPoint[] | undefined | null,
  sigmas = ANOMALY_SIGMAS,
): {
  date: Date;
  dateKey: string;
  value: number;
  vsAvgMultiple: number;
  windowLabel: string;
  isPeak: boolean;
  excess: number;
  currency?: string;
} | null {
  if (!daily || daily.length < 3) return null;

  const window = daily.slice(-ANOMALY_WINDOW);
  const enriched = computeAnomalies(window, ANOMALY_WINDOW, sigmas);

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
  const windowLabel = hit.anomaly!.windowLabel;
  const mean = vsAvgMultiple > 0 ? hit.value / vsAvgMultiple : 0;
  const excess = hit.value - mean;

  const maxValue = Math.max(...enriched.map((d) => d.value));
  const hasVariance = enriched.some((d) => d.value !== maxValue);
  const isPeak = hasVariance && hit.value === maxValue;

  return {
    date: new Date(hit.timestamp),
    dateKey: isoDate(hit.timestamp),
    value: hit.value,
    vsAvgMultiple,
    windowLabel,
    isPeak,
    excess,
  };
}

const LS_KEY_PREFIX = "orbit-cost-anomaly-dismissed-";
const LS_DAILY_TABLE_KEY = (scope: string) => `orbit-cost-daily-table-${scope}`;
const LS_SERVICE_SORT_KEY = (scope: string) => `orbit-cost-service-sort-${scope}`;

type ServiceSortCol = "amount" | "trend";
type SortDir = "asc" | "desc";

function loadServiceSort(scope: string): { col: ServiceSortCol; dir: SortDir } {
  try {
    const raw = localStorage.getItem(LS_SERVICE_SORT_KEY(scope));
    if (raw) {
      const parsed = JSON.parse(raw) as { col: unknown; dir: unknown };
      if (
        (parsed.col === "amount" || parsed.col === "trend") &&
        (parsed.dir === "asc" || parsed.dir === "desc")
      ) {
        return { col: parsed.col, dir: parsed.dir };
      }
    }
  } catch {
    /* ignore */
  }
  return { col: "amount", dir: "desc" };
}

function AnomalyAlertBanner({
  appId,
  appName,
  anomaly,
  formatCurrency,
  onViewInChart,
  onDismiss,
  sigmas,
}: {
  appId: string;
  appName?: string;
  anomaly: ReturnType<typeof detectRecentAnomaly>;
  formatCurrency: (v: number) => string;
  onViewInChart?: () => void;
  onDismiss?: () => void;
  sigmas?: number;
}) {
  // Optimistic localStorage check — prevents a visible flash on repeat visits
  const [dismissedLocally, setDismissedLocally] = useState<boolean>(() => {
    try {
      return localStorage.getItem(LS_KEY_PREFIX + (anomaly?.dateKey ?? "")) === "1";
    } catch {
      return false;
    }
  });

  const queryClient = useQueryClient();

  // Server-side dismissal state — survives browser storage clears & private windows
  const dismissalsQueryKey = getListAnomalyDismissalsQueryKey({ appId });
  const { data: serverDismissals } = useListAnomalyDismissals(
    { appId },
    { query: { enabled: !!appId && !!anomaly, queryKey: dismissalsQueryKey } },
  );
  const { mutate: serverDismiss } = useDismissAnomaly();
  const { mutate: serverUndismiss } = useUndismissAnomaly();

  if (!anomaly) return null;

  // Global (team-wide) dismissal for this anomaly date, if any
  const globalDismissal =
    serverDismissals?.globalDismissals.find((d) => d.dateKey === anomaly.dateKey) ?? null;

  // Session-scoped dismissal (this user only)
  const dismissedInSession =
    serverDismissals?.dismissedDateKeys.includes(anomaly.dateKey) && !globalDismissal
      ? true
      : false;

  // If dismissed in this session or locally (but no team dismissal) — hide entirely
  if (dismissedLocally || dismissedInSession) return null;

  function dismissForMe() {
    if (!anomaly) return;
    try {
      localStorage.setItem(LS_KEY_PREFIX + anomaly.dateKey, "1");
    } catch {
      /* ignore */
    }
    setDismissedLocally(true);
    serverDismiss({ data: { appId, dateKey: anomaly.dateKey, scope: "session" } });
    onDismiss?.();
  }

  function dismissForTeam() {
    if (!anomaly) return;
    try {
      localStorage.setItem(LS_KEY_PREFIX + anomaly.dateKey, "1");
    } catch {
      /* ignore */
    }
    setDismissedLocally(true);
    serverDismiss(
      { data: { appId, dateKey: anomaly.dateKey, scope: "global" } },
      { onSuccess: () => queryClient.invalidateQueries({ queryKey: dismissalsQueryKey }) },
    );
  }

  function showAgain() {
    if (!anomaly) return;
    try {
      localStorage.removeItem(LS_KEY_PREFIX + anomaly.dateKey);
    } catch {
      /* ignore */
    }
    setDismissedLocally(false);
    serverUndismiss(
      { params: { appId, dateKey: anomaly.dateKey } },
      { onSuccess: () => queryClient.invalidateQueries({ queryKey: dismissalsQueryKey }) },
    );
  }

  const dateLabel = format(anomaly.date, "EEE, MMM d");
  const multipleLabel = `${anomaly.vsAvgMultiple.toFixed(1)}× ${anomaly.windowLabel} avg`;
  const isPeak = anomaly.isPeak;

  // Team-dismissed state — show a muted "dismissed by X" row with a "Show again" action
  if (globalDismissal) {
    return (
      <div className="flex items-center gap-3 px-3 py-2 rounded-sm border border-border/60 bg-muted/40 text-muted-foreground text-[12px]">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0 opacity-50" />
        <span className="flex-1 min-w-0">
          Cost anomaly {appName ? `(${appName}) ` : ""}dismissed by{" "}
          <span className="font-medium text-foreground/70">
            {globalDismissal.dismissedBy ?? "a team member"}
          </span>{" "}
          —{" "}
          <button
            onClick={showAgain}
            className="inline-flex items-center gap-1 font-medium text-foreground/70 underline underline-offset-2 hover:text-foreground transition-colors"
          >
            <RotateCcw className="h-3 w-3" />
            Show again
          </button>
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-3 px-3 py-2.5 rounded-sm border border-amber-500/50 bg-amber-500/10 text-amber-800 dark:text-amber-300">
      <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-amber-500" />
      <div className="flex-1 min-w-0 text-[13px] leading-snug">
        <span className="font-semibold">
          {isPeak ? "Peak & anomaly" : "Cost anomaly detected"}
          {appName ? ` — ${appName}` : ""}
          {" — "}
        </span>
        <span>
          {dateLabel}: {multipleLabel}
          {anomaly.excess > 0 && (
            <>
              , an estimated <span className="font-semibold">{formatCurrency(anomaly.excess)}</span>{" "}
              above baseline
            </>
          )}
          .
        </span>
        {sigmas != null && (
          <span className="ml-1.5 text-[11px] font-medium opacity-70">({sigmas}σ sensitivity)</span>
        )}
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
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="shrink-0 text-amber-600 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-200 transition-colors"
            aria-label="Dismiss anomaly alert options"
          >
            <X className="h-4 w-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem onClick={dismissForMe} className="gap-2 cursor-pointer">
            <X className="h-3.5 w-3.5 shrink-0" />
            Dismiss for me
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={dismissForTeam} className="gap-2 cursor-pointer">
            <Users className="h-3.5 w-3.5 shrink-0" />
            Dismiss for everyone
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export default function Cost() {
  const { scope } = useScope();
  const { data: apps } = useApps();
  const selectedApp = apps?.find((a) => a.id === scope);
  const isGlobal = scope === "global";

  const { data: globalCostSummary, isLoading: globalCostLoading } = useGetGlobalCostSummary({
    query: {
      queryKey: getGetGlobalCostSummaryQueryKey(),
      staleTime: 5 * 60 * 1000,
      enabled: isGlobal,
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-foreground tracking-tight">
            {isGlobal ? "Cost — All Applications" : `Cost — ${selectedApp?.name ?? ""}`}
          </h1>
          <p className="text-[12px] text-muted-foreground mt-0.5">
            {isGlobal
              ? "Cost and revenue across all tracked applications"
              : `Scoped to ${selectedApp?.name ?? "application"}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isGlobal && !globalCostLoading && globalCostSummary && (
            <DataSourceBadge
              dataSource={globalCostSummary.dataSource}
              dataAsOf={globalCostSummary.dataAsOf ?? undefined}
              label="Azure Cost Management"
            />
          )}
          <AdminAccessBadge />
          <ScopeSelect allowGlobal />
        </div>
      </div>

      {isGlobal ? (
        <>
          <GlobalCostPanel />
          <GlobalCost />
        </>
      ) : (
        <AppCost />
      )}
    </div>
  );
}

function GlobalCostPanelRow({
  row,
  maxMtd,
  totalMtd,
  isTagMode,
}: {
  row: {
    appId: string;
    appName: string;
    environment: string;
    monthToDate: number;
    trend?: string | null;
  };
  maxMtd: number;
  totalMtd: number;
  isTagMode: boolean;
}) {
  const budgetThreshold = useBudgetThreshold(row.appId);
  const trend = row.trend ?? null;
  const isPos = trend?.startsWith("+");
  const isNeg = trend?.startsWith("-");
  const trendClass = isPos
    ? "text-destructive"
    : isNeg
      ? "text-emerald-500"
      : "text-muted-foreground";
  const rawUtilPct = maxMtd > 0 ? (row.monthToDate / maxMtd) * 100 : 0;
  const utilPct = Math.min(rawUtilPct, 100);
  const pctOfTotal = totalMtd > 0 ? (row.monthToDate / totalMtd) * 100 : 0;

  return (
    <TableRow key={row.appId} className="h-8 border-b border-border/50 hover:bg-muted/40">
      <TableCell className="py-1 font-medium">{row.appName}</TableCell>
      <TableCell className="py-1">
        {row.environment ? (
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
            {row.environment}
          </span>
        ) : null}
      </TableCell>
      <TableCell className="py-1 text-right font-mono text-[12px]">
        {fmt(row.monthToDate)}
      </TableCell>
      <TableCell className={`py-1 text-right font-mono text-[11px] ${trendClass}`}>
        {trend ?? <span className="text-muted-foreground/50">—</span>}
      </TableCell>
      <TableCell className="py-1">
        {isTagMode ? (
          <div className="flex items-center gap-2">
            <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-primary/60"
                style={{ width: `${Math.min(pctOfTotal, 100)}%` }}
              />
            </div>
            <span className="text-[11px] font-mono text-muted-foreground w-[38px] text-right shrink-0">
              {pctOfTotal.toFixed(1)}%
            </span>
          </div>
        ) : (
          <BudgetThresholdPopover
            appId={row.appId}
            utilPct={utilPct}
            rawUtilPct={rawUtilPct}
            budgetThreshold={budgetThreshold}
          />
        )}
      </TableCell>
    </TableRow>
  );
}

function GlobalCostPanel() {
  const { data, isLoading } = useGetGlobalCostSummary({
    query: { queryKey: getGetGlobalCostSummaryQueryKey(), staleTime: 5 * 60 * 1000 },
  });

  type GlobalSortCol = "amount" | "trend" | "budget";
  type SortDir = "asc" | "desc";
  const [sortCol, setSortCol] = useState<GlobalSortCol>("amount");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  function handleSortClick(col: GlobalSortCol) {
    setSortCol((prev) => {
      if (prev === col) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
        return col;
      }
      setSortDir("desc");
      return col;
    });
  }

  function parseTrend(trend: string | undefined | null): number {
    if (!trend) return -Infinity;
    const n = parseFloat(trend.replace(/[^0-9.\-+]/g, ""));
    return isNaN(n) ? -Infinity : n;
  }

  const costCenterRows = useMemo(() => data?.byCategory ?? [], [data?.byCategory]);

  const totalRows = costCenterRows.length;
  const rowLabel = "cost center";

  const maxMtd = useMemo(() => {
    return costCenterRows.reduce((m, r) => Math.max(m, r.monthToDate), 0);
  }, [costCenterRows]);

  const displayCategory = useCallback(
    (category: string) => (category === "Other" ? "Microsoft365" : category),
    [],
  );

  const sortedRows = useMemo(() => {
    const rows = costCenterRows.map((r) => ({
      appId: r.category,
      appName: displayCategory(r.category),
      environment: "",
      monthToDate: r.monthToDate,
      trend: null,
    }));
    if (sortCol === "amount")
      rows.sort((a, b) =>
        sortDir === "desc" ? b.monthToDate - a.monthToDate : a.monthToDate - b.monthToDate,
      );
    return rows;
  }, [costCenterRows, displayCategory, sortCol, sortDir]);

  function SortIcon({ col }: { col: GlobalSortCol }) {
    if (sortCol !== col) return <ArrowUpDown className="h-3 w-3 ml-1 opacity-40" />;
    return sortDir === "desc" ? (
      <ArrowDown className="h-3 w-3 ml-1 text-foreground" />
    ) : (
      <ArrowUp className="h-3 w-3 ml-1 text-foreground" />
    );
  }

  return (
    <Panel title="Cost by Cost Center">
      <Table className="text-[13px]">
        <THead>
          <TableHead className="h-8 font-semibold text-foreground">Cost Center</TableHead>
          <TableHead className="h-8 font-semibold text-foreground">Env</TableHead>
          <TableHead className="h-8 font-semibold text-foreground text-right w-[130px]">
            <button
              onClick={() => handleSortClick("amount")}
              className="inline-flex items-center justify-end w-full hover:text-foreground transition-colors"
            >
              Cost (MTD)
              <SortIcon col="amount" />
            </button>
          </TableHead>
          <TableHead className="h-8 font-semibold text-foreground text-right w-[80px]">
            <button
              onClick={() => handleSortClick("trend")}
              className="inline-flex items-center justify-end w-full hover:text-foreground transition-colors"
            >
              WoW
              <SortIcon col="trend" />
            </button>
          </TableHead>
          <TableHead className="h-8 font-semibold text-foreground w-[180px]">
            <button
              onClick={() => handleSortClick("budget")}
              className="inline-flex items-center justify-start w-full hover:text-foreground transition-colors"
            >
              % of Total
              <SortIcon col="budget" />
            </button>
          </TableHead>
        </THead>
        <TableBody>
          {isLoading || !data ? (
            <SkeletonRows cols={5} rows={3} />
          ) : (
            sortedRows.map((row) => (
              <GlobalCostPanelRow
                key={row.appId}
                row={row}
                maxMtd={maxMtd}
                totalMtd={data.total}
                isTagMode={true}
              />
            ))
          )}
        </TableBody>
      </Table>
      {!isLoading && data && (
        <div className="px-3 py-2 border-t border-border bg-muted/30 flex items-center justify-between text-[11px] text-muted-foreground">
          <span>
            {totalRows} {rowLabel}
            {totalRows !== 1 ? "s" : ""}
          </span>
          <span className="font-mono font-semibold text-foreground">
            {fmt(data.total)} total MTD
          </span>
        </div>
      )}
    </Panel>
  );
}

function MomTrendBadge({ pct }: { pct: number }) {
  const isUp = pct > 0;
  const isFlat = pct === 0;
  const label = `${isUp ? "+" : ""}${pct.toFixed(1)}% vs last month`;
  const colorClass = isUp
    ? "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/30"
    : isFlat
      ? "bg-muted text-muted-foreground border-border"
      : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30";
  const Icon = isUp ? TrendingUp : isFlat ? null : TrendingDown;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm text-[11px] font-semibold border cursor-default ${colorClass}`}
          >
            {Icon && <Icon className="h-3 w-3 shrink-0" />}
            {isUp ? "+" : ""}
            {pct.toFixed(1)}%
          </span>
        </TooltipTrigger>
        <TooltipContent>{label} (same elapsed days)</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function WoWTrendBadge({
  trend,
  label = "Week-over-week spend trend",
}: {
  trend: string | null | undefined;
  label?: string;
}) {
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
            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm text-[11px] font-medium border font-mono ${colorClass}`}
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

function GlobalCost() {
  const { data: apps, isLoading: appsLoading } = useApps();
  const { data: globalHealth } = useGetGlobalHealth({
    query: { queryKey: getGetGlobalHealthQueryKey(), staleTime: 5 * 60 * 1000 },
  });
  const { data: globalCostSummary } = useGetGlobalCostSummary({
    query: { queryKey: getGetGlobalCostSummaryQueryKey(), staleTime: 5 * 60 * 1000 },
  });

  const costQueries = useQueries({
    queries: (apps ?? []).map((app) => ({
      queryKey: getGetCostQueryKey(app.id),
      queryFn: () => getCost(app.id),
      staleTime: 5 * 60 * 1000,
    })),
  });

  const isLoading = appsLoading || costQueries.some((q) => q.isLoading);

  const [activeSigma] = useState<number>(() => readSigma(SENSITIVITY_KEY, ANOMALY_SIGMAS));

  // Find the most significant recent anomaly across all apps
  const globalAnomaly = useMemo(() => {
    if (!apps || isLoading) return null;
    let worst: {
      appId: string;
      appName: string;
      anomaly: NonNullable<ReturnType<typeof detectRecentAnomaly>>;
    } | null = null;
    for (let i = 0; i < apps.length; i++) {
      const daily = costQueries[i]?.data?.daily as DailyCostPoint[] | undefined;
      if (!daily) continue;
      const anomaly = detectRecentAnomaly(daily, activeSigma);
      if (!anomaly) continue;
      if (!worst || anomaly.vsAvgMultiple > worst.anomaly.vsAvgMultiple) {
        worst = { appId: apps[i].id, appName: apps[i].name, anomaly };
      }
    }
    return worst;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apps, isLoading, activeSigma, costQueries.map((q) => q.dataUpdatedAt).join(",")]);

  const currency = costQueries.find((q) => q.data)?.data?.currency ?? "USD";

  const costQueriesDataUpdatedAt = costQueries.map((q) => q.dataUpdatedAt).join(",");

  const tableRows = useMemo(() => {
    if (!apps || isLoading) return null;

    // Get Microsoft365 cost from global cost summary
    const microsoft365Cost =
      globalCostSummary?.byCategory?.find((c) => c.category === "Other")?.monthToDate ?? 0;

    const rows = apps.map((app, i) => {
      const costData = costQueries[i]?.data;
      const cost = costData?.monthToDate ?? app.monthToDateCost;
      const stripe = costData?.revenue.bySource.find((s) => s.source === "stripe")?.amount ?? 0;
      const appStore =
        costData?.revenue.bySource.find((s) => s.source === "app_store")?.amount ?? 0;
      const playStore =
        costData?.revenue.bySource.find((s) => s.source === "play_store")?.amount ?? 0;
      const revenue = costData?.revenue.total ?? stripe + appStore + playStore;
      const net = revenue - cost;
      const marginPct = revenue > 0 ? (net / revenue) * 100 : null;
      const momChangePct = costData?.momChangePct ?? null;
      return { app, cost, stripe, appStore, playStore, revenue, net, marginPct, momChangePct };
    });

    // Add Microsoft365 as a cost center row
    if (microsoft365Cost > 0) {
      rows.push({
        app: { id: "microsoft365", name: "Microsoft365", environment: "N/A" as const },
        cost: microsoft365Cost,
        stripe: 0,
        appStore: 0,
        playStore: 0,
        revenue: 0,
        net: -microsoft365Cost,
        marginPct: null,
        momChangePct: null,
      });
    }

    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apps, isLoading, costQueriesDataUpdatedAt, globalCostSummary?.byCategory]);

  const totalMtd = tableRows ? tableRows.reduce((s, r) => s + r.cost, 0) : null;
  const momTrendPct = globalHealth?.momTrendPct ?? null;

  const totals = useMemo(() => {
    if (!tableRows) return null;
    const cost = tableRows.reduce((s, r) => s + r.cost, 0);
    const stripe = tableRows.reduce((s, r) => s + r.stripe, 0);
    const appStore = tableRows.reduce((s, r) => s + r.appStore, 0);
    const playStore = tableRows.reduce((s, r) => s + r.playStore, 0);
    const revenue = tableRows.reduce((s, r) => s + r.revenue, 0);
    const net = revenue - cost;
    const marginPct = revenue > 0 ? (net / revenue) * 100 : null;
    return { cost, stripe, appStore, playStore, revenue, net, marginPct };
  }, [tableRows]);

  const csvHeaders = [
    "Application",
    "Cost (MTD)",
    "MoM %",
    "Stripe",
    "App Store",
    "Play Store",
    "Revenue",
    "Net",
    "Margin %",
  ];
  const csvRows = useMemo(() => {
    if (!tableRows || !totals) return null;
    const rows = tableRows.map((r) => [
      r.app.name,
      r.cost.toFixed(2),
      r.momChangePct != null
        ? (r.momChangePct >= 0 ? "+" : "") + r.momChangePct.toFixed(1) + "%"
        : "—",
      r.stripe.toFixed(2),
      r.appStore.toFixed(2),
      r.playStore.toFixed(2),
      r.revenue.toFixed(2),
      r.net.toFixed(2),
      r.marginPct != null ? r.marginPct.toFixed(1) + "%" : "—",
    ]);
    rows.push([
      "TOTAL",
      totals.cost.toFixed(2),
      "—",
      totals.stripe.toFixed(2),
      totals.appStore.toFixed(2),
      totals.playStore.toFixed(2),
      totals.revenue.toFixed(2),
      totals.net.toFixed(2),
      totals.marginPct != null ? totals.marginPct.toFixed(1) + "%" : "—",
    ]);
    return rows;
  }, [tableRows, totals]);

  const {
    copied,
    disabled: csvDisabled,
    handleExport,
    handleCopy,
  } = useCsvExport(csvRows, csvHeaders, "cost-vs-revenue-by-app");

  type CvrSortCol = "cost" | "revenue" | "net" | "margin";
  type CvrSortDir = "asc" | "desc";
  const [cvrSortCol, setCvrSortCol] = useState<CvrSortCol | null>(null);
  const [cvrSortDir, setCvrSortDir] = useState<CvrSortDir>("asc");

  function handleCvrSortClick(col: CvrSortCol) {
    setCvrSortCol((prev) => {
      if (prev === col) {
        setCvrSortDir((d) => (d === "asc" ? "desc" : "asc"));
        return col;
      }
      setCvrSortDir("asc");
      return col;
    });
  }

  const sortedTableRows = useMemo(() => {
    if (!tableRows) return null;
    if (!cvrSortCol) return tableRows;
    const rows = [...tableRows];
    rows.sort((a, b) => {
      let av: number, bv: number;
      if (cvrSortCol === "cost") {
        av = a.cost;
        bv = b.cost;
      } else if (cvrSortCol === "revenue") {
        av = a.revenue;
        bv = b.revenue;
      } else if (cvrSortCol === "net") {
        av = a.net;
        bv = b.net;
      } else {
        av = a.marginPct ?? -Infinity;
        bv = b.marginPct ?? -Infinity;
      }
      return cvrSortDir === "desc" ? bv - av : av - bv;
    });
    return rows;
  }, [tableRows, cvrSortCol, cvrSortDir]);

  function CvrSortIcon({ col }: { col: CvrSortCol }) {
    if (cvrSortCol !== col) return <ArrowUpDown className="h-3 w-3 ml-1 opacity-40" />;
    return cvrSortDir === "desc" ? (
      <ArrowDown className="h-3 w-3 ml-1 text-foreground" />
    ) : (
      <ArrowUp className="h-3 w-3 ml-1 text-foreground" />
    );
  }

  return (
    <>
      {!isLoading && globalAnomaly && (
        <AnomalyAlertBanner
          appId={globalAnomaly.appId}
          appName={globalAnomaly.appName}
          anomaly={globalAnomaly.anomaly}
          formatCurrency={(v) => fmt(v, currency)}
          sigmas={activeSigma}
        />
      )}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <div className="bg-card border border-border p-3 shadow-sm flex flex-col justify-between">
          <div className="text-[12px] text-muted-foreground font-medium mb-1">Total cost (MTD)</div>
          {isLoading || totalMtd === null ? (
            <Skeleton className="h-7 w-28 mt-1" />
          ) : (
            <div className="flex items-center gap-2 mt-1">
              <span className="text-xl font-semibold text-foreground tabular-nums">
                {fmt(totalMtd, currency)}
              </span>
              {momTrendPct !== null && <MomTrendBadge pct={momTrendPct} />}
            </div>
          )}
          <div className="text-[11px] text-muted-foreground mt-1">
            {globalCostSummary?.dataAsOf && !isLoading
              ? `as of ${fmtRelativeTime(globalCostSummary.dataAsOf)}`
              : "All applications combined"}
          </div>
        </div>
        <div className="bg-card border border-border p-3 shadow-sm flex flex-col justify-between">
          <div className="text-[12px] text-muted-foreground font-medium mb-1">
            Cost Centers tracked
          </div>
          {isLoading ? (
            <Skeleton className="h-7 w-10 mt-1" />
          ) : (
            <span className="text-xl font-semibold text-foreground mt-1">
              {globalCostSummary?.byCategory?.length ?? 0}
            </span>
          )}
          <div className="text-[11px] text-muted-foreground mt-1">Across all environments</div>
        </div>
        <div className="bg-card border border-border p-3 shadow-sm flex flex-col justify-between">
          <div className="text-[12px] text-muted-foreground font-medium mb-1">Data source</div>
          {isLoading ? (
            <Skeleton className="h-7 w-16 mt-1" />
          ) : (
            <div className="mt-1">
              <DataSourceBadge
                dataSource={globalHealth?.costDataSource ?? "mock"}
                dataAsOf={globalCostSummary?.dataAsOf}
                label="Azure Cost Management"
              />
            </div>
          )}
          <div className="text-[11px] text-muted-foreground mt-1">Azure Cost Management</div>
        </div>
      </div>
      <Panel
        title="Cost vs Revenue by Application"
        bodyClassName="overflow-auto max-h-[500px] relative"
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
            <TableHead className="h-8 font-semibold text-foreground text-right w-[110px]">
              <button
                onClick={() => handleCvrSortClick("cost")}
                className="inline-flex items-center justify-end w-full hover:text-foreground transition-colors"
              >
                Cost (MTD)
                <CvrSortIcon col="cost" />
              </button>
            </TableHead>
            <TableHead className="h-8 font-semibold text-foreground w-[100px]">MoM</TableHead>
            <TableHead className="h-8 font-semibold text-foreground text-right w-[100px]">
              Stripe
            </TableHead>
            <TableHead className="h-8 font-semibold text-foreground text-right w-[110px]">
              App Store
            </TableHead>
            <TableHead className="h-8 font-semibold text-foreground text-right w-[110px]">
              Play Store
            </TableHead>
            <TableHead className="h-8 font-semibold text-foreground text-right w-[110px]">
              <button
                onClick={() => handleCvrSortClick("revenue")}
                className="inline-flex items-center justify-end w-full hover:text-foreground transition-colors"
              >
                Revenue
                <CvrSortIcon col="revenue" />
              </button>
            </TableHead>
            <TableHead className="h-8 font-semibold text-foreground text-right w-[110px]">
              <button
                onClick={() => handleCvrSortClick("net")}
                className="inline-flex items-center justify-end w-full hover:text-foreground transition-colors"
              >
                Net
                <CvrSortIcon col="net" />
              </button>
            </TableHead>
            <TableHead className="h-8 font-semibold text-foreground text-right w-[90px]">
              <button
                onClick={() => handleCvrSortClick("margin")}
                className="inline-flex items-center justify-end w-full hover:text-foreground transition-colors"
              >
                Margin %
                <CvrSortIcon col="margin" />
              </button>
            </TableHead>
          </THead>
          <TableBody>
            {isLoading ? (
              <SkeletonRows cols={9} rows={3} />
            ) : (
              (sortedTableRows ?? []).map((row) => {
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
                  <TableRow
                    key={row.app.id}
                    className="h-8 border-b border-border/50 hover:bg-muted/40"
                  >
                    <TableCell className="py-1 font-medium">
                      {row.app.name}
                      <span className="text-muted-foreground text-[11px] ml-1.5">
                        · {row.app.environment}
                      </span>
                    </TableCell>
                    <TableCell className="py-1 text-right font-mono text-[12px] tabular-nums">
                      {fmt(row.cost, currency)}
                    </TableCell>
                    <TableCell className="py-1">
                      {row.momChangePct != null ? (
                        <MomTrendBadge pct={row.momChangePct} />
                      ) : (
                        <span className="text-muted-foreground/40 text-[11px]">—</span>
                      )}
                    </TableCell>
                    <TableCell className="py-1 text-right font-mono text-[12px] tabular-nums text-muted-foreground">
                      {row.stripe > 0 ? (
                        fmt(row.stripe, currency)
                      ) : (
                        <span className="opacity-30">—</span>
                      )}
                    </TableCell>
                    <TableCell className="py-1 text-right font-mono text-[12px] tabular-nums text-muted-foreground">
                      {row.appStore > 0 ? (
                        fmt(row.appStore, currency)
                      ) : (
                        <span className="opacity-30">—</span>
                      )}
                    </TableCell>
                    <TableCell className="py-1 text-right font-mono text-[12px] tabular-nums text-muted-foreground">
                      {row.playStore > 0 ? (
                        fmt(row.playStore, currency)
                      ) : (
                        <span className="opacity-30">—</span>
                      )}
                    </TableCell>
                    <TableCell className="py-1 text-right font-mono text-[12px] tabular-nums">
                      {fmt(row.revenue, currency)}
                    </TableCell>
                    <TableCell
                      className={`py-1 text-right font-mono text-[12px] tabular-nums font-semibold ${netClass}`}
                    >
                      {fmt(row.net, currency)}
                    </TableCell>
                    <TableCell
                      className={`py-1 text-right font-mono text-[12px] tabular-nums font-semibold ${marginClass}`}
                    >
                      {row.marginPct != null ? `${row.marginPct.toFixed(1)}%` : "—"}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
          {!isLoading && totals && (
            <TableFooter className="sticky bottom-0 z-10 bg-muted/60 border-t-2 border-border">
              <TableRow className="h-9 hover:bg-muted/70">
                <TableCell className="py-1.5 font-bold text-foreground text-[13px]">
                  Total
                </TableCell>
                <TableCell className="py-1.5 text-right font-mono text-[12px] tabular-nums font-bold text-foreground">
                  {fmt(totals.cost, currency)}
                </TableCell>
                <TableCell className="py-1.5" />
                <TableCell className="py-1.5 text-right font-mono text-[12px] tabular-nums font-semibold text-foreground">
                  {totals.stripe > 0 ? (
                    fmt(totals.stripe, currency)
                  ) : (
                    <span className="opacity-30">—</span>
                  )}
                </TableCell>
                <TableCell className="py-1.5 text-right font-mono text-[12px] tabular-nums font-semibold text-foreground">
                  {totals.appStore > 0 ? (
                    fmt(totals.appStore, currency)
                  ) : (
                    <span className="opacity-30">—</span>
                  )}
                </TableCell>
                <TableCell className="py-1.5 text-right font-mono text-[12px] tabular-nums font-semibold text-foreground">
                  {totals.playStore > 0 ? (
                    fmt(totals.playStore, currency)
                  ) : (
                    <span className="opacity-30">—</span>
                  )}
                </TableCell>
                <TableCell className="py-1.5 text-right font-mono text-[12px] tabular-nums font-bold text-foreground">
                  {fmt(totals.revenue, currency)}
                </TableCell>
                <TableCell
                  className={`py-1.5 text-right font-mono text-[12px] tabular-nums font-bold ${
                    totals.net > 0
                      ? "text-emerald-600 dark:text-emerald-400"
                      : totals.net < 0
                        ? "text-destructive"
                        : "text-foreground"
                  }`}
                >
                  {fmt(totals.net, currency)}
                </TableCell>
                <TableCell
                  className={`py-1.5 text-right font-mono text-[12px] tabular-nums font-bold ${
                    totals.marginPct == null
                      ? "text-foreground"
                      : totals.marginPct > 0
                        ? "text-emerald-600 dark:text-emerald-400"
                        : totals.marginPct < 0
                          ? "text-destructive"
                          : "text-foreground"
                  }`}
                >
                  {totals.marginPct != null ? `${totals.marginPct.toFixed(1)}%` : "—"}
                </TableCell>
              </TableRow>
            </TableFooter>
          )}
        </Table>
      </Panel>
    </>
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
  const { data: globalCostSummary } = useGetGlobalCostSummary({
    query: { queryKey: getGetGlobalCostSummaryQueryKey(), staleTime: 5 * 60 * 1000 },
  });
  const wowTrend = useMemo(() => {
    const entry = globalCostSummary?.byApp?.find((a) => a.appId === scope);
    return entry?.trend ?? null;
  }, [globalCostSummary?.byApp, scope]);
  const { isRefreshing, isCoolingDown, forceRefresh } = useForceRefresh(
    `/api/apps/${scope}/cost`,
    queryKey,
    [{ url: "/api/apps", queryKey: getListAppsQueryKey() }],
  );
  const budgetPercent = data ? (data.monthToDate / data.budget) * 100 : 0;
  const budgetThreshold = useBudgetThreshold(scope);
  const net = data ? data.revenue.total - data.monthToDate : 0;
  const marginPct = data && data.revenue.total > 0 ? (net / data.revenue.total) * 100 : null;
  const netClass = net >= 0 ? "text-emerald-500" : "text-destructive";
  const { unacknowledgedCount } = useUnacknowledgedBudgetAlerts();
  const [activeTab, setActiveTab] = useState("overview");

  const [showDailyTable, setShowDailyTable] = useState(() => {
    try {
      return localStorage.getItem(LS_DAILY_TABLE_KEY(scope)) === "1";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      setShowDailyTable(localStorage.getItem(LS_DAILY_TABLE_KEY(scope)) === "1");
    } catch {
      setShowDailyTable(false);
    }
  }, [scope]);

  const [serviceSortCol, setServiceSortCol] = useState<ServiceSortCol>(
    () => loadServiceSort(scope).col,
  );
  const [serviceSortDir, setServiceSortDir] = useState<SortDir>(() => loadServiceSort(scope).dir);

  useEffect(() => {
    const saved = loadServiceSort(scope);
    setServiceSortCol(saved.col);
    setServiceSortDir(saved.dir);
  }, [scope]);

  function handleServiceSortClick(col: ServiceSortCol) {
    let newCol: ServiceSortCol;
    let newDir: SortDir;
    if (serviceSortCol === col) {
      newCol = col;
      newDir = serviceSortDir === "asc" ? "desc" : "asc";
    } else {
      newCol = col;
      newDir = "desc";
    }
    setServiceSortCol(newCol);
    setServiceSortDir(newDir);
    try {
      localStorage.setItem(
        LS_SERVICE_SORT_KEY(scope),
        JSON.stringify({ col: newCol, dir: newDir }),
      );
    } catch {
      /* ignore */
    }
  }

  function parseTrend(trend: string | undefined | null): number {
    if (!trend) return -Infinity;
    const n = parseFloat(trend.replace(/[^0-9.\-+]/g, ""));
    return isNaN(n) ? -Infinity : n;
  }

  const chartRef = useRef<HTMLDivElement>(null);
  const bannerWrapperRef = useRef<HTMLDivElement>(null);
  const [chartRange, setChartRange] = useState<DailySpendRange>(30);
  const [activeSigma, setActiveSigma] = useState<number>(() =>
    readSigma(SENSITIVITY_KEY, ANOMALY_SIGMAS),
  );
  const [highlightDate, setHighlightDate] = useState<string | undefined>(undefined);

  const anomaly = useMemo(
    () => detectRecentAnomaly(data?.daily, activeSigma),
    [data?.daily, activeSigma],
  );

  // Track whether the main anomaly banner and the chart are in the viewport
  const [chartInView, setChartInView] = useState(false);
  const [bannerInView, setBannerInView] = useState(true);
  // Local dismissed state so sticky and main banner stay in sync
  const [anomalyDismissed, setAnomalyDismissed] = useState(false);

  // Re-sync dismissal state when the anomaly changes (e.g. scope switch)
  useEffect(() => {
    if (!anomaly) {
      setAnomalyDismissed(false);
      return;
    }
    try {
      setAnomalyDismissed(localStorage.getItem(LS_KEY_PREFIX + anomaly.dateKey) === "1");
    } catch {
      setAnomalyDismissed(false);
    }
  }, [anomaly?.dateKey]);

  useEffect(() => {
    const el = chartRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(([entry]) => setChartInView(entry.isIntersecting), {
      threshold: 0.1,
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    const el = bannerWrapperRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(([entry]) => setBannerInView(entry.isIntersecting));
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  function handleViewInChart() {
    if (!anomaly || !data?.daily) return;
    const visibleSlice = data.daily.slice(-chartRange);
    const isVisible = visibleSlice.some((d) => isoDate(d.timestamp as string) === anomaly.dateKey);
    if (!isVisible) {
      setChartRange(30);
    }
    setHighlightDate(anomaly.dateKey);
    setTimeout(() => {
      chartRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
    setTimeout(() => {
      setHighlightDate(undefined);
    }, 1650);
  }

  const breakdownHeaders = [
    "Service",
    "Resource Group",
    "Environment",
    "Cost (USD)",
    "% of Total",
    "Trend",
    "Budget breach",
  ];
  const breakdownRows = useMemo(() => {
    if (!data?.byService?.length) return null;
    const resourceGroup = selectedApp?.resourceGroup ?? "";
    const environment = selectedApp?.environment ?? "";
    const budgetBreach = data.forecast > data.budget ? "Yes" : "No";
    return data.byService.map((svc) => [
      svc.service,
      resourceGroup,
      environment,
      svc.amount.toFixed(2),
      data.monthToDate > 0 ? ((svc.amount / data.monthToDate) * 100).toFixed(1) + "%" : "0.0%",
      svc.trend ?? "N/A",
      budgetBreach,
    ]);
  }, [data, selectedApp]);

  const {
    copied,
    disabled: breakdownDisabled,
    handleExport: handleBreakdownExport,
    handleCopy: handleBreakdownCopy,
  } = useCsvExport(breakdownRows, breakdownHeaders, `cost-breakdown-${selectedApp?.name ?? scope}`);

  const apiNameHeaders = ["API Name", "Calls (MTD)", "Cost"];
  const apiNameRows = useMemo(() => {
    if (!data?.apiUsage?.byApi?.length) return null;
    return data.apiUsage.byApi.map((row) => [
      row.name,
      row.totalCalls.toString(),
      row.cost.toFixed(2),
    ]);
  }, [data?.apiUsage?.byApi]);

  const {
    copied: apiNameCopied,
    disabled: apiNameDisabled,
    handleExport: handleApiNameExport,
    handleCopy: handleApiNameCopy,
  } = useCsvExport(apiNameRows, apiNameHeaders, `cost-by-api-name-${selectedApp?.name ?? scope}`);

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
  const searchParams = new URLSearchParams(search);
  const dateParam = searchParams.get("date");
  const dateFilter = (() => {
    if (!dateParam) return null;
    const parsed = parseISO(dateParam);
    return isValid(parsed) ? parsed : null;
  })();

  const fromFilter = searchParams.get("from") ?? null;

  function dismissDateFilter() {
    const params = new URLSearchParams(search);
    params.delete("date");
    const qs = params.toString();
    navigate(qs ? `/cost?${qs}` : "/cost", { replace: true });
  }

  function dismissFromFilter() {
    const params = new URLSearchParams(search);
    params.delete("from");
    const qs = params.toString();
    navigate(qs ? `/cost?${qs}` : "/cost", { replace: true });
  }

  const dailyCsvHeaders = ["Date", "Spend (USD)", "vs Last Week (%)"];
  const dailyCsvRows = useMemo(() => {
    if (!data?.daily?.length) return null;
    return [...data.daily].reverse().map((day) => {
      const dateLabel = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(
        new Date(day.timestamp as string),
      );
      const pct = day.vsLastWeek;
      const pctLabel = pct == null ? "" : `${pct > 0 ? "+" : ""}${pct.toFixed(1)}%`;
      return [dateLabel, day.value.toFixed(2), pctLabel];
    });
  }, [data?.daily]);

  const {
    copied: copiedDaily,
    disabled: dailyCsvDisabled,
    handleExport: handleDailyExport,
    handleCopy: handleDailyCopy,
  } = useCsvExport(dailyCsvRows, dailyCsvHeaders, `daily-spend-${selectedApp?.name ?? scope}`);

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
      <TabsList className="flex h-10 w-full justify-start rounded-none border-b border-border bg-transparent p-0">
        <TabsTrigger
          value="overview"
          className="h-10 rounded-none border-b-2 border-transparent px-4 py-2 font-medium text-muted-foreground data-[state=active]:border-primary data-[state=active]:text-foreground data-[state=active]:shadow-none bg-transparent"
        >
          Overview
        </TabsTrigger>
        <TabsTrigger
          value="budgets"
          className="h-10 rounded-none border-b-2 border-transparent px-4 py-2 font-medium text-muted-foreground data-[state=active]:border-primary data-[state=active]:text-foreground data-[state=active]:shadow-none bg-transparent"
        >
          <span className="inline-flex items-center gap-1.5">
            Budgets
            {unacknowledgedCount > 0 && (
              <span className="inline-flex items-center justify-center h-4 min-w-[1rem] px-1 rounded-full bg-amber-500 text-white text-[10px] font-bold leading-none">
                {unacknowledgedCount}
              </span>
            )}
          </span>
        </TabsTrigger>
      </TabsList>
      <TabsContent value="overview" className="mt-4 space-y-4">
        {fromFilter && (
          <div className="flex items-center gap-2 px-3 py-2 border border-blue-500/30 bg-blue-500/8 rounded-sm text-[13px]">
            <Filter className="h-3.5 w-3.5 shrink-0 text-blue-500 dark:text-blue-400" />
            <span className="text-foreground font-medium">
              Navigated from{" "}
              <Link
                href="/"
                className="underline underline-offset-2 decoration-blue-500/60 hover:decoration-blue-600 dark:decoration-blue-400/60 dark:hover:decoration-blue-300 transition-colors"
              >
                Budget Status
              </Link>
            </span>
            <span className="text-muted-foreground text-[11px]">
              — filtered by <span className="font-medium text-foreground">{fromFilter}</span>
            </span>
            <button
              onClick={dismissFromFilter}
              className="ml-auto flex items-center justify-center h-5 w-5 rounded-sm hover:bg-blue-500/20 text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Dismiss navigation context"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
        {dateFilter && (
          <div className="flex items-center gap-2 px-3 py-2 border border-amber-500/30 bg-amber-500/8 rounded-sm text-[13px]">
            <CalendarSearch className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
            <span className="text-foreground font-medium">
              Drilled in from anomaly on{" "}
              <span className="font-semibold">{format(dateFilter, "EEEE, MMMM d, yyyy")}</span>
            </span>
            <span className="text-muted-foreground text-[11px] ml-1">
              — service breakdown below shows the full month
            </span>
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
              <ForceRefreshButton
                isRefreshing={isRefreshing}
                isCoolingDown={isCoolingDown}
                onRefresh={forceRefresh}
              />
            )}
            <CostDataSourceBadge dataSource={data.dataSource} dataAsOf={data.dataAsOf} />
          </div>
        )}
        {!isLoading && data && (
          <StaleCacheBanner
            source="azure-cost"
            dataSource={data.dataSource}
            dataAsOf={data.dataAsOf}
          />
        )}
        <RefreshingBar isFetching={isFetching} isLoading={isLoading} />
        <div ref={bannerWrapperRef}>
          {!isLoading && data?.daily && (
            <AnomalyAlertBanner
              appId={scope}
              anomaly={anomaly}
              formatCurrency={(v) => fmt(v, data.currency)}
              onViewInChart={anomaly ? handleViewInChart : undefined}
              onDismiss={() => setAnomalyDismissed(true)}
              sigmas={activeSigma}
            />
          )}
        </div>
        <div
          className={`space-y-4 transition-opacity duration-200 ${isFetching && !isLoading ? "opacity-60" : "opacity-100"}`}
        >
          <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
            <Tile
              title="Actual cost (MTD)"
              value={isLoading ? null : data ? fmt(data.monthToDate, data.currency) : "$0.00"}
              badge={
                !isLoading && (data?.momChangePct != null || wowTrend) ? (
                  <span className="inline-flex items-center gap-1">
                    {wowTrend && (
                      <WoWTrendBadge
                        trend={wowTrend}
                        label="Week-over-week spend trend (this app)"
                      />
                    )}
                    {data?.momChangePct != null && <MomTrendBadge pct={data.momChangePct} />}
                  </span>
                ) : undefined
              }
              subLabel={
                !isLoading && data?.dataAsOf ? `as of ${fmtRelativeTime(data.dataAsOf)}` : undefined
              }
            />
            <Tile
              title="Forecasted cost"
              value={isLoading ? null : data ? fmt(data.forecast, data.currency) : "$0.00"}
              subLabel={
                !isLoading && data?.dataAsOf ? `as of ${fmtRelativeTime(data.dataAsOf)}` : undefined
              }
            />
            <div className="bg-card border border-border p-3 shadow-sm flex flex-col justify-between">
              <div className="flex items-center justify-between mb-1">
                <div className="text-[12px] text-muted-foreground font-medium">API usage (MTD)</div>
                {!isLoading && data?.apiUsage.dataSource && (
                  <span
                    className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${data.apiUsage.dataSource === "live" ? "bg-green-500/15 text-green-600 dark:text-green-400" : "bg-muted text-muted-foreground"}`}
                  >
                    {data.apiUsage.dataSource === "live" ? "live" : "est"}
                  </span>
                )}
              </div>
              {isLoading || !data ? (
                <Skeleton className="h-7 w-20 mt-1" />
              ) : (
                <>
                  <div className="text-xl font-semibold text-foreground mt-1 tabular-nums">
                    {fmt(data.apiUsage.cost, data.currency)}
                  </div>
                  <div className="text-[11px] text-muted-foreground tabular-nums mt-0.5">
                    {fmtInt(data.apiUsage.totalCalls)} calls
                  </div>
                </>
              )}
            </div>
            <div className="bg-card border border-border p-3 shadow-sm flex flex-col justify-between">
              <div className="text-[12px] text-muted-foreground font-medium mb-1">
                Budget utilization
              </div>
              {isLoading || !data ? (
                <Skeleton className="h-7 w-full mt-1" />
              ) : (
                <div className="space-y-1 mt-1">
                  <div className="flex justify-between text-[11px]">
                    <span className="font-semibold text-foreground tabular-nums">
                      {fmt(data.monthToDate, data.currency)}
                    </span>
                    <span className="text-muted-foreground tabular-nums">
                      {fmt(data.budget, data.currency)}
                    </span>
                  </div>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Progress
                          value={budgetPercent}
                          className="h-1.5 rounded-none bg-muted cursor-default"
                        />
                      </TooltipTrigger>
                      <TooltipContent>
                        Alert at {budgetThreshold}% · {budgetPercent.toFixed(0)}% utilized
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
              )}
            </div>
          </div>

          {!isLoading && data && data.revenue.total === 0 && (
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <span className="inline-flex items-center px-1.5 py-0.5 border border-border bg-muted/40 text-muted-foreground font-semibold tracking-wide uppercase text-[10px]">
                No data
              </span>
              No revenue recorded this month. Stripe, App Store Connect, and Google Play sources
              will appear here once active.
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
            <Tile
              title="Revenue (MTD)"
              value={isLoading || !data ? null : fmt(data.revenue.total, data.revenue.currency)}
            />
            <div className="bg-card border border-border p-3 shadow-sm flex flex-col justify-between">
              <div className="text-[12px] text-muted-foreground font-medium mb-1">
                Net (Revenue − Cost)
              </div>
              {isLoading || !data ? (
                <Skeleton className="h-7 w-20 mt-1" />
              ) : (
                <div
                  className={`text-xl font-semibold mt-1 tabular-nums flex items-center gap-1.5 ${netClass}`}
                >
                  {net >= 0 ? (
                    <TrendingUp className="h-4 w-4" />
                  ) : (
                    <TrendingDown className="h-4 w-4" />
                  )}
                  {fmt(net, data.currency)}
                </div>
              )}
            </div>
            <div className="bg-card border border-border p-3 shadow-sm flex flex-col justify-between">
              <div className="text-[12px] text-muted-foreground font-medium mb-1">Gross margin</div>
              {isLoading || !data ? (
                <Skeleton className="h-7 w-20 mt-1" />
              ) : (
                <div className={`text-xl font-semibold mt-1 tabular-nums ${netClass}`}>
                  {marginPct === null ? "—" : `${marginPct.toFixed(1)}%`}
                </div>
              )}
            </div>
            <div className="bg-card border border-border p-3 shadow-sm flex flex-col justify-between">
              <div className="text-[12px] text-muted-foreground font-medium mb-1">
                Revenue by source
              </div>
              {isLoading || !data ? (
                <Skeleton className="h-7 w-full mt-1" />
              ) : data.revenue.total === 0 ? (
                <div className="text-[11px] text-muted-foreground mt-2">
                  No revenue sources configured (internal app).
                </div>
              ) : (
                <div className="space-y-0.5 mt-1 text-[11px] tabular-nums">
                  {data.revenue.bySource.map((s) => (
                    <div key={s.source} className="flex justify-between">
                      <span className="text-muted-foreground truncate pr-2">{s.label}</span>
                      <span className="font-mono text-foreground">
                        {fmt(s.amount, data.revenue.currency)}
                      </span>
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
                      disabled={dailyCsvDisabled}
                      copied={copiedDaily}
                    />
                  )}
                  <button
                    onClick={() =>
                      setShowDailyTable((v) => {
                        const next = !v;
                        try {
                          localStorage.setItem(LS_DAILY_TABLE_KEY(scope), next ? "1" : "0");
                        } catch {
                          /* ignore */
                        }
                        return next;
                      })
                    }
                    className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors ml-1"
                  >
                    <TableIcon className="h-3.5 w-3.5" />
                    {showDailyTable ? "Hide table" : "Show table"}
                    {showDailyTable ? (
                      <ChevronUp className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5" />
                    )}
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
                  onSigmaChange={setActiveSigma}
                  highlightDate={highlightDate}
                />
              ) : (
                <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
                  No daily data available
                </div>
              )}
            </div>
            {showDailyTable && data && data.daily.length > 0 && (
              <div className="border-t border-border overflow-x-auto">
                <Table className="text-[13px]">
                  <TableHeader className="bg-muted/50 border-b border-border">
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="h-8 font-semibold text-foreground w-[140px]">
                        Date
                      </TableHead>
                      <TableHead className="h-8 font-semibold text-foreground text-right w-[140px]">
                        Spend
                      </TableHead>
                      <TableHead className="h-8 font-semibold text-foreground text-right w-[140px]">
                        vs Last Week
                      </TableHead>
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
                        pct == null ? "—" : `${pct > 0 ? "+" : ""}${pct.toFixed(1)}%`;
                      return (
                        <TableRow
                          key={day.timestamp as string}
                          className="h-8 border-b border-border/50 hover:bg-muted/40"
                        >
                          <TableCell className="py-1 font-medium tabular-nums text-[12px]">
                            {new Intl.DateTimeFormat("en-US", {
                              month: "short",
                              day: "numeric",
                            }).format(new Date(day.timestamp as string))}
                          </TableCell>
                          <TableCell className="py-1 text-right font-mono text-[12px] tabular-nums">
                            {fmt(day.value, data.currency)}
                          </TableCell>
                          <TableCell
                            className={`py-1 text-right font-mono text-[12px] tabular-nums font-semibold ${pctClass}`}
                          >
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
                        serviceSortDir === "asc" ? (
                          <ArrowUp className="h-3 w-3 shrink-0" />
                        ) : (
                          <ArrowDown className="h-3 w-3 shrink-0" />
                        )
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
                        serviceSortDir === "asc" ? (
                          <ArrowUp className="h-3 w-3 shrink-0" />
                        ) : (
                          <ArrowDown className="h-3 w-3 shrink-0" />
                        )
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
                        <TableRow
                          key={i}
                          className="h-8 border-b border-border/50 hover:bg-muted/40"
                        >
                          <TableCell className="py-1 font-medium">{svc.service}</TableCell>
                          <TableCell className="py-1 text-right font-mono text-[12px]">
                            {fmt(svc.amount, data.currency)}
                          </TableCell>
                          <TableCell
                            className={`py-1 text-right font-mono text-[11px] ${trendClass}`}
                          >
                            {trend ?? <span className="text-muted-foreground/50">—</span>}
                          </TableCell>
                          <TableCell className="py-1">
                            <Progress
                              value={(svc.amount / data.monthToDate) * 100}
                              className="h-1.5 rounded-none bg-muted"
                            />
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </Panel>

            <Panel
              title="Third-party API costs"
              rightHeader={
                data ? (
                  <div className="flex items-center gap-2 pr-2">
                    {data.apiUsage.dataSource && (
                      <span
                        className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${data.apiUsage.dataSource === "live" ? "bg-green-500/15 text-green-600 dark:text-green-400" : "bg-muted text-muted-foreground"}`}
                      >
                        {data.apiUsage.dataSource === "live" ? "live" : "est"}
                      </span>
                    )}
                    <span className="text-[11px] text-muted-foreground">
                      {fmt(data.apiUsage.cost, data.currency)} @{" "}
                      {fmt(data.apiUsage.costPerMillion, data.currency)}/M calls
                    </span>
                  </div>
                ) : null
              }
              toolbar={
                <div className="flex items-center gap-1">
                  <CsvToolbar
                    handleExport={handleApiNameExport}
                    handleCopy={handleApiNameCopy}
                    disabled={apiNameDisabled}
                    copied={apiNameCopied}
                  />
                </div>
              }
            >
              <Table className="text-[13px]">
                <THead>
                  <TableHead className="h-8 font-semibold text-foreground">API Name</TableHead>
                  <TableHead className="h-8 font-semibold text-foreground text-right w-[140px]">
                    Calls (MTD)
                  </TableHead>
                  <TableHead className="h-8 font-semibold text-foreground text-right w-[110px]">
                    Cost
                  </TableHead>
                  <TableHead className="h-8 font-semibold text-foreground w-[140px]"></TableHead>
                </THead>
                <TableBody>
                  {isLoading || !data ? (
                    <SkeletonRows cols={4} rows={6} />
                  ) : (
                    data.apiUsage.byApi?.map((row, idx) => {
                      const maxCost = data.apiUsage.byApi[0]?.cost || 1;
                      return (
                        <TableRow
                          key={`${row.name}-${idx}`}
                          className="h-8 border-b border-border/50 hover:bg-muted/40"
                        >
                          <TableCell className="py-1 font-mono text-[12px] font-medium">
                            {row.name}
                          </TableCell>
                          <TableCell className="py-1 text-right font-mono text-[12px] tabular-nums text-muted-foreground">
                            {fmtInt(row.totalCalls)}
                          </TableCell>
                          <TableCell className="py-1 text-right font-mono text-[12px] tabular-nums">
                            {fmt(row.cost, data.currency)}
                          </TableCell>
                          <TableCell className="py-1">
                            <Progress
                              value={(row.cost / maxCost) * 100}
                              className="h-1.5 rounded-none bg-muted"
                            />
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </Panel>
          </div>

          {scope === "kinisis-labs" && data?.opsCosts && (
            <OpsCostsPanel
              opsCosts={data.opsCosts}
              currency={data.currency}
              isLoading={isLoading}
            />
          )}
        </div>
      </TabsContent>
      <TabsContent value="budgets" className="mt-4">
        <BudgetAlertHistory appId={scope} />
      </TabsContent>

      {/* Sticky mini-banner: visible when chart is in view but main banner has scrolled off */}
      {anomaly && !anomalyDismissed && chartInView && !bannerInView && (
        <div
          className="fixed top-0 left-0 right-0 z-50 flex items-center gap-2.5 px-4 py-2 bg-amber-500/95 dark:bg-amber-600/95 backdrop-blur-sm shadow-md text-white"
          role="status"
          aria-live="polite"
        >
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span className="text-[12px] font-semibold tracking-tight">
            Cost anomaly —{" "}
            <span className="font-bold">
              {format(anomaly.date, "EEE, MMM d")} · {anomaly.vsAvgMultiple.toFixed(1)}× avg
            </span>
          </span>
          {data && (
            <span className="text-[11px] font-medium opacity-85 hidden sm:inline">
              (~{fmt(anomaly.excess, data.currency)} above baseline)
            </span>
          )}
          <button
            onClick={() => {
              try {
                localStorage.setItem(LS_KEY_PREFIX + anomaly.dateKey, "1");
              } catch {
                /* ignore */
              }
              setAnomalyDismissed(true);
            }}
            className="ml-auto shrink-0 p-0.5 rounded hover:bg-white/20 transition-colors"
            aria-label="Dismiss anomaly notice"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </Tabs>
  );
}

const OPS_COST_CATEGORY_LABELS: Record<string, string> = {
  "website-ops": "Website Ops",
  "network-ops": "Network Ops",
  "m365-licenses": "M365 Licenses",
};

function OpsCostsPanel({
  opsCosts,
  currency,
  isLoading,
}: {
  opsCosts: OpsCostSummary;
  currency: string;
  isLoading: boolean;
}) {
  return (
    <Panel
      title="Operational Costs"
      rightHeader={
        !isLoading ? (
          <div className="flex items-center gap-2 pr-2">
            <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-[11px] text-muted-foreground">
              {fmt(opsCosts.totalMonthly, currency)}{" "}
              <span className="text-muted-foreground/60">/ mo</span>
            </span>
          </div>
        ) : null
      }
    >
      <div className="divide-y divide-border">
        {opsCosts.byCategory.map((cat) => (
          <div key={cat.category} className="p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[12px] font-semibold text-foreground">
                {OPS_COST_CATEGORY_LABELS[cat.category] ?? cat.label ?? cat.category}
              </span>
              <span className="text-[12px] font-mono font-semibold text-foreground tabular-nums">
                {fmt(cat.total, currency)}
                <span className="text-[10px] text-muted-foreground font-normal ml-0.5">/mo</span>
              </span>
            </div>
            <Table className="text-[12px]">
              <THead>
                <TableHead className="h-7 font-medium text-muted-foreground">Name</TableHead>
                <TableHead className="h-7 font-medium text-muted-foreground">Billing</TableHead>
                <TableHead className="h-7 font-medium text-muted-foreground text-right w-[110px]">
                  Monthly
                </TableHead>
                <TableHead className="h-7 w-[60px]"></TableHead>
              </THead>
              <TableBody>
                {(cat.items ?? []).map((item) => (
                  <TableRow
                    key={item.id}
                    className="h-7 border-b border-border/50 hover:bg-muted/40"
                  >
                    <TableCell className="py-1 font-medium">{item.name}</TableCell>
                    <TableCell className="py-1 text-muted-foreground text-[11px] capitalize">
                      {item.billingCycle}
                    </TableCell>
                    <TableCell className="py-1 text-right font-mono tabular-nums">
                      {fmt(item.amountMonthly, currency)}
                    </TableCell>
                    <TableCell className="py-1 text-right">
                      {!item.active && (
                        <span className="text-[10px] px-1 py-0.5 rounded-sm bg-muted text-muted-foreground">
                          inactive
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ))}
      </div>
    </Panel>
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
            <TableCell key={j}>
              <Skeleton className="h-4 w-24" />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  );
}

function ToolbarBtn({
  icon: Icon,
  children,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-7 text-xs px-2 rounded-sm text-primary hover:text-primary hover:bg-primary/10"
      onClick={onClick}
    >
      <Icon className="h-3.5 w-3.5 mr-1.5" />
      {children}
    </Button>
  );
}

function Tile({
  title,
  value,
  badge,
  subLabel,
}: {
  title: string;
  value: React.ReactNode;
  badge?: React.ReactNode;
  subLabel?: React.ReactNode;
}) {
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
      {subLabel && <div className="text-[10px] text-muted-foreground mt-0.5">{subLabel}</div>}
    </div>
  );
}
