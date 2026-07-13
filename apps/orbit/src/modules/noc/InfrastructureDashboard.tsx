import { useState } from "react";
import {
  Server,
  Database,
  Network,
  Activity,
  RefreshCw,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  HelpCircle,
  Zap,
  HardDrive,
  Cpu,
} from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import {
  useInfrastructureMetrics,
  useInfrastructureHistory,
  type HealthStatus,
  type ResourceGroup,
  type MetricSeries,
} from "../../services/noc";

// ── Constants ─────────────────────────────────────────────────────────────────

const HC: Record<HealthStatus, string> = {
  healthy: "#22c55e",
  warning: "#f59e0b",
  critical: "#ef4444",
  unknown: "#6b7280",
};
const HBG: Record<HealthStatus, string> = {
  healthy: "rgba(34,197,94,0.08)",
  warning: "rgba(245,158,11,0.08)",
  critical: "rgba(239,68,68,0.08)",
  unknown: "rgba(107,114,128,0.08)",
};
const HBORDER: Record<HealthStatus, string> = {
  healthy: "rgba(34,197,94,0.25)",
  warning: "rgba(245,158,11,0.25)",
  critical: "rgba(239,68,68,0.25)",
  unknown: "rgba(107,114,128,0.25)",
};

type Domain = "all" | "compute" | "database" | "network" | "vnet" | "lb" | "api";

const DOMAIN_TABS: { id: Domain; label: string; icon: React.ElementType }[] = [
  { id: "all",      label: "All",              icon: Activity },
  { id: "compute",  label: "Compute",          icon: Server },
  { id: "database", label: "Database",         icon: Database },
  { id: "network",  label: "Network & Storage", icon: HardDrive },
  { id: "vnet",     label: "Virtual Networks", icon: Network },
  { id: "lb",       label: "Load Balancers",   icon: Zap },
  { id: "api",      label: "API",              icon: Cpu },
];

// ── Pure helpers ──────────────────────────────────────────────────────────────

function healthIcon(status: HealthStatus, cls = "h-4 w-4") {
  const c = HC[status];
  if (status === "healthy")  return <CheckCircle2  className={cls} style={{ color: c }} />;
  if (status === "warning")  return <AlertTriangle className={cls} style={{ color: c }} />;
  if (status === "critical") return <XCircle       className={cls} style={{ color: c }} />;
  return                            <HelpCircle    className={cls} style={{ color: c }} />;
}

function worstHealth(groups: ResourceGroup[]): HealthStatus {
  const order: HealthStatus[] = ["critical", "warning", "unknown", "healthy"];
  return groups.reduce<HealthStatus>((w, g) => (order.indexOf(g.health) < order.indexOf(w) ? g.health : w), "healthy");
}

function fmtValue(value: number | null, unit: string): string {
  if (value === null) return "—";
  if (unit === "bytes") {
    if (value > 1_073_741_824) return `${(value / 1_073_741_824).toFixed(1)} GB`;
    if (value > 1_048_576)     return `${(value / 1_048_576).toFixed(1)} MB`;
    if (value > 1_024)         return `${(value / 1_024).toFixed(1)} KB`;
    return `${value} B`;
  }
  if (unit === "%")     return `${value.toFixed(1)}%`;
  if (unit === "ms")    return `${Math.round(value)} ms`;
  if (unit === "count") return value.toLocaleString();
  if (unit === "state") return value === 1 ? "Succeeded" : "Failed";
  return `${value} ${unit}`;
}

