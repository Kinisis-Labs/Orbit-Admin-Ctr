import { useMemo } from "react";
import { Link } from "wouter";
import {
  useGetGlobalCostSummary,
  getGetGlobalCostSummaryQueryKey,
  useListGlobalEndpoints,
  useListSlos,
  useGetTagCompliance,
} from "@workspace/api-client-react";
import type { GlobalEndpointRow, SloRow } from "@workspace/api-client-react";
import { useApps } from "@/hooks/use-apps";
import { Skeleton } from "@/components/ui/skeleton";
import { RefreshingBar } from "@/components/refreshing-bar";
import { DataSourceBadge } from "@/components/data-source-badge";
import { CostDataSourceBadge } from "@/components/cost-data-source-badge";
import { StatusPill } from "@/components/page-header";
import {
  DollarSign,
  HeartPulse,
  Network,
  Tag,
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  ArrowRight,
  ChevronRight,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { useAuth } from "@/lib/auth";
import { COST_READER_GROUP } from "@/lib/auth-groups";

// ─── Cost category config ──────────────────────────────────────────────────

const COST_CATEGORY_ORDER: string[] = [
  "Infrastructure",
  "WebApp",
  "BusinessOps",
  "DataPlatform",
  "Security",
  "AI",
  "Shared",
];

const COST_CATEGORY_COLOR: Record<string, string> = {
  Untagged: "#94a3b8",
  Infrastructure: "#3b82f6",
  WebApp: "#8b5cf6",
  BusinessOps: "#f59e0b",
  DataPlatform: "#06b6d4",
  Security: "#ef4444",
  AI: "#10b981",
  Shared: "#94a3b8",
};

const COMPLIANCE_REQUIRED_TAGS = ["CostCategory", "Application", "Environment"] as const;
const STATUS_RANK: Record<string, number> = { unhealthy: 0, degraded: 1, unknown: 2, healthy: 3 };

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);

const fmtK = (n: number) => {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return fmt(n);
};

// ─── Section header ────────────────────────────────────────────────────────

function SectionHeader({
  icon,
  title,
  sub,
  right,
  href,
}: {
  icon: React.ReactNode;
  title: string;
  sub?: string;
  right?: React.ReactNode;
  href?: string;
}) {
  return (
    <div className="p-2 border-b border-border flex items-center gap-2">
      <span className="ml-2 text-muted-foreground shrink-0">{icon}</span>
      <h2 className="text-sm font-semibold">{title}</h2>
      {sub && (
        <span className="text-[11px] text-muted-foreground ml-1 hidden sm:inline">{sub}</span>
      )}
      <div className="ml-auto flex items-center gap-2">
        {right}
        {href && (
          <Link
            href={href}
            className="inline-flex items-center gap-0.5 text-[11px] text-primary hover:underline shrink-0"
          >
            View all <ChevronRight className="h-3 w-3" />
          </Link>
        )}
      </div>
    </div>
  );
}

// ─── Stat tile ─────────────────────────────────────────────────────────────

function Tile({
  title,
  value,
  sub,
  tone,
}: {
  title: string;
  value: React.ReactNode | null;
  sub: string;
  tone?: "ok" | "warn" | "bad" | "muted";
}) {
  const valueColor =
    tone === "bad"
      ? "text-destructive"
      : tone === "warn"
        ? "text-amber-500"
        : tone === "ok"
          ? "text-green-500"
          : "";
  return (
    <div className="bg-card border border-border shadow-sm p-3 space-y-0.5">
      <div className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide">
        {title}
      </div>
      {value === null ? (
        <Skeleton className="h-7 w-20" />
      ) : (
        <div className={`text-2xl font-bold tabular-nums ${valueColor}`}>{value}</div>
      )}
      <div className="text-[11px] text-muted-foreground">{sub}</div>
    </div>
  );
}

// ─── Cost section ──────────────────────────────────────────────────────────

