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

// ── Helpers ───────────────────────────────────────────────────────────────────

const HEALTH_COLOR: Record<HealthStatus, string> = {
  healthy: "#22c55e",
  warning: "#f59e0b",
  critical: "#ef4444",
  unknown: "#6b7280",
};

const HEALTH_BG: Record<HealthStatus, string> = {
  healthy: "rgba(34,197,94,0.08)",
  warning: "rgba(245,158,11,0.08)",
  critical: "rgba(239,68,68,0.08)",
  unknown: "rgba(107,114,128,0.08)",
};

const HEALTH_BORDER: Record<HealthStatus, string> = {
  healthy: "rgba(34,197,94,0.25)",
  warning: "rgba(245,158,11,0.25)",
  critical: "rgba(239,68,68,0.25)",
  unknown: "rgba(107,114,128,0.25)",
};

function HealthIcon({ status, size = "h-5 w-5" }: { status: HealthStatus; size?: string }) {
  const color = HEALTH_COLOR[status];
  if (status === "healthy") return <CheckCircle2 className={size} style={{ color }} />;
  if (status === "warning") return <AlertTriangle className={size} style={{ color }} />;
  if (status === "critical") return <XCircle className={size} style={{ color }} />;
  return <HelpCircle className={size} style={{ color }} />;
}

function fmtValue(value: number | null, unit: string): string {
  if (value === null) return "—";
  if (unit === "bytes") {
    if (value > 1_073_741_824) return `${(value / 1_073_741_824).toFixed(1)} GB`;
    if (value > 1_048_576) return `${(value / 1_048_576).toFixed(1)} MB`;
    if (value > 1_024) return `${(value / 1_024).toFixed(1)} KB`;
    return `${value} B`;
  }
  if (unit === "%") return `${value.toFixed(1)}%`;
  if (unit === "ms") return `${Math.round(value)} ms`;
  if (unit === "count") return value.toLocaleString();
  return `${value} ${unit}`;
}

function fmtMetricLabel(metricName: string): string {
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
  if (n.includes("cpu") || n.includes("memory") || n.includes("storage_percent")) {
    return value > 90 ? "#ef4444" : value > 75 ? "#f59e0b" : "#22c55e";
  }
  if (n.includes("availability")) {
    return value < 95 ? "#ef4444" : value < 99 ? "#f59e0b" : "#22c55e";
  }
  if (n.includes("failed") || n.includes("deadlock") || n.includes("restart")) {
    return value > 5 ? "#ef4444" : value > 0 ? "#f59e0b" : "#22c55e";
  }
  if (n.includes("duration") || n.includes("latency")) {
    return value > 5000 ? "#ef4444" : value > 1000 ? "#f59e0b" : "#22c55e";
  }
  return "var(--orbit-text-secondary)";
}

// ── Sparkline chart ───────────────────────────────────────────────────────────

