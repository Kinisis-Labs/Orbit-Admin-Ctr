import { useParams, Link } from "react-router-dom";
import {
  ArrowLeft,
  RefreshCw,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  HelpCircle,
  ExternalLink,
} from "lucide-react";
import { useApplicationDetail, type AppStatus } from "../../services/noc";

// ── Helpers ───────────────────────────────────────────────────────────────────

function statusConfig(status: AppStatus) {
  const map: Record<AppStatus, { icon: React.ElementType; label: string; color: string; bg: string }> = {
    healthy: { icon: CheckCircle2, label: "Healthy", color: "#22c55e", bg: "rgba(34,197,94,0.1)" },
    degraded: { icon: AlertTriangle, label: "Degraded", color: "#f59e0b", bg: "rgba(245,158,11,0.1)" },
    unhealthy: { icon: XCircle, label: "Unhealthy", color: "#ef4444", bg: "rgba(239,68,68,0.1)" },
    unknown: { icon: HelpCircle, label: "Unknown", color: "var(--orbit-text-muted)", bg: "var(--orbit-bg-page)" },
  };
  return map[status];
}

function MetricTile({
  label,
  value,
  unit,
  highlight,
}: {
  label: string;
  value: number | null;
  unit: string;
  highlight?: "red" | "green";
}) {
  let display = "—";
  if (value !== null) {
    if (unit === "%") display = `${value.toFixed(1)}%`;
    else if (unit === "ms") display = `${Math.round(value)} ms`;
    else display = value.toLocaleString();
  }

  const color =
    value !== null && highlight === "red" && value > 0
      ? "#ef4444"
      : value !== null && highlight === "green" && value >= 99
        ? "#22c55e"
        : "var(--orbit-text-primary)";

  return (
    <div
      className="rounded-xl px-5 py-4 flex flex-col gap-1"
      style={{ background: "var(--orbit-bg-card)", border: "1px solid var(--orbit-border)" }}
    >
      <span className="text-xs font-medium" style={{ color: "var(--orbit-text-muted)" }}>
        {label}
      </span>
      <span className="text-2xl font-bold tabular-nums" style={{ color }}>
        {display}
      </span>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function ApplicationDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const { data, isLoading, error, refetch, isFetching } = useApplicationDetail(slug ?? "");

  if (!slug) {
    return (
      <p className="text-sm" style={{ color: "var(--orbit-text-muted)" }}>
        No application specified.
      </p>
    );
  }

  return (
    <div className="space-y-5">
      {/* Back link */}
      <Link
        to="/noc/applications"
        className="inline-flex items-center gap-2 text-sm"
        style={{ color: "var(--orbit-text-muted)" }}
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Application NOC
      </Link>

      {isLoading ? (
        <div className="flex items-center gap-2 py-16" style={{ color: "var(--orbit-text-muted)" }}>
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="text-sm">Fetching telemetry…</span>
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
          {/* Header */}
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-bold" style={{ color: "var(--orbit-text-primary)" }}>
                  {data.displayName}
                </h1>
                {(() => {
                  const { icon: Icon, label, color, bg } = statusConfig(data.status);
                  return (
                    <span
                      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold"
                      style={{ color, background: bg }}
                    >
                      <Icon className="h-3 w-3" />
                      {label}
                    </span>
                  );
                })()}
              </div>
              {data.description && (
                <p className="text-sm" style={{ color: "var(--orbit-text-muted)" }}>
                  {data.description}
                </p>
              )}
              <p className="text-xs" style={{ color: "var(--orbit-text-muted)" }}>
                Slug: <span className="font-mono">{data.slug}</span> · Category: {data.category}
                {data.url && (
                  <>
                    {" · "}
                    <a
                      href={data.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 hover:underline"
                      style={{ color: "var(--orbit-text-muted)" }}
                    >
                      Open app <ExternalLink className="h-3 w-3" />
                    </a>
                  </>
                )}
              </p>
            </div>
            <button
              onClick={() => void refetch()}
              disabled={isFetching}
              className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50 shrink-0"
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

          {/* Metric tiles */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <MetricTile
              label="Availability (24h)"
              value={data.telemetry.availability}
              unit="%"
              highlight="green"
            />
            <MetricTile label="Avg Response" value={data.telemetry.avgResponseMs} unit="ms" />
            <MetricTile
              label="Failed Requests"
              value={data.telemetry.failedRequests}
              unit="count"
              highlight="red"
            />
            <MetricTile label="Total Requests" value={data.telemetry.totalRequests} unit="count" />
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <MetricTile label="Exceptions" value={data.telemetry.exceptions} unit="count" highlight="red" />
            <MetricTile label="Active Sessions" value={data.telemetry.activeSessions} unit="count" />
            <MetricTile
              label="Auth Failures"
              value={data.telemetry.authFailures}
              unit="count"
              highlight="red"
            />
          </div>

          {!data.appInsightsConfigured && (
            <p className="text-xs" style={{ color: "var(--orbit-text-muted)" }}>
              Telemetry is unavailable — set{" "}
              <code className="font-mono">APPINSIGHTS_CONNECTION_STRING</code> to enable live metrics.
            </p>
          )}

          <p className="text-xs" style={{ color: "var(--orbit-text-muted)" }}>
            Captured at {new Date(data.capturedAt).toLocaleString()} · 24h window · auto-refreshes every 60s
          </p>
        </>
      ) : null}
    </div>
  );
}
