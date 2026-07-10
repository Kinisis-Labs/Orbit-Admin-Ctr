import { Link } from "react-router-dom";
import {
  RefreshCw,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  HelpCircle,
  Info,
  ExternalLink,
} from "lucide-react";
import { useApplicationMetrics, type AppNocEntry, type AppStatus } from "../../services/noc";

// ── Helpers ───────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: AppStatus }) {
  const cfg: Record<AppStatus, { icon: React.ElementType; label: string; color: string; bg: string }> = {
    healthy: { icon: CheckCircle2, label: "Healthy", color: "#22c55e", bg: "rgba(34,197,94,0.1)" },
    degraded: { icon: AlertTriangle, label: "Degraded", color: "#f59e0b", bg: "rgba(245,158,11,0.1)" },
    unhealthy: { icon: XCircle, label: "Unhealthy", color: "#ef4444", bg: "rgba(239,68,68,0.1)" },
    unknown: { icon: HelpCircle, label: "Unknown", color: "var(--orbit-text-muted)", bg: "var(--orbit-bg-page)" },
  };
  const { icon: Icon, label, color, bg } = cfg[status];
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold"
      style={{ color, background: bg }}
    >
      <Icon className="h-3 w-3" />
      {label}
    </span>
  );
}

function fmt(value: number | null, unit: string): string {
  if (value === null) return "—";
  if (unit === "%") return `${value.toFixed(1)}%`;
  if (unit === "ms") return `${Math.round(value)} ms`;
  return value.toLocaleString();
}

function AppRow({ app }: { app: AppNocEntry }) {
  const t = app.telemetry;
  return (
    <tr style={{ borderBottom: "1px solid var(--orbit-border)" }}>
      <td className="px-4 py-3">
        <div className="flex flex-col">
          <Link
            to={`/noc/applications/${app.slug}`}
            className="text-sm font-semibold hover:underline"
            style={{ color: "var(--orbit-text-primary)" }}
          >
            {app.displayName}
          </Link>
          <span className="text-xs" style={{ color: "var(--orbit-text-muted)" }}>
            {app.slug}
          </span>
        </div>
      </td>
      <td className="px-4 py-3">
        <StatusBadge status={app.status} />
      </td>
      <td className="px-4 py-3 text-sm tabular-nums text-right" style={{ color: "var(--orbit-text-secondary)" }}>
        {fmt(t.availability, "%")}
      </td>
      <td className="px-4 py-3 text-sm tabular-nums text-right" style={{ color: "var(--orbit-text-secondary)" }}>
        {fmt(t.avgResponseMs, "ms")}
      </td>
      <td className="px-4 py-3 text-sm tabular-nums text-right" style={{ color: t.failedRequests !== null && t.failedRequests > 0 ? "#ef4444" : "var(--orbit-text-secondary)" }}>
        {fmt(t.failedRequests, "count")}
      </td>
      <td className="px-4 py-3 text-sm tabular-nums text-right" style={{ color: "var(--orbit-text-secondary)" }}>
        {fmt(t.activeSessions, "count")}
      </td>
      <td className="px-4 py-3 text-right">
        {app.url && (
          <a href={app.url} target="_blank" rel="noreferrer" style={{ color: "var(--orbit-text-muted)" }}>
            <ExternalLink className="h-3.5 w-3.5 inline" />
          </a>
        )}
      </td>
    </tr>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function ApplicationDashboard() {
  const { data, isLoading, error, refetch, isFetching, dataUpdatedAt } = useApplicationMetrics();

  const lastUpdated = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    : null;

  const healthy = data?.apps.filter((a) => a.status === "healthy").length ?? 0;
  const degraded = data?.apps.filter((a) => a.status === "degraded").length ?? 0;
  const unhealthy = data?.apps.filter((a) => a.status === "unhealthy").length ?? 0;
  const total = data?.apps.length ?? 0;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "var(--orbit-text-primary)" }}>
            Application NOC
          </h1>
          <p className="text-sm mt-1" style={{ color: "var(--orbit-text-muted)" }}>
            Per-app Application Insights telemetry · 24h window · auto-refreshes every 60s
            {lastUpdated && <span className="ml-2">· Last updated {lastUpdated}</span>}
          </p>
        </div>
        <button
          onClick={() => void refetch()}
          disabled={isFetching}
          className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
          style={{
            background: "var(--orbit-bg-card)",
            border: "1px solid var(--orbit-border)",
            color: "var(--orbit-text-secondary)",
          }}
        >
          <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 py-16" style={{ color: "var(--orbit-text-muted)" }}>
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="text-sm">Fetching application telemetry…</span>
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
          {!data.apps[0]?.appInsightsConfigured && (
            <div
              className="flex items-start gap-3 rounded-xl px-4 py-3 text-sm"
              style={{
                background: "rgba(245,158,11,0.08)",
                border: "1px solid rgba(245,158,11,0.3)",
                color: "#f59e0b",
              }}
            >
              <Info className="h-4 w-4 mt-0.5 shrink-0" />
              <span>
                App Insights not configured — set{" "}
                <code className="font-mono text-xs">APPINSIGHTS_CONNECTION_STRING</code> to enable live telemetry.
                Showing unknown status for all apps.
              </span>
            </div>
          )}

          {/* Summary tiles */}
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: "Healthy", value: healthy, color: "#22c55e" },
              { label: "Degraded", value: degraded, color: "#f59e0b" },
              { label: "Unhealthy", value: unhealthy, color: "#ef4444" },
            ].map((s) => (
              <div
                key={s.label}
                className="rounded-xl px-5 py-4 flex flex-col gap-1"
                style={{ background: "var(--orbit-bg-card)", border: "1px solid var(--orbit-border)" }}
              >
                <span className="text-xs font-medium" style={{ color: "var(--orbit-text-muted)" }}>
                  {s.label}
                </span>
                <span className="text-3xl font-bold tabular-nums" style={{ color: s.color }}>
                  {s.value}
                </span>
                <span className="text-xs" style={{ color: "var(--orbit-text-muted)" }}>
                  of {total} apps
                </span>
              </div>
            ))}
          </div>

          {/* Table */}
          <div
            className="rounded-xl overflow-hidden"
            style={{ background: "var(--orbit-bg-card)", border: "1px solid var(--orbit-border)" }}
          >
            <table className="w-full">
              <thead>
                <tr style={{ borderBottom: "1px solid var(--orbit-border)" }}>
                  {["Application", "Status", "Availability", "Avg Response", "Failed Req", "Sessions", ""].map((h) => (
                    <th
                      key={h}
                      className="px-4 py-3 text-left text-xs font-semibold"
                      style={{ color: "var(--orbit-text-muted)" }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.apps.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-sm text-center" style={{ color: "var(--orbit-text-muted)" }}>
                      No registered applications found.
                    </td>
                  </tr>
                ) : (
                  data.apps.map((app) => <AppRow key={app.slug} app={app} />)
                )}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </div>
  );
}