function fmtLabel(metricName: string): string {
  return metricName
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/\//g, " / ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

function metricColor(metricName: string, value: number | null): string {
  if (value === null) return "var(--orbit-text-muted)";
  const n = metricName.toLowerCase();
  if (n.includes("cpu") || n.includes("memory") || n.includes("storage_percent"))
    return value > 90 ? "#ef4444" : value > 75 ? "#f59e0b" : "#22c55e";
  if (n.includes("availability"))
    return value < 95 ? "#ef4444" : value < 99 ? "#f59e0b" : "#22c55e";
  if (n.includes("failed") || n.includes("deadlock") || n.includes("restart"))
    return value > 5 ? "#ef4444" : value > 0 ? "#f59e0b" : "#22c55e";
  if (n.includes("duration") || n.includes("latency"))
    return value > 5000 ? "#ef4444" : value > 1000 ? "#f59e0b" : "#22c55e";
  if (n.includes("provisioningstate"))
    return value === 1 ? "#22c55e" : "#ef4444";
  return "var(--orbit-text-secondary)";
}

// ── Sparkline ─────────────────────────────────────────────────────────────────

function SparkChart({ series, color }: { series: MetricSeries; color: string }) {
  const data = series.points.map((p) => ({
    t: new Date(p.t).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }),
    v: p.v,
  }));
  if (data.length < 2) {
    return (
      <div
        className="h-14 flex items-center justify-center text-xs"
        style={{ color: "var(--orbit-text-muted)" }}
      >
        Collecting history…
      </div>
    );
  }
  const gradId = `grad-${series.metricName.replace(/[^a-zA-Z0-9]/g, "")}`;
  return (
    <ResponsiveContainer width="100%" height={56}>
      <AreaChart data={data} margin={{ top: 2, right: 2, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor={color} stopOpacity={0.3} />
            <stop offset="95%" stopColor={color} stopOpacity={0}   />
          </linearGradient>
        </defs>
        <XAxis dataKey="t" hide />
        <YAxis hide domain={["auto", "auto"]} />
        <Tooltip
          contentStyle={{
            background: "var(--orbit-bg-card)",
            border: "1px solid var(--orbit-border)",
            borderRadius: 8,
            fontSize: 11,
            color: "var(--orbit-text-secondary)",
          }}
          formatter={(val: number) => [fmtValue(val, series.unit), fmtLabel(series.metricName)]}
          labelStyle={{ color: "var(--orbit-text-muted)" }}
        />
        <Area
          type="monotone"
          dataKey="v"
          stroke={color}
          strokeWidth={1.5}
          fill={`url(#${gradId})`}
          dot={false}
          connectNulls
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ── Resource card ─────────────────────────────────────────────────────────────

function ResourceCard({
  group,
  icon: Icon,
  seriesList,
  primaryMetric,
}: {
  group: ResourceGroup;
  icon: React.ElementType;
  seriesList: MetricSeries[];
  primaryMetric: string;
}) {
  const primarySeries = seriesList.find(
    (s) => s.resourceName === group.name && s.metricName.toLowerCase().includes(primaryMetric),
  );
  const color = HC[group.health];

  return (
    <div
      className="rounded-2xl overflow-hidden flex"
      style={{ background: "var(--orbit-bg-card)", border: `1px solid ${HBORDER[group.health]}` }}
    >
      {/* Left status rail */}
      <div
        className="w-1 shrink-0 rounded-l-2xl"
        style={{ background: color }}
      />

      <div className="flex-1 min-w-0">
        {/* Card header */}
        <div
          className="flex items-center gap-3 px-4 py-3"
          style={{ borderBottom: "1px solid var(--orbit-border)", background: HBG[group.health] }}
        >
          <div
            className="rounded-lg p-2 shrink-0"
            style={{ background: `${color}18` }}
          >
            <Icon className="h-4 w-4" style={{ color }} />
          </div>
          <div className="flex-1 min-w-0">
            <p
              className="text-sm font-semibold truncate"
              style={{ color: "var(--orbit-text-primary)" }}
            >
              {group.name}
            </p>
            <p className="text-xs" style={{ color: "var(--orbit-text-muted)" }}>
              {group.resourceType}
            </p>
          </div>
          <div
            className="flex items-center gap-1.5 rounded-full px-3 py-1 shrink-0"
            style={{ background: HBG[group.health], border: `1px solid ${HBORDER[group.health]}` }}
          >
            {healthIcon(group.health, "h-3.5 w-3.5")}
            <span
              className="text-xs font-semibold capitalize"
              style={{ color }}
            >
              {group.health}
            </span>
          </div>
        </div>

        {/* Sparkline */}
        {primarySeries && (
          <div className="px-4 pt-3 pb-1">
            <p className="text-[11px] font-medium mb-1.5" style={{ color: "var(--orbit-text-muted)" }}>
              {fmtLabel(primarySeries.metricName)}
              {" · "}
              <span style={{ color }}>
                {fmtValue(
                  primarySeries.points.length > 0
                    ? primarySeries.points[primarySeries.points.length - 1].v
                    : null,
                  primarySeries.unit,
                )}
              </span>
              {" now"}
            </p>
            <SparkChart series={primarySeries} color={color} />
          </div>
        )}

        {/* Metric chip grid */}
        <div className="grid grid-cols-2 gap-1.5 p-3">
          {group.metrics.map((m) => (
            <div
              key={`${m.resourceId}-${m.metricName}`}
              className="rounded-lg px-3 py-2"
              style={{ background: "var(--orbit-bg-page)", border: "1px solid var(--orbit-border)" }}
            >
              <p
                className="text-[10px] font-medium truncate"
                style={{ color: "var(--orbit-text-muted)" }}
              >
                {fmtLabel(m.metricName)}
              </p>
              <p
                className="text-sm font-bold tabular-nums mt-0.5"
                style={{ color: metricColor(m.metricName, m.value) }}
              >
                {fmtValue(m.value, m.unit)}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Stat tile (summary bar) ───────────────────────────────────────────────────

function StatTile({
  label,
  count,
  health,
  icon: Icon,
  active,
  onClick,
}: {
  label: string;
  count: number;
  health: HealthStatus;
  icon: React.ElementType;
  active: boolean;
  onClick: () => void;
}) {
  const color = HC[health];
  return (
    <button
      onClick={onClick}
      className="rounded-2xl px-4 py-3 flex items-center gap-3 text-left transition-opacity hover:opacity-80 w-full"
      style={{
        background: active ? HBG[health] : "var(--orbit-bg-card)",
        border: `1px solid ${active ? HBORDER[health] : "var(--orbit-border)"}`,
      }}
    >
      <div className="rounded-lg p-2 shrink-0" style={{ background: `${color}18` }}>
        <Icon className="h-4 w-4" style={{ color }} />
      </div>
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--orbit-text-muted)" }}>
          {label}
        </p>
        <div className="flex items-center gap-1.5 mt-0.5">
          <span className="text-xl font-bold tabular-nums" style={{ color }}>{count}</span>
          {healthIcon(health, "h-3.5 w-3.5")}
        </div>
      </div>
    </button>
  );
}

// ── Domain filter tabs ────────────────────────────────────────────────────────

function DomainTab({
  tab,
  active,
  onClick,
}: {
  tab: (typeof DOMAIN_TABS)[number];
  active: boolean;
  onClick: () => void;
}) {
  const Icon = tab.icon;
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors"
      style={{
        background: active ? "var(--orbit-accent, #4361F1)" : "transparent",
        color: active ? "#fff" : "var(--orbit-text-muted)",
        border: active ? "none" : "1px solid transparent",
      }}
    >
      <Icon className="h-3.5 w-3.5" />
      {tab.label}
    </button>
  );
}

// ── Main Dashboard ────────────────────────────────────────────────────────────

export function InfrastructureDashboard() {
  const { data, isLoading, error, refetch, isFetching, dataUpdatedAt } = useInfrastructureMetrics();
  const { data: history } = useInfrastructureHistory(6);
  const [busting, setBusting]     = useState(false);
  const [bustMsg, setBustMsg]     = useState<string | null>(null);
  const [domain, setDomain]       = useState<Domain>("all");

  async function bustCache() {
    setBusting(true);
    setBustMsg(null);
    try {
      const res = await fetch("/api/noc/infrastructure/cache-bust", { method: "POST" });
      if (res.ok) {
        setBustMsg("Cache cleared — refreshing…");
        await refetch();
      } else {
        setBustMsg("Failed to clear cache");
      }
    } catch {
      setBustMsg("Error clearing cache");
    } finally {
      setBusting(false);
      setTimeout(() => setBustMsg(null), 4000);
    }
  }

  const seriesList = history?.series ?? [];

  const lastUpdated = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    : null;

  // ── section definitions (used by stat bar + filtered grid) ───────────────
  const sections = data
    ? [
        { id: "compute"  as Domain, label: "Compute",           icon: Server,    groups: data.containerApps, primary: "cpu"          },
        { id: "database" as Domain, label: "Database",          icon: Database,  groups: data.database,      primary: "availability" },
        { id: "network"  as Domain, label: "Network & Storage", icon: HardDrive, groups: data.network,       primary: "egress"       },
        { id: "vnet"     as Domain, label: "Virtual Networks",  icon: Network,   groups: data.vpn,           primary: "provisioning" },
        { id: "lb"       as Domain, label: "Load Balancers",    icon: Zap,       groups: data.loadBalancers, primary: "bytecount"   },
        { id: "api"      as Domain, label: "API",               icon: Cpu,       groups: data.api,           primary: "duration"     },
      ].filter((s) => s.groups.length > 0)
    : [];

  const visibleSections = domain === "all" ? sections : sections.filter((s) => s.id === domain);

  return (
    <div className="space-y-4">

      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "var(--orbit-text-primary)" }}>
            Infrastructure Health
          </h1>
          <p className="text-xs mt-0.5" style={{ color: "var(--orbit-text-muted)" }}>
            Azure Monitor · real-time telemetry · auto-refreshes every 60s
            {lastUpdated && <span className="ml-2">· {lastUpdated}</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {bustMsg && (
            <span className="text-xs" style={{ color: "var(--orbit-text-muted)" }}>
              {bustMsg}
            </span>
          )}
          <button
            onClick={() => void bustCache()}
            disabled={busting || isFetching}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-50 transition-opacity hover:opacity-80"
            style={{
              background: "var(--orbit-bg-card)",
              border: "1px solid var(--orbit-border)",
              color: "var(--orbit-text-secondary)",
            }}
          >
            {busting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            Bust Cache
          </button>
          <button
            onClick={() => void refetch()}
            disabled={isFetching}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-50 transition-opacity hover:opacity-80"
            style={{
              background: "var(--orbit-bg-card)",
              border: "1px solid var(--orbit-border)",
              color: "var(--orbit-text-secondary)",
            }}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-24 gap-3" style={{ color: "var(--orbit-text-muted)" }}>
          <Loader2 className="h-8 w-8 animate-spin" />
          <span className="text-sm">Fetching Azure Monitor metrics…</span>
        </div>
      ) : error ? (
        <div
          className="rounded-2xl p-5 flex items-start gap-3"
          style={{ color: "#ef4444", border: "1px solid #ef444433", background: "rgba(239,68,68,0.05)" }}
        >
          <XCircle className="h-5 w-5 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold">Failed to load metrics</p>
            <p className="text-xs mt-1 opacity-80">{error.message}</p>
          </div>
        </div>
      ) : data ? (
        <div className="space-y-4">

          {/* ── Overall status pill ── */}
          <div
            className="flex items-center gap-3 rounded-2xl px-5 py-3"
            style={{ background: HBG[data.overallHealth], border: `1px solid ${HBORDER[data.overallHealth]}` }}
          >
            {healthIcon(data.overallHealth, "h-5 w-5")}
            <div>
              <p className="text-sm font-semibold" style={{ color: HC[data.overallHealth] }}>
                {data.overallHealth === "healthy"  ? "All Systems Operational"      :
                 data.overallHealth === "warning"  ? "Degraded Performance Detected":
                 data.overallHealth === "critical" ? "Critical Issues Detected"     : "Awaiting Data"}
              </p>
              <p className="text-xs" style={{ color: "var(--orbit-text-muted)" }}>
                {"Last snapshot: "}
                {new Date(data.capturedAt).toLocaleTimeString(undefined, {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                })}
              </p>
            </div>
          </div>

          {/* ── Summary stat bar ── */}
          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-2">
            {sections.map((s) => (
              <StatTile
                key={s.id}
                label={s.label}
                count={s.groups.length}
                health={worstHealth(s.groups)}
                icon={s.icon}
                active={domain === s.id}
                onClick={() => setDomain(domain === s.id ? "all" : s.id)}
              />
            ))}
          </div>

          {/* ── Domain filter pill tabs ── */}
          <div
            className="flex items-center gap-1 rounded-xl p-1 overflow-x-auto"
            style={{ background: "var(--orbit-bg-card)", border: "1px solid var(--orbit-border)" }}
          >
            {DOMAIN_TABS.filter(
              (t) => t.id === "all" || sections.some((s) => s.id === t.id),
            ).map((t) => (
              <DomainTab
                key={t.id}
                tab={t}
                active={domain === t.id}
                onClick={() => setDomain(t.id)}
              />
            ))}
          </div>

          {/* ── Resource card grid ── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {visibleSections.map((s) =>
              s.groups.map((g) => (
                <ResourceCard
                  key={`${s.id}-${g.name}`}
                  group={g}
                  icon={s.icon}
                  seriesList={seriesList}
                  primaryMetric={s.primary}
                />
              )),
            )}
          </div>

          {/* ── Empty state ── */}
          {sections.length === 0 && (
            <div
              className="rounded-2xl p-8 text-center"
              style={{ background: "var(--orbit-bg-card)", border: "1px solid var(--orbit-border)" }}
            >
              <HelpCircle className="h-8 w-8 mx-auto mb-3" style={{ color: "var(--orbit-text-muted)" }} />
              <p className="text-sm font-medium" style={{ color: "var(--orbit-text-primary)" }}>
                No metrics available
              </p>
              <p className="text-xs mt-1" style={{ color: "var(--orbit-text-muted)" }}>
                Ensure{" "}
                <code className="font-mono">AZURE_SUBSCRIPTION_ID</code>
                {" "}(or{" "}
                <code className="font-mono">AZURE_SUBSCRIPTION_IDS</code>
                {") "}
                is set and Managed Identity has Monitoring Reader role.
              </p>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