function CostSection({ canSeeCost }: { canSeeCost: boolean }) {
  const { data, isLoading, isFetching } = useGetGlobalCostSummary({
    query: {
      queryKey: getGetGlobalCostSummaryQueryKey(),
      staleTime: 5 * 60 * 1000,
      enabled: canSeeCost,
    },
  });

  const totalMtd = data?.total ?? 0;
  const totalForecast =
    data?.byApp?.reduce((s: number, a: { monthToDate: number }) => s + (a.monthToDate ?? 0), 0) ??
    null;
  const dataSource = data?.dataSource;

  // Group MTD spend by CostCategory tag — uses byApp list + app tags
  const { data: apps } = useApps();

  const categorySpend = useMemo(() => {
    if (!data?.byApp || !apps) return [];
    const map = new Map<string, number>();
    for (const item of data.byApp) {
      const app = apps.find((a) => a.id === item.appId);
      const appTags = app?.tags as Record<string, string> | undefined;
      const cat = appTags?.["CostCategory"] ?? appTags?.["costCategory"] ?? "Untagged";
      map.set(cat, (map.get(cat) ?? 0) + (item.monthToDate ?? 0));
    }
    const ordered = COST_CATEGORY_ORDER.map((c) => ({
      name: c,
      value: map.get(c) ?? 0,
    }));
    const untagged = map.get("Untagged");
    if (untagged) ordered.push({ name: "Untagged", value: untagged });
    const knownSet = new Set([...COST_CATEGORY_ORDER, "Untagged"]);
    for (const [name, value] of map) {
      if (!knownSet.has(name)) ordered.push({ name, value });
    }
    return ordered.sort((a, b) => b.value - a.value);
  }, [data?.byApp, apps]);

  const totalCategorised = categorySpend
    .filter((c) => c.name !== "Untagged")
    .reduce((s, c) => s + c.value, 0);
  const untaggedAmt = categorySpend.find((c) => c.name === "Untagged")?.value ?? 0;

  if (!canSeeCost) {
    return (
      <div className="bg-card border border-border shadow-sm">
        <SectionHeader
          icon={<DollarSign className="h-3.5 w-3.5" />}
          title="Cost by CostCategory"
          href="/cost"
        />
        <div className="p-6 text-center text-[12px] text-muted-foreground">
          Cost data is restricted to members of the Cost Reader group.
        </div>
      </div>
    );
  }

  return (
    <div className="bg-card border border-border shadow-sm">
      <SectionHeader
        icon={<DollarSign className="h-3.5 w-3.5" />}
        title="Cost by CostCategory"
        sub={`MTD · ${fmtK(totalMtd)} total${totalForecast ? ` · ${fmtK(totalForecast)} forecast` : ""}`}
        right={dataSource ? <CostDataSourceBadge dataSource={dataSource} /> : undefined}
        href="/cost"
      />

      {isLoading ? (
        <div className="p-4 space-y-2">
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-5 w-4/5" />
          <Skeleton className="h-5 w-3/5" />
        </div>
      ) : categorySpend.length === 0 ? (
        <div className="p-5 text-center space-y-1">
          <Tag className="h-6 w-6 mx-auto text-muted-foreground/40" />
          <p className="text-[12px] text-muted-foreground">
            No <span className="font-mono">CostCategory</span> tags found on apps yet. Apply tags in
            Azure portal or check the{" "}
            <Link href="/tags" className="text-primary hover:underline">
              Tags page
            </Link>
            .
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-border">
          {/* Bar chart */}
          <div className="p-4">
            <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-3">
              Spend breakdown
            </div>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={categorySpend}
                  layout="vertical"
                  margin={{ left: 0, right: 40, top: 0, bottom: 0 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    horizontal={false}
                    stroke="rgba(255,255,255,0.06)"
                  />
                  <XAxis
                    type="number"
                    tickFormatter={(v) => fmtK(v as number)}
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={10}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={88}
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      borderColor: "hsl(var(--border))",
                      borderRadius: "2px",
                      fontSize: "11px",
                    }}
                    formatter={(v: number) => [fmt(v), "MTD"]}
                  />
                  <Bar dataKey="value" radius={[0, 2, 2, 0]}>
                    {categorySpend.map((entry) => (
                      <Cell
                        key={entry.name}
                        fill={COST_CATEGORY_COLOR[entry.name] ?? "#94a3b8"}
                        fillOpacity={0.85}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Summary list */}
          <div className="p-4">
            <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-3">
              Category summary
            </div>
            <div className="space-y-2">
              {categorySpend.map((entry) => {
                const pct = totalMtd > 0 ? Math.round((entry.value / totalMtd) * 100) : 0;
                const color = COST_CATEGORY_COLOR[entry.name] ?? "#94a3b8";
                return (
                  <div key={entry.name} className="flex items-center gap-3">
                    <span
                      className="inline-flex items-center px-1.5 py-0.5 rounded-sm border text-[11px] font-medium w-28 shrink-0 truncate"
                      style={{ color, borderColor: `${color}40`, backgroundColor: `${color}15` }}
                    >
                      {entry.name}
                    </span>
                    <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{ width: `${pct}%`, backgroundColor: color }}
                      />
                    </div>
                    <span className="text-[11px] tabular-nums text-muted-foreground w-16 text-right">
                      {fmtK(entry.value)}
                    </span>
                    <span className="text-[10px] tabular-nums text-muted-foreground/60 w-8 text-right">
                      {pct}%
                    </span>
                  </div>
                );
              })}
              {untaggedAmt > 0 && (
                <div className="pt-1 mt-1 border-t border-border/50 text-[11px] text-amber-500 flex items-center gap-1.5">
                  <AlertTriangle className="h-3 w-3 shrink-0" />
                  {fmtK(untaggedAmt)} spend ({Math.round((untaggedAmt / totalMtd) * 100)}%) is
                  missing a CostCategory tag
                </div>
              )}
              {untaggedAmt === 0 && totalCategorised > 0 && (
                <div className="pt-1 mt-1 border-t border-border/50 text-[11px] text-green-500 flex items-center gap-1.5">
                  <CheckCircle2 className="h-3 w-3 shrink-0" />
                  100% of spend is categorised
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Refresh indicator */}
      {isFetching && (
        <div className="px-4 py-1 border-t border-border/40 text-[10px] text-muted-foreground">
          Refreshing…
        </div>
      )}
    </div>
  );
}

// ─── Fleet health section ──────────────────────────────────────────────────

function HealthSection() {
  const { data: epData, isLoading: epLoading, isFetching: epFetching } = useListGlobalEndpoints();
  const { data: sloData, isLoading: sloLoading } = useListSlos();

  const eps = useMemo(() => epData?.endpoints ?? [], [epData]);
  const slos = useMemo(() => sloData?.rows ?? [], [sloData]);

  const epUnhealthy = useMemo(
    () => (eps as GlobalEndpointRow[]).filter((e) => e.status === "unhealthy").length,
    [eps],
  );
  const epDegraded = useMemo(
    () => (eps as GlobalEndpointRow[]).filter((e) => e.status === "degraded").length,
    [eps],
  );
  const epHealthy = useMemo(
    () => (eps as GlobalEndpointRow[]).filter((e) => e.status === "healthy").length,
    [eps],
  );
  const avgLatency = useMemo(
    () =>
      eps.length
        ? Math.round(
            (eps as GlobalEndpointRow[]).reduce(
              (s: number, e: GlobalEndpointRow) => s + e.latencyMs,
              0,
            ) / eps.length,
          )
        : 0,
    [eps],
  );

  const sloBreachingErr = useMemo(
    () => (slos as SloRow[]).filter((s) => s.errorRatePct > s.errorTargetPct).length,
    [slos],
  );
  const sloBreachingLat = useMemo(
    () => (slos as SloRow[]).filter((s) => s.p95LatencyMs > s.p95TargetMs).length,
    [slos],
  );
  const sloMeetingUptime = useMemo(
    () => (slos as SloRow[]).filter((s) => s.uptimePct >= 99.9).length,
    [slos],
  );

  const hasNetworkIssues = !epLoading && (epUnhealthy > 0 || epDegraded > 0);
  const hasSloIssues = !sloLoading && (sloBreachingErr > 0 || sloBreachingLat > 0);

  // Worst endpoints to surface
  const worstEps = useMemo(
    () =>
      [...(eps as GlobalEndpointRow[])]
        .filter((e) => e.status === "unhealthy" || e.status === "degraded")
        .sort(
          (a, b) =>
            (STATUS_RANK[a.status] ?? 3) - (STATUS_RANK[b.status] ?? 3) ||
            b.latencyMs - a.latencyMs,
        )
        .slice(0, 4),
    [eps],
  );

  // SLO breaches to surface
  const worstSlos = useMemo(
    () =>
      (slos as SloRow[])
        .filter((s) => s.errorRatePct > s.errorTargetPct || s.p95LatencyMs > s.p95TargetMs)
        .slice(0, 4),
    [slos],
  );

  const epTone = epUnhealthy > 0 ? "bad" : epDegraded > 0 ? "warn" : epHealthy > 0 ? "ok" : "muted";
  const sloTone =
    sloBreachingErr > 0 ? "bad" : sloBreachingLat > 0 ? "warn" : slos.length > 0 ? "ok" : "muted";

  return (
    <div className="bg-card border border-border shadow-sm">
      <SectionHeader
        icon={<HeartPulse className="h-3.5 w-3.5" />}
        title="Fleet health"
        sub="Endpoint probes + SLO status"
        right={
          epData?.dataSource && epData.dataSource !== "none" ? (
            <DataSourceBadge
              dataSource={epData.dataSource}
              dataAsOf={epData.dataAsOf}
              label="Azure"
            />
          ) : undefined
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 p-3">
        <Tile
          title="Endpoints healthy"
          value={epLoading ? null : `${epHealthy} / ${eps.length}`}
          sub="Live endpoint probes"
          tone={epTone}
        />
        <Tile
          title="Avg latency"
          value={epLoading ? null : `${avgLatency}ms`}
          sub="P50 across endpoints"
          tone={avgLatency > 500 ? "warn" : "muted"}
        />
        <Tile
          title="SLO uptime 99.9%"
          value={sloLoading ? null : `${sloMeetingUptime} / ${slos.length}`}
          sub="Meeting uptime target"
          tone={
            sloMeetingUptime === slos.length && slos.length > 0
              ? "ok"
              : slos.length === 0
                ? "muted"
                : "warn"
          }
        />
        <Tile
          title="SLO breaches"
          value={sloLoading ? null : (sloBreachingErr + sloBreachingLat).toString()}
          sub="Error rate or P95 latency"
          tone={sloBreachingErr + sloBreachingLat > 0 ? "bad" : slos.length > 0 ? "ok" : "muted"}
        />
      </div>

      {/* Alert banners */}
      {hasNetworkIssues && (
        <div className="mx-3 mb-3 bg-destructive/10 border border-destructive/30 rounded-sm px-3 py-2 flex items-start gap-2.5">
          <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <span className="text-[12px] font-semibold text-destructive">Network issues — </span>
            <span className="text-[12px] text-destructive/80">
              {epUnhealthy > 0 && `${epUnhealthy} unhealthy`}
              {epUnhealthy > 0 && epDegraded > 0 && ", "}
              {epDegraded > 0 && `${epDegraded} degraded`}
            </span>
            {worstEps.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {worstEps.map((e) => (
                  <span
                    key={e.id}
                    className="text-[10px] px-1.5 py-0.5 rounded-sm bg-destructive/15 border border-destructive/30 text-destructive font-mono"
                  >
                    {e.appName} · {e.name}
                  </span>
                ))}
                <Link
                  href="/network"
                  className="text-[10px] text-primary hover:underline flex items-center gap-0.5"
                >
                  View all <ArrowRight className="h-2.5 w-2.5" />
                </Link>
              </div>
            )}
          </div>
        </div>
      )}

      {hasSloIssues && (
        <div className="mx-3 mb-3 bg-amber-500/10 border border-amber-500/30 rounded-sm px-3 py-2 flex items-start gap-2.5">
          <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <span className="text-[12px] font-semibold text-amber-600 dark:text-amber-400">
              SLO breaches —{" "}
            </span>
            <span className="text-[12px] text-amber-600/80 dark:text-amber-400/80">
              {sloBreachingErr > 0 && `${sloBreachingErr} error rate`}
              {sloBreachingErr > 0 && sloBreachingLat > 0 && ", "}
              {sloBreachingLat > 0 && `${sloBreachingLat} P95 latency`}
            </span>
            {worstSlos.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {worstSlos.map((s) => (
                  <span
                    key={s.appId}
                    className="text-[10px] px-1.5 py-0.5 rounded-sm bg-amber-500/15 border border-amber-500/30 text-amber-600 dark:text-amber-400 font-mono"
                  >
                    {s.appName}
                  </span>
                ))}
                <Link
                  href="/health"
                  className="text-[10px] text-primary hover:underline flex items-center gap-0.5"
                >
                  View all <ArrowRight className="h-2.5 w-2.5" />
                </Link>
              </div>
            )}
          </div>
        </div>
      )}

      {!hasNetworkIssues &&
        !hasSloIssues &&
        !epLoading &&
        !sloLoading &&
        eps.length > 0 &&
        slos.length > 0 && (
          <div className="mx-3 mb-3 bg-green-500/10 border border-green-500/30 rounded-sm px-3 py-2 flex items-center gap-2">
            <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
            <span className="text-[12px] text-green-600 dark:text-green-400 font-medium">
              All endpoints healthy · All SLOs meeting targets
            </span>
          </div>
        )}

      {epFetching && (
        <div className="px-4 py-1 border-t border-border/40 text-[10px] text-muted-foreground">
          Refreshing…
        </div>
      )}
    </div>
  );
}

// ─── Tag compliance section ────────────────────────────────────────────────

function TagComplianceSection() {
  const { data, isLoading } = useGetTagCompliance();
  const { data: apps } = useApps();

  const compliancePct = useMemo(() => {
    if (!data || data.dataSource === "unavailable" || data.dataSource === "error") return null;
    if (data.totalScanned === 0) return 100;
    return Math.round(((data.totalScanned - data.nonCompliantCount) / data.totalScanned) * 100);
  }, [data]);

  const byTag = useMemo(() => {
    if (!data?.entries) return [];
    return COMPLIANCE_REQUIRED_TAGS.map((tag) => ({
      tag,
      missing: data.entries.filter((e: { missingTags: string[] }) => e.missingTags.includes(tag))
        .length,
    }));
  }, [data?.entries]);

  // CostCategory distribution from apps
  const costCategoryRollup = useMemo(() => {
    if (!apps) return [];
    const map = new Map<string, number>();
    for (const app of apps) {
      const cat = (app.tags as Record<string, string> | undefined)?.["CostCategory"];
      if (cat) map.set(cat, (map.get(cat) ?? 0) + 1);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]).map(([cat, count]) => ({ cat, count }));
  }, [apps]);

  const untaggedApps = apps
    ? apps.filter((a) => !(a.tags as Record<string, string> | undefined)?.["CostCategory"]).length
    : 0;

  const pcTone =
    compliancePct === null
      ? "muted"
      : compliancePct === 100
        ? "ok"
        : compliancePct >= 80
          ? "warn"
          : "bad";

  return (
    <div className="bg-card border border-border shadow-sm">
      <SectionHeader
        icon={<Tag className="h-3.5 w-3.5" />}
        title="Tag governance"
        sub="CostCategory · Application · Environment"
        href="/tags"
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 divide-y lg:divide-y-0 lg:divide-x divide-border">
        {/* Compliance score */}
        <div className="p-4">
          <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-3">
            Azure resource compliance
          </div>
          {isLoading ? (
            <Skeleton className="h-12 w-full" />
          ) : data?.dataSource === "unavailable" ? (
            <div className="text-[12px] text-muted-foreground italic">
              Azure not configured — set AZURE_SUBSCRIPTION_IDS to enable scanning.
            </div>
          ) : data?.dataSource === "error" ? (
            <div className="text-[12px] text-destructive">
              {data.errorMessage ?? "Tag scan failed."}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-baseline gap-2">
                <span
                  className={`text-3xl font-bold tabular-nums ${pcTone === "bad" ? "text-destructive" : pcTone === "warn" ? "text-amber-500" : pcTone === "ok" ? "text-green-500" : "text-muted-foreground"}`}
                >
                  {compliancePct}%
                </span>
                <span className="text-[12px] text-muted-foreground">compliant</span>
                <StatusPill tone={pcTone}>
                  {pcTone === "ok"
                    ? "All tagged"
                    : pcTone === "warn"
                      ? "Partial"
                      : pcTone === "bad"
                        ? "Gaps"
                        : "—"}
                </StatusPill>
              </div>
              <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${pcTone === "ok" ? "bg-green-500" : pcTone === "warn" ? "bg-amber-500" : "bg-destructive"}`}
                  style={{ width: `${compliancePct ?? 0}%` }}
                />
              </div>
              <div className="text-[11px] text-muted-foreground">
                {(data?.totalScanned ?? 0) - (data?.nonCompliantCount ?? 0)} of{" "}
                {data?.totalScanned ?? 0} resources fully tagged
              </div>
              {/* Per-tag breakdown */}
              <div className="space-y-1.5 pt-1">
                {byTag.map(({ tag, missing }) => (
                  <div key={tag} className="flex items-center gap-2 text-[11px]">
                    <span className="font-mono text-muted-foreground w-28 shrink-0">{tag}</span>
                    <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${missing === 0 ? "bg-green-500" : missing < 5 ? "bg-amber-500" : "bg-destructive"}`}
                        style={{
                          width: data?.totalScanned
                            ? `${Math.round((missing / data.totalScanned) * 100)}%`
                            : "0%",
                        }}
                      />
                    </div>
                    {missing === 0 ? (
                      <span className="text-green-500 w-8 text-right">✓</span>
                    ) : (
                      <span className="text-destructive w-8 text-right tabular-nums">
                        {missing}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* CostCategory rollup */}
        <div className="p-4">
          <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-3">
            CostCategory coverage (apps)
          </div>
          {!apps ? (
            <div className="space-y-2">
              <Skeleton className="h-5 w-full" />
              <Skeleton className="h-5 w-4/5" />
            </div>
          ) : costCategoryRollup.length === 0 ? (
            <div className="text-[12px] text-muted-foreground italic">
              No <span className="font-mono">CostCategory</span> tags on apps yet.
            </div>
          ) : (
            <div className="space-y-2">
              {costCategoryRollup.map(({ cat, count }) => {
                const pct = apps.length > 0 ? Math.round((count / apps.length) * 100) : 0;
                const color = COST_CATEGORY_COLOR[cat] ?? "#94a3b8";
                return (
                  <div key={cat} className="flex items-center gap-2">
                    <span
                      className="text-[11px] font-medium px-1.5 py-0.5 rounded-sm border w-28 shrink-0 truncate"
                      style={{ color, borderColor: `${color}40`, backgroundColor: `${color}15` }}
                    >
                      {cat}
                    </span>
                    <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{ width: `${pct}%`, backgroundColor: color }}
                      />
                    </div>
                    <span className="text-[11px] tabular-nums text-muted-foreground w-12 text-right">
                      {count} app{count !== 1 ? "s" : ""}
                    </span>
                  </div>
                );
              })}
              {untaggedApps > 0 && (
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-muted-foreground/60 italic px-1.5 py-0.5 border border-dashed border-border rounded-sm w-28 shrink-0">
                    untagged
                  </span>
                  <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full bg-destructive/40 transition-all"
                      style={{ width: `${Math.round((untaggedApps / apps.length) * 100)}%` }}
                    />
                  </div>
                  <span className="text-[11px] tabular-nums text-destructive w-12 text-right">
                    {untaggedApps} app{untaggedApps !== 1 ? "s" : ""}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Quick actions */}
        <div className="p-4">
          <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-3">
            Quick links
          </div>
          <div className="space-y-1.5">
            {[
              {
                href: "/tags",
                label: "Tag inventory & compliance",
                icon: <Tag className="h-3.5 w-3.5" />,
              },
              {
                href: "/network",
                label: "Network health",
                icon: <Network className="h-3.5 w-3.5" />,
              },
              {
                href: "/health",
                label: "SLOs & error budgets",
                icon: <HeartPulse className="h-3.5 w-3.5" />,
              },
              {
                href: "/cost",
                label: "Cost Management",
                icon: <DollarSign className="h-3.5 w-3.5" />,
              },
            ].map(({ href, label, icon }) => (
              <Link
                key={href}
                href={href}
                className="flex items-center gap-2 px-2 py-1.5 rounded-sm hover:bg-muted/60 transition-colors text-[12px] text-foreground group"
              >
                <span className="text-muted-foreground group-hover:text-primary transition-colors">
                  {icon}
                </span>
                {label}
                <ChevronRight className="h-3 w-3 ml-auto text-muted-foreground/50 group-hover:text-primary transition-colors" />
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────────

function LivePulseDot() {
  return (
    <span className="inline-flex h-2 w-2 relative shrink-0">
      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-60" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
    </span>
  );
}

export default function Overview() {
  const { hasGroup } = useAuth();
  const canSeeCost = hasGroup(COST_READER_GROUP.id);
  const { data: apps, isFetching: appsFetching } = useApps();

  const now = new Date();
  const timeStr = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const dateStr = now.toLocaleDateString([], {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  return (
    <div className="space-y-4">
      <RefreshingBar isFetching={appsFetching} isLoading={false} />

      {/* Page header */}
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold text-foreground tracking-tight">Live Overview</h1>
            <LivePulseDot />
          </div>
          <p className="text-[12px] text-muted-foreground mt-0.5">
            {dateStr} · {timeStr} · {apps ? `${apps.length} applications` : "Loading…"}
          </p>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-sm border border-border bg-muted/40">
            <TrendingUp className="h-3 w-3 text-primary" />
            Cost · Health · Governance
          </span>
        </div>
      </div>

      {/* 1. Cost by CostCategory */}
      <CostSection canSeeCost={canSeeCost} />

      {/* 2. Fleet health */}
      <HealthSection />

      {/* 3. Tag governance */}
      <TagComplianceSection />
    </div>
  );
}
