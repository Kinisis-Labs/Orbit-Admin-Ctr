import {
  Server,
  Database,
  HardDrive,
  Activity,
  RefreshCw,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Info,
} from "lucide-react";
import { useInfrastructureMetrics, type MetricResult } from "../../services/noc";

// ── Helpers ───────────────────────────────────────────────────────────────────

const card: React.CSSProperties = {
  background: "var(--orbit-bg-card)",
  border: "1px solid var(--orbit-border)",
};

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

function statusColor(metricName: string, value: number | null): string {
  if (value === null) return "var(--orbit-text-muted)";
  const pct = metricName.toLowerCase().includes("percent") || metricName.includes("%");
  if (pct) {
    if (metricName.toLowerCase().includes("availability")) {
      return value >= 99 ? "#22c55e" : value >= 95 ? "#f59e0b" : "#ef4444";
    }
    return value > 85 ? "#ef4444" : value > 70 ? "#f59e0b" : "#22c55e";
  }
  return "var(--orbit-text-secondary)";
}

function MetricRow({ metric }: { metric: MetricResult }) {
  const color = statusColor(metric.metricName, metric.value);
  const label = metric.metricName
    .replace(/_/g, " ")
    .replace(/([A-Z])/g, " $1")
    .replace(/\//g, " / ")
    .trim();
  return (
    <div
      className="flex items-center justify-between px-4 py-3"
      style={{ borderBottom: "1px solid var(--orbit-border)" }}
    >
      <span className="text-sm" style={{ color: "var(--orbit-text-secondary)" }}>
        {label}
      </span>
      <span className="text-sm font-semibold tabular-nums" style={{ color }}>
        {fmtValue(metric.value, metric.unit)}
      </span>
    </div>
  );
}

function ResourceCard({
  title,
  subtitle,
  icon: Icon,
  metrics,
}: {
  title: string;
  subtitle: string;
  icon: React.ElementType;
  metrics: MetricResult[];
}) {
  const hasData = metrics.some((m) => m.value !== null);
  return (
    <div className="rounded-xl overflow-hidden" style={card}>
      <div className="flex items-center gap-3 px-4 py-4" style={{ borderBottom: "1px solid var(--orbit-border)" }}>
        <div className="rounded-lg p-2" style={{ background: "var(--orbit-bg-page)" }}>
          <Icon className="h-4 w-4" style={{ color: "var(--orbit-text-muted)" }} />
        </div>
        <div>
          <p className="text-sm font-semibold" style={{ color: "var(--orbit-text-primary)" }}>{title}</p>
          <p className="text-xs" style={{ color: "var(--orbit-text-muted)" }}>{subtitle}</p>
        </div>
        <div className="ml-auto">
          {hasData ? (
            <CheckCircle2 className="h-4 w-4" style={{ color: "#22c55e" }} />
          ) : (
            <AlertTriangle className="h-4 w-4" style={{ color: "var(--orbit-text-muted)" }} />
          )}
        </div>
      </div>
      <div>
        {metrics.length === 0 ? (
          <p className="px-4 py-4 text-sm" style={{ color: "var(--orbit-text-muted)" }}>No metrics available</p>
        ) : (
          metrics.map((m) => <MetricRow key={`${m.resourceId}-${m.metricName}`} metric={m} />)
        )}
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function InfrastructureDashboard() {
  const { data, isLoading, error, refetch, isFetching, dataUpdatedAt } = useInfrastructureMetrics();

  const lastUpdated = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : null;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "var(--orbit-text-primary)" }}>
            Infrastructure NOC
          </h1>
          <p className="text-sm mt-1" style={{ color: "var(--orbit-text-muted)" }}>
            Azure Monitor metrics — auto-refreshes every 60 seconds
            {lastUpdated && (
              <span className="ml-2">· Last updated {lastUpdated}</span>
            )}
          </p>
        </div>
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

      {isLoading ? (
        <div className="flex items-center gap-2 py-16" style={{ color: "var(--orbit-text-muted)" }}>
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="text-sm">Fetching Azure Monitor metrics…</span>
        </div>
      ) : error ? (
        <div
          className="rounded-xl p-4 text-sm"
          style={{ color: "#ef4444", border: "1px solid #ef444433", background: "var(--orbit-bg-card)" }}
        >
          {error.message}
        </div>
      ) : data ? (
        <>
          {!data.azureConfigured && (
            <div
              className="flex items-start gap-3 rounded-xl px-4 py-3 text-sm"
              style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.3)", color: "#f59e0b" }}
            >
              <Info className="h-4 w-4 mt-0.5 shrink-0" />
              <span>
                Azure Monitor is not configured — set <code className="font-mono text-xs">AZURE_SUBSCRIPTION_ID</code> and
                Managed Identity (or client credentials) to enable live metrics. Showing empty state.
              </span>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <ResourceCard
              title="Container Apps"
              subtitle="ca-orbit-prod"
              icon={Server}
              metrics={data.containerApps}
            />
            <ResourceCard
              title="PostgreSQL"
              subtitle="pg-orbit-prod"
              icon={Database}
              metrics={data.database}
            />
            <ResourceCard
              title="Storage Account"
              subtitle="stsharedprod"
              icon={HardDrive}
              metrics={data.storage}
            />
            <ResourceCard
              title="Application Insights"
              subtitle="appi-orbit-prod · last 1h"
              icon={Activity}
              metrics={data.appInsights}
            />
          </div>
        </>
      ) : null}
    </div>
  );
}
