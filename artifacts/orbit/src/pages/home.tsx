import { useState, useMemo, useEffect } from "react";
import { AreaChart, Area, ResponsiveContainer, Tooltip as RechartsTooltip } from "recharts";
import { getListAppsQueryKey, getGetCostQueryKey, getCost, getGetAppQueryKey, getApp, useGetGlobalHealth, getGetGlobalHealthQueryKey, useGetGlobalCostSummary, getGetGlobalCostSummaryQueryKey } from "@workspace/api-client-react";
import type { AppSummary, AppDetail } from "@workspace/api-client-react";
import type { UserAuthType } from "@workspace/api-client-react";
import type { DailyCostPoint } from "@/components/daily-spend-utils";
import { useApps } from "@/hooks/use-apps";
import { useQueryClient, useQueries } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/status-badge";
import { ChevronRight, ChevronUp, ChevronDown, ChevronsUpDown, Bell, TrendingUp, TrendingDown, X, TriangleAlert, Wifi, Smartphone, ExternalLink, LayoutGrid, AlertCircle, DollarSign, TrendingUp as BudgetIcon, HeartPulse, ShieldCheck } from "lucide-react";
import { Link, useLocation, useSearch } from "wouter";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import { AuthBadge } from "@/components/auth-badge";
import { useRecentBudgetAlerts } from "@/hooks/use-recent-budget-alerts";
import { useViolationLog } from "@/hooks/use-violation-log";
import { useAuth } from "@/lib/auth";
import { COST_READER_GROUP } from "@/lib/auth-groups";
import { getBudgetThreshold, DEFAULT_BUDGET_THRESHOLD, BUDGET_THRESHOLDS_STORAGE_KEY } from "@/lib/spend-threshold";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Progress } from "@/components/ui/progress";
import { formatDistanceToNow, format } from "date-fns";
import { detectRecentAnomaly } from "@/pages/cost";
import { useCsvExport } from "@/hooks/use-csv-export";
import { CsvToolbar } from "@/components/csv-toolbar";
import { AdminAccessBadge } from "@/components/admin-access-badge";
import { LiveBadge, DataSourceBadge } from "@/components/data-source-badge";
import { CostDataSourceBadge } from "@/components/cost-data-source-badge";
import { readLastTab } from "@/lib/last-tab";

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

function SparklineTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: DailyCostPoint }>;
}) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  const ts = point.timestamp ? new Date(point.timestamp as string) : null;
  const formatted = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(point.value);
  return (
    <div
      style={{
        backgroundColor: "hsl(var(--card))",
        border: "1px solid hsl(var(--border))",
        borderRadius: 4,
        fontSize: 11,
        padding: "4px 8px",
        whiteSpace: "nowrap",
        boxShadow: "0 1px 4px rgba(0,0,0,0.12)",
        pointerEvents: "none",
        lineHeight: 1.4,
      }}
    >
      {ts && (
        <div style={{ color: "hsl(var(--muted-foreground))", marginBottom: 1 }}>
          {format(ts, "MMM d")}
        </div>
      )}
      <div style={{ color: "hsl(var(--foreground))", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
        {formatted}
      </div>
    </div>
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
          <RechartsTooltip
            content={<SparklineTooltip />}
            cursor={false}
            wrapperStyle={{ zIndex: 50 }}
          />
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

function WoWTrendBadge({ trend, label = "Week-over-week spend trend (fleet total)" }: { trend: string | null | undefined; label?: string }) {
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
            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm text-[11px] font-medium border ${colorClass}`}
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

function deriveTrendFromServices(byService: Array<{ service: string; amount: number; trend?: string | null }>): string | null {
  let totalAmount = 0;
  let weightedPct = 0;
  let hasAny = false;
  for (const svc of byService) {
    if (!svc.trend) continue;
    const pct = parseFloat(svc.trend.replace("%", ""));
    if (!Number.isFinite(pct)) continue;
    totalAmount += svc.amount;
    weightedPct += pct * svc.amount;
    hasAny = true;
  }
  if (!hasAny || totalAmount === 0) return null;
  const avg = weightedPct / totalAmount;
  return (avg >= 0 ? "+" : "") + avg.toFixed(1) + "%";
}


const fmt = (amount: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(amount);

const AUTH_TYPES: { value: UserAuthType; label: string }[] = [
  { value: "clerk", label: "Clerk" },
  { value: "entra", label: "Entra ID" },
  { value: "none", label: "Public" },
];

const APP_TAG_FILTERS = [
  { value: "all", label: "All" },
  { value: "orbit", label: "Orbit" },
  { value: "grailbabe", label: "Grailbabe" },
] as const;

type AppTagFilterValue = (typeof APP_TAG_FILTERS)[number]["value"];

function getApplicationTag(app: AppSummary): string | undefined {
  const tags = app.tags as Record<string, string> | undefined;
  return tags?.["Application"] ?? tags?.["application"];
}

function appMatchesTag(app: AppSummary, tag: AppTagFilterValue): boolean {
  if (tag === "all") return true;
  const appTag = getApplicationTag(app);
  return appTag?.toLowerCase() === tag.toLowerCase();
}

function ApplicationTagFilter({
  value,
  onChange,
}: {
  value: AppTagFilterValue;
  onChange: (value: AppTagFilterValue) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <label htmlFor="app-tag-filter" className="text-[12px] text-muted-foreground font-medium">
        Application
      </label>
      <div className="flex items-center gap-1 rounded-sm border border-border bg-card p-0.5">
        {APP_TAG_FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            id={f.value === value ? "app-tag-filter" : undefined}
            onClick={() => onChange(f.value)}
            className={`text-[12px] px-2.5 py-1 rounded-sm transition-colors ${
              value === f.value
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-muted"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function Home() {
  const [location, navigate] = useLocation();
  const { hasGroup } = useAuth();
  const canSeeCost = hasGroup(COST_READER_GROUP.id);
  const recentAlerts = useRecentBudgetAlerts(canSeeCost);

  const queryClient = useQueryClient();

  const { data: apps, isFetching: appsFetching } = useApps();

  const [appTagFilter, setAppTagFilter] = useState<AppTagFilterValue>(() => {
    const params = new URLSearchParams(window.location.search);
    const urlVal = params.get("appTag");
    if ((APP_TAG_FILTERS as unknown as { value: string }[]).map((f) => f.value).includes(urlVal ?? "")) {
      return urlVal as AppTagFilterValue;
    }
    return "all";
  });

  const filteredApps = useMemo(() => {
    return apps?.filter((a) => appMatchesTag(a, appTagFilter));
  }, [apps, appTagFilter]);

  const appAnomalies = useAppAnomalies(filteredApps, canSeeCost);
  const allAppDetails = useAllAppDetails(filteredApps, true);

  const search = useSearch();

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

  const BUDGET_BREACH_FILTER_KEY = "orbit:budgetBreachFilter";

  const [budgetBreachFilter, setBudgetBreachFilter] = useState<boolean>(() => {
    const params = new URLSearchParams(search);
    if (params.get("breach") === "1") return true;
    if (params.has("breach")) return false;
    try {
      return localStorage.getItem(BUDGET_BREACH_FILTER_KEY) === "1";
    } catch {
      return false;
    }
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
    try {
      if (budgetBreachFilter) {
        localStorage.setItem(BUDGET_BREACH_FILTER_KEY, "1");
      } else {
        localStorage.removeItem(BUDGET_BREACH_FILTER_KEY);
      }
    } catch {
      // ignore
    }
    const params = new URLSearchParams(window.location.search);
    if (appTagFilter && appTagFilter !== "all") {
      params.set("appTag", appTagFilter);
    } else {
      params.delete("appTag");
    }
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
  }, [appTagFilter, authFilter, budgetBreachFilter, navigate]);

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
    if (!filteredApps) return {} as Record<UserAuthType, number>;
    return filteredApps.reduce<Record<string, number>>((acc, a) => {
      acc[a.userAuth] = (acc[a.userAuth] ?? 0) + 1;
      return acc;
    }, {});
  }, [filteredApps]);

  function handleRefresh() {
    queryClient.invalidateQueries({ queryKey: getListAppsQueryKey() });
  }

  const globalTotalAlerts = useMemo(
    () => allAppDetails.reduce((sum, d) => sum + (d.activeAlerts ?? 0), 0),
    [allAppDetails],
  );
  const globalTotalMTD = useMemo(
    () => (filteredApps ?? []).reduce((sum, a) => sum + a.monthToDateCost, 0),
    [filteredApps],
  );
  const globalAppsOverBudget = useMemo(
    () => (filteredApps ?? []).filter((a) => a.forecastOverBudget).length,
    [filteredApps],
  );
  const fleetHealth = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const d of allAppDetails) {
      const s = d.status ?? "unknown";
      counts[s] = (counts[s] ?? 0) + 1;
    }
    return counts;
  }, [allAppDetails]);

  const filterLabel = APP_TAG_FILTERS.find((f) => f.value === appTagFilter)?.label ?? "All";

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-foreground tracking-tight">
            {appTagFilter === "all" ? "Dashboard — All Applications" : `Dashboard — ${filterLabel}`}
          </h1>
          <p className="text-[12px] text-muted-foreground mt-0.5">
            {appTagFilter === "all"
              ? "Organisation-wide fleet overview"
              : `Filtered to Application tag: ${filterLabel}`}
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <ApplicationTagFilter value={appTagFilter} onChange={setAppTagFilter} />
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Tile
          title="Total Apps"
          value={filteredApps == null ? null : filteredApps.length}
          sub="Tracked in this fleet"
          icon={<LayoutGrid className="h-4 w-4" />}
          iconColor="#7C3AED"
        />
        <Tile
          title="Active Alerts"
          value={allAppDetails.length === 0 && filteredApps && filteredApps.length > 0 ? null : globalTotalAlerts}
          sub="Open across all apps"
          icon={<AlertCircle className="h-4 w-4" />}
          iconColor="#06B6D4"
        />
        <Tile
          title="MTD Spend"
          value={filteredApps == null ? null : fmt(globalTotalMTD)}
          sub="Sum of month-to-date cost"
          icon={<DollarSign className="h-4 w-4" />}
          iconColor="#10B981"
        />
        <Tile
          title="Apps Over Budget"
          value={filteredApps == null ? null : globalAppsOverBudget}
          sub={globalAppsOverBudget === 1 ? "App forecast exceeds budget" : "Apps forecast over budget"}
          icon={<BudgetIcon className="h-4 w-4" />}
          iconColor="#F59E0B"
        />
      </div>
      <GlobalStrips apps={filteredApps} fleetHealth={fleetHealth} authCounts={authCounts} />

      {canSeeCost && (
        <BudgetSummaryWidget
          apps={filteredApps}
          isFetching={appsFetching}
          recentAlerts={recentAlerts}
          anomalousApps={appAnomalies}
          authFilter={authFilter}
          onAuthBadgeClick={toggleAuthFilter}
          budgetBreachFilter={budgetBreachFilter}
          onToggleBudgetBreach={toggleBudgetBreachFilter}
          onClearAllFilters={() => {
            clearAuthFilter();
            setBudgetBreachFilter(false);
          }}
        />
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
type BudgetSortCol = "name" | "auth" | "spent" | "budget" | "forecast" | "utilization" | "status" | "wow" | "trend";
type SortDir = "asc" | "desc";

const BUDGET_STATUS_RANK: Record<BudgetStatus, number> = { over: 0, warning: 1, ok: 2, none: 3 };

function budgetStatus(app: AppSummary, threshold: number = DEFAULT_BUDGET_THRESHOLD, costData?: any): BudgetStatus {
  const budget = costData?.budget ?? app.budget;
  const forecastOverBudget = costData?.forecastOverBudget ?? app.forecastOverBudget;
  const monthToDateCost = costData?.monthToDate ?? app.monthToDateCost;
  
  if (budget == null) return "none";
  if (forecastOverBudget) return "over";
  const pct = budget > 0 ? (monthToDateCost / budget) * 100 : 0;
  if (pct >= threshold) return "warning";
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

function BudgetTh({
  col,
  sortCol,
  sortDir,
  onSort,
  children,
  align = "left",
  className,
}: {
  col: BudgetSortCol;
  sortCol: BudgetSortCol;
  sortDir: SortDir;
  onSort: (col: BudgetSortCol) => void;
  children: React.ReactNode;
  align?: "left" | "right";
  className?: string;
}) {
  const active = sortCol === col;
  const Icon = active ? (sortDir === "asc" ? ChevronUp : ChevronDown) : ChevronsUpDown;
  return (
    <th
      className={`font-medium text-muted-foreground py-2 cursor-pointer select-none hover:text-foreground transition-colors ${align === "right" ? "text-right" : "text-left"} ${className ?? ""}`}
      onClick={() => onSort(col)}
    >
      <span className={`inline-flex items-center gap-0.5 ${align === "right" ? "flex-row-reverse" : ""}`}>
        <Icon className={`h-3 w-3 shrink-0 ${active ? "text-foreground" : "opacity-40"}`} />
        {children}
      </span>
    </th>
  );
}

function parseTrend(trend: string | undefined | null): number {
  if (!trend) return -Infinity;
  const n = parseFloat(trend.replace(/[^0-9.\-+]/g, ""));
  return isNaN(n) ? -Infinity : n;
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
  onClearAllFilters,
}: {
  apps: AppSummary[] | undefined;
  isFetching: boolean;
  recentAlerts: Map<string, Date>;
  anomalousApps: Set<string>;
  authFilter: UserAuthType | null;
  onAuthBadgeClick: (v: UserAuthType) => void;
  budgetBreachFilter: boolean;
  onToggleBudgetBreach: () => void;
  onClearAllFilters: () => void;
}) {
  const [, navigate] = useLocation();

  const { entries: violationEntries } = useViolationLog();
  const unseenViolationsByApp = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of violationEntries) {
      if (!e.seen && !e.dismissed) {
        map.set(e.appId, (map.get(e.appId) ?? 0) + 1);
      }
    }
    return map;
  }, [violationEntries]);

  const [thresholdVersion, setThresholdVersion] = useState(0);
  useEffect(() => {
    const refresh = () => setThresholdVersion((v) => v + 1);
    const onStorage = (e: StorageEvent) => {
      if (e.key === BUDGET_THRESHOLDS_STORAGE_KEY) refresh();
    };
    window.addEventListener("orbit-budget-threshold-changed", refresh);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("orbit-budget-threshold-changed", refresh);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const [sortCol, setSortCol] = useState<BudgetSortCol>("status");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  function handleSort(col: BudgetSortCol) {
    if (sortCol === col) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortCol(col);
      setSortDir("asc");
    }
  }

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

  // Fetch real cost data for each app (same as cost management tab)
  const costQueries = useQueries({
    queries: (apps ?? []).map((app) => ({
      queryKey: getGetCostQueryKey(app.id),
      queryFn: () => getCost(app.id),
      staleTime: 5 * 60 * 1000,
    })),
  });

  const { data: globalCostSummary } = useGetGlobalCostSummary({
    query: { queryKey: getGetGlobalCostSummaryQueryKey(), staleTime: 5 * 60 * 1000 },
  });
  const trendByAppId = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of globalCostSummary?.byApp ?? []) {
      if (item.trend) map.set(item.appId, item.trend);
    }
    return map;
  }, [globalCostSummary?.byApp]);

  // Add Microsoft365 cost center data to match cost page behavior
  const costCenterData = useMemo(() => {
    const categories = globalCostSummary?.byCategory ?? [];
    return categories.map(cat => ({
      id: `cost-center-${cat.category}`,
      name: cat.category === "Other" ? "Microsoft365" : cat.category,
      category: cat.category,
      monthToDateCost: cat.monthToDate,
      budget: null, // Cost centers typically don't have budgets
      forecast: null, // Cost centers typically don't have forecasts
      forecastOverBudget: false,
      userAuth: "none" as const,
      environment: "cost-center" as const,
      costDataSource: globalCostSummary?.dataSource,
    }));
  }, [globalCostSummary?.byCategory, globalCostSummary?.dataSource]);

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
    const filtered = apps.filter((a, index) => {
      const costData = costQueries[index]?.data;
      const forecast = costData?.forecast ?? a.forecast;
      const budget = costData?.budget ?? a.budget;
      const forecastOverBudget = (forecast != null && budget != null) ? forecast > budget : a.forecastOverBudget;
      
      if (authFilter !== null && a.userAuth !== authFilter) return false;
      if (envFilter !== "all" && a.environment !== envFilter) return false;
      if (budgetBreachFilter && !forecastOverBudget) return false;
      return true;
    });
    return [...filtered].sort((a, b) => {
      const costDataA = costQueries[apps.indexOf(a)]?.data;
      const costDataB = costQueries[apps.indexOf(b)]?.data;
      
      let diff = 0;
      if (sortCol === "status") {
        diff =
          BUDGET_STATUS_RANK[budgetStatus(a, getBudgetThreshold(a.id), costDataA)] -
          BUDGET_STATUS_RANK[budgetStatus(b, getBudgetThreshold(b.id), costDataB)];
        if (diff === 0) {
          const costA = costDataA?.monthToDate ?? a.monthToDateCost;
          const costB = costDataB?.monthToDate ?? b.monthToDateCost;
          diff = costB - costA;
        }
      } else if (sortCol === "name") {
        diff = a.name.localeCompare(b.name);
      } else if (sortCol === "auth") {
        diff = a.userAuth.localeCompare(b.userAuth);
      } else if (sortCol === "spent") {
        const costA = costDataA?.monthToDate ?? a.monthToDateCost;
        const costB = costDataB?.monthToDate ?? b.monthToDateCost;
        diff = costA - costB;
      } else if (sortCol === "budget") {
        const budgetA = costDataA?.budget ?? a.budget;
        const budgetB = costDataB?.budget ?? b.budget;
        if (budgetA == null && budgetB == null) diff = 0;
        else if (budgetA == null) diff = 1;
        else if (budgetB == null) diff = -1;
        else diff = budgetA - budgetB;
      } else if (sortCol === "forecast") {
        const forecastA = costDataA?.forecast ?? a.forecast;
        const forecastB = costDataB?.forecast ?? b.forecast;
        if (forecastA == null && forecastB == null) diff = 0;
        else if (forecastA == null) diff = 1;
        else if (forecastB == null) diff = -1;
        else diff = forecastA - forecastB;
      } else if (sortCol === "utilization") {
        const costA = costDataA?.monthToDate ?? a.monthToDateCost;
        const costB = costDataB?.monthToDate ?? b.monthToDateCost;
        const budgetA = costDataA?.budget ?? a.budget;
        const budgetB = costDataB?.budget ?? b.budget;
        const pctA = budgetA != null && budgetA > 0 ? (costA / budgetA) * 100 : -1;
        const pctB = budgetB != null && budgetB > 0 ? (costB / budgetB) * 100 : -1;
        diff = pctA - pctB;
      } else if (sortCol === "wow") {
        diff = parseTrend(trendByAppId.get(a.id)) - parseTrend(trendByAppId.get(b.id));
      } else if (sortCol === "trend") {
        const seriesA = dailySpend.get(a.id);
        const seriesB = dailySpend.get(b.id);
        const lastA = seriesA && seriesA.length > 0 ? seriesA[seriesA.length - 1].value : -Infinity;
        const lastB = seriesB && seriesB.length > 0 ? seriesB[seriesB.length - 1].value : -Infinity;
        diff = lastA - lastB;
      }
      return sortDir === "asc" ? diff : -diff;
    });
  }, [apps, authFilter, envFilter, budgetBreachFilter, thresholdVersion, sortCol, sortDir, trendByAppId, dailySpend, costQueries]);

  // Combine apps and cost centers for budget calculations
  const allBudgetItems = useMemo(() => {
    if (!filteredApps) return undefined;
    const appItems = filteredApps.map(app => ({
      ...app,
      isCostCenter: false,
    }));
    const centerItems = costCenterData.map(center => ({
      ...center,
      isCostCenter: true,
    }));
    return [...appItems, ...centerItems];
  }, [filteredApps, costCenterData]);

  function goToCost() {
    if (isFiltered && filterSummary) {
      navigate(`/cost?from=${encodeURIComponent(filterSummary)}`);
    } else {
      navigate("/cost");
    }
  }

  // Use real cost data for budget status calculations
  const overCount = useMemo(() => {
    return filteredApps?.filter((a, index) => {
      const costData = costQueries[index]?.data;
      const forecast = costData?.forecast ?? a.forecast;
      const budget = costData?.budget ?? a.budget;
      return (forecast != null && budget != null) ? forecast > budget : a.forecastOverBudget;
    }).length ?? 0;
  }, [filteredApps, costQueries]);

  const warningCount = useMemo(() => {
    return filteredApps?.filter((a, index) => {
      const costData = costQueries[index]?.data;
      const forecast = costData?.forecast ?? a.forecast;
      const budget = costData?.budget ?? a.budget;
      const forecastOverBudget = (forecast != null && budget != null) ? forecast > budget : a.forecastOverBudget;
      if (forecastOverBudget) return false;
      
      if (budget == null) return false;
      
      const cost = costData?.monthToDate ?? a.monthToDateCost;
      const pct = budget > 0 ? (cost / budget) * 100 : 0;
      return pct >= getBudgetThreshold(a.id);
    }).length ?? 0;
  }, [filteredApps, thresholdVersion, costQueries]);

  // Use real cost data from cost API and cost centers instead of placeholder app summary data
  const totalSpentMTD = useMemo(() => {
    if (!allBudgetItems) return 0;
    return allBudgetItems.reduce((total, item) => {
      if (item.isCostCenter) {
        // Cost centers use their monthToDateCost directly
        return total + item.monthToDateCost;
      } else {
        // Apps use cost API data with fallback to app summary
        const appIndex = filteredApps?.findIndex(app => app.id === item.id);
        const costData = appIndex !== -1 && appIndex !== undefined ? costQueries[appIndex]?.data : null;
        const cost = costData?.monthToDate ?? item.monthToDateCost;
        return total + cost;
      }
    }, 0);
  }, [allBudgetItems, filteredApps, costQueries]);

  const topSpenderId = useMemo(() => {
    if (!filteredApps || filteredApps.length < 2) return null;
    return filteredApps.reduce((top, app, index) => {
      const costData = costQueries[index]?.data;
      const cost = costData?.monthToDate ?? app.monthToDateCost;
      const topCostData = costQueries[filteredApps.indexOf(top)]?.data;
      const topCost = topCostData?.monthToDate ?? top.monthToDateCost;
      return cost > topCost ? app : top;
    }, filteredApps[0]).id;
  }, [filteredApps, costQueries]);

  // Use real budget and forecast data from cost API (cost centers typically don't have budgets)
  const budgetedApps = useMemo(() => {
    if (!allBudgetItems) return [];
    return allBudgetItems.filter((item) => {
      if (item.isCostCenter) {
        return false; // Cost centers typically don't have budgets
      } else {
        const appIndex = filteredApps?.findIndex(app => app.id === item.id);
        const costData = appIndex !== -1 && appIndex !== undefined ? costQueries[appIndex]?.data : null;
        return (costData?.budget ?? item.budget) != null;
      }
    });
  }, [allBudgetItems, filteredApps, costQueries]);

  const totalBudget = useMemo(() => {
    return budgetedApps.reduce((total, item) => {
      const appIndex = filteredApps?.findIndex(app => app.id === item.id);
      const costData = appIndex !== -1 && appIndex !== undefined ? costQueries[appIndex]?.data : null;
      const budget = costData?.budget ?? item.budget;
      return total + (budget ?? 0);
    }, 0);
  }, [budgetedApps, filteredApps, costQueries]);

  const totalForecast = useMemo(() => {
    return budgetedApps.reduce((total, item) => {
      const appIndex = filteredApps?.findIndex(app => app.id === item.id);
      const costData = appIndex !== -1 && appIndex !== undefined ? costQueries[appIndex]?.data : null;
      const forecast = costData?.forecast ?? item.forecast;
      return total + (forecast ?? 0);
    }, 0);
  }, [budgetedApps, filteredApps, costQueries]);

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
  const liveAppNames = appsWithSource.filter((a) => a.costDataSource === "live").map((a) => a.name);
  const estimatedAppNames = appsWithSource.filter((a) => a.costDataSource !== "live").map((a) => a.name);
  const costLiveBadge = allLive ? (
    <LiveBadge className="mt-1.5" />
  ) : someLive ? (
    <LiveBadge
      label={`${liveCount}/${totalSourced} Live`}
      className="mt-1.5"
      liveApps={liveAppNames}
      estimatedApps={estimatedAppNames}
    />
  ) : null;

  const { data: globalHealth } = useGetGlobalHealth({
    query: { queryKey: getGetGlobalHealthQueryKey(), staleTime: 5 * 60 * 1000 },
  });
  const globalCostSource = globalHealth?.costDataSource;
  const globalCostSourceBadge =
    globalCostSource && globalCostSource !== "mock" ? (
      <div className="mt-1.5">
        <DataSourceBadge dataSource={globalCostSource} dataAsOf={globalCostSummary?.dataAsOf} label="Azure Cost Management" />
      </div>
    ) : null;

  const isFiltered = authFilter !== null || envFilter !== "all" || budgetBreachFilter;

  function clearAllFilters() {
    setEnvFilter("all");
    onClearAllFilters();
  }

  const filterSummaryParts: string[] = [];
  if (authFilter !== null) filterSummaryParts.push(authFilter.charAt(0).toUpperCase() + authFilter.slice(1));
  if (envFilter !== "all") filterSummaryParts.push(envFilter.charAt(0).toUpperCase() + envFilter.slice(1));
  if (budgetBreachFilter) filterSummaryParts.push("Budget breach");
  const filterSummary = filterSummaryParts.join(" · ");

  const appCount = filteredApps?.length ?? apps?.length;

  const csvHeaders = ["Application", "Environment", "Auth", "Spent MTD (USD)", "Budget (USD)", "Forecast (USD)", "Utilization %", "Status", "Budget breach", "WoW Trend"];
  const csvRows = useMemo(() => {
    if (!allBudgetItems || !apps) return null;
    
    // App rows
    const appRows = filteredApps?.map((app) => {
      const appIndex = apps.indexOf(app);
      const costData = costQueries[appIndex]?.data;
      const status = budgetStatus(app, getBudgetThreshold(app.id), costData);
      
      const cost = costData?.monthToDate ?? app.monthToDateCost;
      const budget = costData?.budget ?? app.budget;
      const forecast = costData?.forecast ?? app.forecast;
      const forecastOverBudget = (forecast != null && budget != null) ? forecast > budget : app.forecastOverBudget;
      
      const pct = budget != null && budget > 0
        ? Math.round(Math.min((cost / budget) * 100, 100))
        : null;
      return [
        app.name,
        app.environment,
        app.userAuth,
        cost.toFixed(2),
        budget != null ? budget.toFixed(2) : "",
        forecast != null ? forecast.toFixed(2) : "",
        pct != null ? String(pct) : "",
        status,
        forecastOverBudget ? "Yes" : "No",
        trendByAppId.get(app.id) ?? "",
      ];
    }) ?? [];

    // Cost center rows (Microsoft365, etc.)
    const costCenterRows = costCenterData.map((center) => {
      return [
        center.name,
        center.environment,
        center.userAuth,
        center.monthToDateCost.toFixed(2),
        "", // No budget for cost centers
        "", // No forecast for cost centers
        "", // No utilization for cost centers
        "No budget", // Status for cost centers
        "No", // No budget breach for cost centers
        "", // No trend for cost centers
      ];
    });

    const allRows = [...appRows, ...costCenterRows];
    const unbudgetedCount = filteredApps?.filter((a, index) => {
      const costData = costQueries[index]?.data;
      return (costData?.budget ?? a.budget) == null;
    }).length ?? 0;
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
      globalCostSummary?.wowTrend ?? "",
    ];

    const rows: string[][] = [...allRows, totalRow];
    if (unbudgetedCount > 0) {
      rows.push([
        `Note: ${unbudgetedCount} app${unbudgetedCount === 1 ? "" : "s"} not included in budget/forecast totals (no budget set)`,
        "", "", "", "", "", "", "", "", "",
      ]);
    }
    return rows;
  }, [allBudgetItems, filteredApps, costCenterData, costQueries, totalSpentMTD, totalBudget, totalForecast, totalUtilizationPct, totalUtilizationStatus, trendByAppId, globalCostSummary?.wowTrend]);

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
          {isFiltered && (
            <button
              type="button"
              onClick={clearAllFilters}
              className="flex items-center gap-0.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
              title="Clear all filters"
            >
              <X className="h-3 w-3" />
              <span>Clear all</span>
            </button>
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
            <div className="flex items-center gap-2 flex-wrap">
              <div className="text-lg font-semibold tabular-nums">{fmt(totalSpentMTD)}</div>
              <WoWTrendBadge trend={globalCostSummary?.wowTrend ?? null} />
            </div>
          )}
          <div className="text-[10px] text-muted-foreground mt-0.5">
            {filteredApps ? `Across ${filteredApps.length} app${filteredApps.length !== 1 ? "s" : ""}` : ""}
          </div>
          {globalCostSourceBadge}
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

      {someLive && filteredApps && (
        <div className="flex items-center gap-1.5 px-4 py-1.5 border-b border-border bg-muted/10 text-[11px] text-muted-foreground">
          <span>
            {liveCount} of {totalSourced} app{totalSourced !== 1 ? "s" : ""} showing live data
          </span>
          <span className="text-border">·</span>
          <span>{estimatedAppNames.length} estimated</span>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <BudgetTh col="name" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} className="px-4 w-[180px]">Application</BudgetTh>
              <BudgetTh col="auth" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} className="px-3">Auth</BudgetTh>
              <BudgetTh col="spent" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} align="right" className="px-3">Spent MTD</BudgetTh>
              <BudgetTh col="budget" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} align="right" className="px-3">Budget</BudgetTh>
              <BudgetTh col="forecast" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} align="right" className="px-3">Forecast</BudgetTh>
              <BudgetTh col="utilization" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} className="px-3 w-[120px]">Utilization</BudgetTh>
              <BudgetTh col="status" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} className="px-3">Status</BudgetTh>
              <BudgetTh col="wow" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} align="right" className="px-3 w-[60px]">WoW</BudgetTh>
              <BudgetTh col="trend" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} className="px-3 w-[88px]">{sparklineRange}d trend</BudgetTh>
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
                  <td className="px-3 py-2.5 text-right"><Skeleton className="h-4 w-10 ml-auto" /></td>
                  <td className="px-3 py-2.5"><Skeleton className="h-6 w-[72px]" /></td>
                  <td className="px-2 py-2.5" />
                </tr>
              ))
            ) : filteredApps.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-4 py-6 text-center text-[13px] text-muted-foreground">
                  No apps match the active filters.
                </td>
              </tr>
            ) : (
              allBudgetItems?.map((item) => {
                const threshold = item.isCostCenter ? DEFAULT_BUDGET_THRESHOLD : getBudgetThreshold(item.id);
                const status = item.isCostCenter ? "none" : (() => {
                  const appIndex = filteredApps?.findIndex(app => app.id === item.id);
                  const app = appIndex !== -1 && appIndex !== undefined ? filteredApps[appIndex] : null;
                  return app ? budgetStatus(app, threshold, costQueries[appIndex]?.data) : "none";
                })();
                
                let cost, budget, forecast, pct;
                if (item.isCostCenter) {
                  cost = item.monthToDateCost;
                  budget = null;
                  forecast = null;
                  pct = null;
                } else {
                  const appIndex = filteredApps?.findIndex(app => app.id === item.id);
                  const costData = appIndex !== -1 && appIndex !== undefined ? costQueries[appIndex]?.data : null;
                  cost = costData?.monthToDate ?? item.monthToDateCost;
                  budget = costData?.budget ?? item.budget;
                  forecast = costData?.forecast ?? item.forecast;
                  pct = budget != null && budget > 0
                    ? Math.min((cost / budget) * 100, 100)
                    : null;
                }
                
                const hasAlert = !item.isCostCenter ? recentAlerts.has(item.id) : false;
                const hasAnomaly = !item.isCostCenter ? anomalousApps.has(item.id) : false;
                const unseenViolations = !item.isCostCenter ? (unseenViolationsByApp.get(item.id) ?? 0) : 0;

                return (
                  <tr
                    key={item.id}
                    className="border-b border-border last:border-0 hover:bg-muted/30 cursor-pointer transition-colors"
                    onClick={() => goToCost()}
                  >
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium text-foreground truncate max-w-[140px]">{item.name}</span>
                        {!item.isCostCenter && 'androidPackage' in item && item.androidPackage && (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <a
                                  href={`https://play.google.com/store/apps/details?id=${item.androidPackage}`}
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
                        {!item.isCostCenter && 'iosBundle' in item && item.iosBundle && (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <a
                                  href={`https://apps.apple.com/app/${item.iosBundle}`}
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
                                Budget alert sent {formatDistanceToNow(recentAlerts.get(item.id)!, { addSuffix: true })}
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}
                        {unseenViolations > 0 && (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full text-[9px] font-bold bg-red-500 text-white shrink-0 tabular-nums">
                                  {unseenViolations > 99 ? "99+" : unseenViolations}
                                </span>
                              </TooltipTrigger>
                              <TooltipContent>
                                {unseenViolations} unseen infra threshold {unseenViolations === 1 ? "violation" : "violations"} — open app to review
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}
                      </div>
                    </td>
                    <td
                      className="px-3 py-2.5"
                      onClick={(e) => { e.stopPropagation(); onAuthBadgeClick(item.userAuth); }}
                    >
                      <AuthBadge
                        userAuth={item.userAuth}
                        active={authFilter === item.userAuth}
                        onClick={() => onAuthBadgeClick(item.userAuth)}
                      />
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-foreground">
                      <div className="flex items-center justify-end gap-1.5">
                        {item.costDataSource && item.costDataSource !== "mock" && (
                          <CostDataSourceBadge dataSource={item.costDataSource} />
                        )}
                        <div className="flex flex-col items-end gap-0.5">
                          {fmt(cost)}
                          {allBudgetItems && allBudgetItems.length >= 2 && totalSpentMTD > 0 && (() => {
                            const sharePct = Math.round((cost / totalSpentMTD) * 100);
                            const isTop = !item.isCostCenter && item.id === topSpenderId;
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
                      {budget != null ? fmt(budget) : <span className="text-muted-foreground/50">—</span>}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                      {forecast != null ? fmt(forecast) : <span className="text-muted-foreground/50">—</span>}
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
                              <TooltipContent>Alert at {threshold}% · {Math.round(pct)}% utilized</TooltipContent>
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
                    <td className="px-3 py-2.5 text-right tabular-nums" onClick={(e) => e.stopPropagation()}>
                      {(() => {
                        const trend = trendByAppId.get(item.id) ?? null;
                        if (!trend) return <span className="text-muted-foreground/50 text-[11px]">—</span>;
                        const isPos = trend.startsWith("+");
                        const isNeg = trend.startsWith("-");
                        const cls = isPos
                          ? "text-red-500"
                          : isNeg
                          ? "text-emerald-500"
                          : "text-muted-foreground";
                        return (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className={`font-mono text-[11px] font-medium ${cls}`}>{trend}</span>
                              </TooltipTrigger>
                              <TooltipContent>Week-over-week cost change</TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        );
                      })()}
                    </td>
                    <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                      <BudgetSparkline data={dailySpend.get(item.id)} status={status} />
                    </td>
                    <td className="px-2 py-2.5 text-muted-foreground/40">
                      <ChevronRight className="h-3.5 w-3.5" />
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
          {allBudgetItems && allBudgetItems.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-border bg-muted/40">
                <td className="px-4 py-2.5">
                  <div className="flex flex-col gap-0.5">
                    <span className="font-semibold text-foreground">Total</span>
                    <span className="text-[10px] text-muted-foreground">
                      {filteredApps?.length ?? 0} apps, {costCenterData.length} cost centers
                    </span>
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
                <td className="px-3 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                  {(() => {
                    const trend = globalCostSummary?.wowTrend ?? null;
                    if (!trend) return <span className="text-muted-foreground/50 text-[11px]">—</span>;
                    const isPos = trend.startsWith("+");
                    const isNeg = trend.startsWith("-");
                    const cls = isPos
                      ? "text-red-500"
                      : isNeg
                      ? "text-emerald-500"
                      : "text-muted-foreground";
                    return (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className={`font-mono text-[11px] font-semibold ${cls}`}>{trend}</span>
                          </TooltipTrigger>
                          <TooltipContent>Fleet-wide week-over-week cost change</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    );
                  })()}
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

function PerAppBudgetPanel({
  app,
  recentAlerts,
}: {
  app: AppSummary;
  recentAlerts: Map<string, Date>;
}) {
  const threshold = getBudgetThreshold(app.id);
  const status = budgetStatus(app, threshold);
  const pct =
    app.budget != null && app.budget > 0
      ? Math.min((app.monthToDateCost / app.budget) * 100, 100)
      : null;
  const hasAlert = recentAlerts.has(app.id);

  return (
    <div className="bg-card border border-border shadow-sm">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border">
        <TrendingUp className="h-3.5 w-3.5 text-muted-foreground" />
        <h2 className="text-sm font-semibold">Budget Status</h2>
        {hasAlert && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex items-center">
                  <Bell className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                </span>
              </TooltipTrigger>
              <TooltipContent>
                Budget alert sent {formatDistanceToNow(recentAlerts.get(app.id)!, { addSuffix: true })}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
        {app.costDataSource && app.costDataSource !== "mock" && (
          <CostDataSourceBadge dataSource={app.costDataSource} />
        )}
      </div>
      <div className="flex flex-wrap divide-x divide-border">
        <div className="px-6 py-3 flex flex-col gap-0.5 min-w-[150px]">
          <div className="text-[11px] text-muted-foreground font-medium">Spent MTD</div>
          <div className="flex items-center gap-1.5 flex-wrap">
            {app.costDataSource && app.costDataSource !== "mock" && (
              <CostDataSourceBadge dataSource={app.costDataSource} />
            )}
            <span className="text-lg font-semibold tabular-nums">{fmt(app.monthToDateCost)}</span>
          </div>
        </div>
        <div className="px-6 py-3 flex flex-col gap-0.5 min-w-[120px]">
          <div className="text-[11px] text-muted-foreground font-medium">Budget</div>
          <div className="text-lg font-semibold tabular-nums text-foreground">
            {app.budget != null ? fmt(app.budget) : <span className="text-muted-foreground/50 text-base">—</span>}
          </div>
        </div>
        <div className="px-6 py-3 flex flex-col gap-0.5 min-w-[120px]">
          <div className="text-[11px] text-muted-foreground font-medium">Forecast</div>
          <div className="text-lg font-semibold tabular-nums text-foreground">
            {app.forecast != null ? fmt(app.forecast) : <span className="text-muted-foreground/50 text-base">—</span>}
          </div>
        </div>
        <div className="px-6 py-3 flex flex-col gap-1 min-w-[160px]">
          <div className="text-[11px] text-muted-foreground font-medium">Utilization</div>
          {pct !== null ? (
            <div className="flex items-center gap-2">
              <Progress
                value={pct}
                className={`h-1.5 w-24 ${
                  status === "over"
                    ? "[&>div]:bg-red-500"
                    : status === "warning"
                    ? "[&>div]:bg-amber-500"
                    : "[&>div]:bg-emerald-500"
                }`}
              />
              <span className="text-sm tabular-nums text-foreground">{Math.round(pct)}%</span>
            </div>
          ) : (
            <span className="text-muted-foreground/50">—</span>
          )}
        </div>
        <div className="px-6 py-3 flex flex-col gap-1 min-w-[140px]">
          <div className="text-[11px] text-muted-foreground font-medium">Status</div>
          <StatusPill status={status} />
        </div>
      </div>
    </div>
  );
}

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
      <div className="relative overflow-hidden bg-card border border-border shadow-sm p-3 flex flex-col gap-2 orbit-card-accent">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: "radial-gradient(80% 60% at 0% 0%, #10B98110 0%, transparent 70%)" }}
        />
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center justify-center w-6 h-6 rounded-md" style={{ background: "#10B98122", border: "1px solid #10B98144", color: "#10B981" }}>
            <HeartPulse className="h-3.5 w-3.5" />
          </span>
          <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Fleet Health</div>
        </div>
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

      <div className="relative overflow-hidden bg-card border border-border shadow-sm p-3 flex flex-col gap-2 orbit-card-accent">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: "radial-gradient(80% 60% at 0% 0%, #7C3AED10 0%, transparent 70%)" }}
        />
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center justify-center w-6 h-6 rounded-md" style={{ background: "#7C3AED22", border: "1px solid #7C3AED44", color: "#A78BFA" }}>
            <ShieldCheck className="h-3.5 w-3.5" />
          </span>
          <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Identity Landscape</div>
        </div>
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

function Tile({
  title,
  value,
  sub,
  href,
  icon,
  iconColor = "#7C3AED",
}: {
  title: string;
  value: React.ReactNode;
  sub: string;
  href?: string;
  icon?: React.ReactNode;
  iconColor?: string;
}) {
  const inner = (
    <>
      <div className="flex items-start justify-between gap-2 mb-2">
        {icon && (
          <span
            className="inline-flex items-center justify-center w-8 h-8 rounded-md shrink-0"
            style={{
              background: `${iconColor}22`,
              border: `1px solid ${iconColor}44`,
              color: iconColor,
              boxShadow: `0 0 12px ${iconColor}33`,
            }}
          >
            {icon}
          </span>
        )}
        {href && <ChevronRight className="h-3 w-3 text-muted-foreground/40 shrink-0 mt-1 ml-auto" />}
      </div>
      {value === null ? (
        <Skeleton className="h-7 w-20 mb-1" />
      ) : (
        <div className="text-2xl font-bold text-foreground mb-0.5 tabular-nums">{value}</div>
      )}
      <div className="text-[11px] text-muted-foreground truncate">{title}</div>
      <div className="text-[10px] text-muted-foreground/60 truncate mt-0.5">{sub}</div>
    </>
  );

  const cardClass = `relative overflow-hidden bg-card border border-border p-3 shadow-sm flex flex-col justify-between orbit-card-accent transition-colors`;

  if (href) {
    return (
      <Link href={href} className={`${cardClass} hover:bg-muted/40 hover:border-border/80 cursor-pointer`}>
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: `radial-gradient(80% 60% at 0% 0%, ${iconColor}0d 0%, transparent 70%)` }}
        />
        {inner}
      </Link>
    );
  }

  return (
    <div className={cardClass}>
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ background: `radial-gradient(80% 60% at 0% 0%, ${iconColor}0d 0%, transparent 70%)` }}
      />
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