function SparkChart({ series, color }: { series: MetricSeries; color: string }) {
  const data = series.points.map((p) => ({
    t: new Date(p.t).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }),
    v: p.v,
  }));
  if (data.length < 2) {
    return <div className="h-16 flex items-center justify-center text-xs" style={{ color: "var(--orbit-text-muted)" }}>Collecting history…</div>;
  }
  return (
    <ResponsiveContainer width="100%" height={64}>
      <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id={`grad-${series.metricName}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={color} stopOpacity={0.25} />
            <stop offset="95%" stopColor={color} stopOpacity={0} />
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
          formatter={(val: number) => [fmtValue(val, series.unit), fmtMetricLabel(series.metricName)]}
          labelStyle={{ color: "var(--orbit-text-muted)" }}
        />
        <Area
          type="monotone"
          dataKey="v"
          stroke={color}
          strokeWidth={1.5}
          fill={`url(#grad-${series.metricName})`}
          dot={false}
          connectNulls
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ── Resource group card ───────────────────────────────────────────────────────

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
  const primarySeries = seriesList.find((s) => s.resourceName === group.name && s.metricName.toLowerCase().includes(primaryMetric));
  const chartColor = HEALTH_COLOR[group.health];

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{
        background: "var(--orbit-bg-card)",
        border: `1px solid ${HEALTH_BORDER[group.health]}`,
      }}
    >
      {/* Header */}
      <div
        className="flex items-center gap-3 px-4 py-3"
        style={{
          borderBottom: "1px solid var(--orbit-border)",
          background: HEALTH_BG[group.health],
        }}
      >
        <div className="rounded-lg p-2" style={{ background: "var(--orbit-bg-page)" }}>
          <Icon className="h-4 w-4" style={{ color: "var(--orbit-text-muted)" }} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate" style={{ color: "var(--orbit-text-primary)" }}>{group.name}</p>
          <p className="text-xs" style={{ color: "var(--orbit-text-muted)" }}>{group.resourceType}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium capitalize" style={{ color: HEALTH_COLOR[group.health] }}>
            {group.health}
          </span>
          <HealthIcon status={group.health} size="h-4 w-4" />
        </div>
      </div>

      {/* Sparkline */}
      {primarySeries && (
        <div className="px-4 pt-3 pb-1">
          <p className="text-xs mb-1" style={{ color: "var(--orbit-text-muted)" }}>
            {fmtMetricLabel(primarySeries.metricName)} · last {primarySeries.points.length > 0 ? "6h" : "—"}
          </p>
          <SparkChart series={primarySeries} color={chartColor} />
        </div>
      )}

      {/* Metrics table */}
      <div className="mt-1">
        {group.metrics.map((m) => (
          <div
            key={`${m.resourceId}-${m.metricName}`}
            className="flex items-center justify-between px-4 py-2"
            style={{ borderTop: "1px solid var(--orbit-border)" }}
          >
            <span className="text-xs" style={{ color: "var(--orbit-text-muted)" }}>
              {fmtMetricLabel(m.metricName)}
            </span>
            <span
              className="text-xs font-semibold tabular-nums"
              style={{ color: metricColor(m.metricName, m.value) }}
            >
              {fmtValue(m.value, m.unit)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── System health banner ──────────────────────────────────────────────────────

function HealthBanner({ status, capturedAt }: { status: HealthStatus; capturedAt: string }) {
  const labels: Record<HealthStatus, string> = {
    healthy: "All Systems Operational",
    warning: "Degraded Performance Detected",
    critical: "Critical Issues Detected",
    unknown: "Awaiting Data",
  };
  const time = new Date(capturedAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  return (
    <div
      className="rounded-xl px-5 py-4 flex items-center gap-4"
      style={{
        background: HEALTH_BG[status],
        border: `1px solid ${HEALTH_BORDER[status]}`,
      }}
    >
      <HealthIcon status={status} size="h-6 w-6" />
      <div>
        <p className="font-semibold text-base" style={{ color: HEALTH_COLOR[status] }}>{labels[status]}</p>
        <p className="text-xs mt-0.5" style={{ color: "var(--orbit-text-muted)" }}>Last snapshot: {time}</p>
      </div>
    </div>
  );
}

// ── Section heading ───────────────────────────────────────────────────────────

function SectionHeading({ label, count, health }: { label: string; count: number; health: HealthStatus }) {
  return (
    <div className="flex items-center gap-2 mt-1">
      <h2 className="text-sm font-semibold uppercase tracking-wider" style={{ color: "var(--orbit-text-muted)" }}>{label}</h2>
      <span className="text-xs rounded-full px-2 py-0.5 font-medium" style={{ background: HEALTH_BG[health], color: HEALTH_COLOR[health] }}>
        {count}
      </span>
    </div>
  );
}

// ── Main Dashboard ────────────────────────────────────────────────────────────

export function InfrastructureDashboard() {
  const { data, isLoading, error, refetch, isFetching, dataUpdatedAt } = useInfrastructureMetrics();
  const { data: history } = useInfrastructureHistory(6);
  const [busting, setBusting] = useState(false);
  const [bustMsg, setBustMsg] = useState<string | null>(null);

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
    ? new Date(dataUpdatedAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : null;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "var(--orbit-text-primary)" }}>
            Infrastructure Health
          </h1>
          <p className="text-sm mt-1" style={{ color: "var(--orbit-text-muted)" }}>
            Real-time Azure Monitor metrics — refreshes every 60s
            {lastUpdated && <span className="ml-2">· {lastUpdated}</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {bustMsg && (
            <span className="text-xs" style={{ color: "var(--orbit-text-muted)" }}>{bustMsg}</span>
          )}
          <button
            onClick={() => void bustCache()}
            disabled={busting || isFetching}
            className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
            style={{ background: "var(--orbit-bg-card)", border: "1px solid var(--orbit-border)", color: "var(--orbit-text-secondary)" }}
          >
            {busting ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Bust Cache
          </button>
          <button
            onClick={() => void refetch()}
            disabled={isFetching}
            className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
            style={{ background: "var(--orbit-bg-card)", border: "1px solid var(--orbit-border)", color: "var(--orbit-text-secondary)" }}
          >
            <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 py-16" style={{ color: "var(--orbit-text-muted)" }}>
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="text-sm">Fetching Azure Monitor metrics…</span>
        </div>
      ) : error ? (
        <div className="rounded-xl p-4 text-sm" style={{ color: "#ef4444", border: "1px solid #ef444433", background: "var(--orbit-bg-card)" }}>
          {error.message}
        </div>
      ) : data ? (
        <div className="space-y-4">
          {/* Overall health banner */}
          <HealthBanner status={data.overallHealth} capturedAt={data.capturedAt} />

          {/* 2×2 grid — all four sections side by side */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Compute */}
            {data.containerApps.length > 0 && (
              <div className="space-y-2">
                <SectionHeading label="Compute" count={data.containerApps.length} health={data.containerApps[0]?.health ?? "unknown"} />
                <div className="space-y-3">
                  {data.containerApps.map((g) => (
                    <ResourceCard key={g.name} group={g} icon={Server} seriesList={seriesList} primaryMetric="cpu" />
                  ))}
                </div>
              </div>
            )}

            {/* Database */}
            {data.database.length > 0 && (
              <div className="space-y-2">
                <SectionHeading label="Database" count={data.database.length} health={data.database[0]?.health ?? "unknown"} />
                <div className="space-y-3">
                  {data.database.map((g) => (
                    <ResourceCard key={g.name} group={g} icon={Database} seriesList={seriesList} primaryMetric="availability" />
                  ))}
                </div>
              </div>
            )}

            {/* Network / Storage */}
            {data.network.length > 0 && (
              <div className="space-y-2">
                <SectionHeading label="Network & Storage" count={data.network.length} health={data.network[0]?.health ?? "unknown"} />
                <div className="space-y-3">
                  {data.network.map((g) => (
                    <ResourceCard key={g.name} group={g} icon={Network} seriesList={seriesList} primaryMetric="egress" />
                  ))}
                </div>
              </div>
            )}

            {/* API & Observability */}
            {data.api.length > 0 && (
              <div className="space-y-2">
                <SectionHeading label="API & Observability" count={data.api.length} health={data.api[0]?.health ?? "unknown"} />
                <div className="space-y-3">
                  {data.api.map((g) => (
                    <ResourceCard key={g.name} group={g} icon={Activity} seriesList={seriesList} primaryMetric="duration" />
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Empty state */}
          {data.containerApps.length === 0 && data.database.length === 0 && data.api.length === 0 && (
            <div className="rounded-xl p-6 text-center text-sm" style={{ background: "var(--orbit-bg-card)", border: "1px solid var(--orbit-border)", color: "var(--orbit-text-muted)" }}>
              No metrics available — ensure <code className="font-mono text-xs">AZURE_SUBSCRIPTION_ID</code> (or <code className="font-mono text-xs">AZURE_SUBSCRIPTION_IDS</code>) is set and Managed Identity has Monitoring Reader role.
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
