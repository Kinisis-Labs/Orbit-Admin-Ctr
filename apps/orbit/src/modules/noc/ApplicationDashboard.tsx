import { Link } from "react-router-dom";
import {
  RefreshCw,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  HelpCircle,
  ExternalLink,
  Activity,
  Clock,
  Users,
  Zap,
  ShieldAlert,
  ChevronRight,
} from "lucide-react";
import { useApplicationMetrics, type AppNocEntry, type AppStatus } from "../../services/noc";

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_CFG: Record<AppStatus, { icon: React.ElementType; label: string; color: string; bg: string; border: string }> = {
  healthy:   { icon: CheckCircle2, label: "Healthy",   color: "#22c55e", bg: "rgba(34,197,94,0.08)",   border: "rgba(34,197,94,0.25)"   },
  degraded:  { icon: AlertTriangle, label: "Degraded",  color: "#f59e0b", bg: "rgba(245,158,11,0.08)",  border: "rgba(245,158,11,0.25)"  },
  unhealthy: { icon: XCircle,       label: "Unhealthy", color: "#ef4444", bg: "rgba(239,68,68,0.08)",   border: "rgba(239,68,68,0.25)"   },
  unknown:   { icon: HelpCircle,    label: "Unknown",   color: "var(--orbit-text-muted)", bg: "var(--orbit-bg-page)", border: "var(--orbit-border)" },
};

function StatusBadge({ status }: { status: AppStatus }) {
  const { icon: Icon, label, color, bg } = STATUS_CFG[status];
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold" style={{ color, background: bg }}>
      <Icon className="h-3 w-3" />
      {label}
    </span>
  );
}

function fmt(value: number | null, unit: "%" | "ms" | "count"): string {
  if (value === null) return "—";
  if (unit === "%") return `${value.toFixed(1)}%`;
  if (unit === "ms") return value >= 1000 ? `${(value / 1000).toFixed(1)}s` : `${Math.round(value)}ms`;
  return value >= 1000 ? `${(value / 1000).toFixed(1)}k` : value.toLocaleString();
}

function AvailabilityBar({ value }: { value: number | null }) {
  const pct = value ?? 0;
  const color = pct >= 99 ? "#22c55e" : pct >= 95 ? "#f59e0b" : "#ef4444";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 rounded-full overflow-hidden" style={{ height: 6, background: "var(--orbit-border)" }}>
        <div style={{ width: `${Math.min(pct, 100)}%`, height: "100%", background: color, transition: "width 0.4s ease" }} />
      </div>
      <span className="text-xs tabular-nums w-12 text-right font-semibold" style={{ color }}>
        {value !== null ? `${value.toFixed(2)}%` : "—"}
      </span>
    </div>
  );
}

function MetricPill({ icon: Icon, label, value, alert }: { icon: React.ElementType; label: string; value: string; alert?: boolean }) {
  return (
    <div className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5" style={{ background: "var(--orbit-bg-page)", border: "1px solid var(--orbit-border)" }}>
      <Icon className="h-3 w-3 shrink-0" style={{ color: alert ? "#ef4444" : "var(--orbit-text-muted)" }} />
      <span className="text-[10px] font-medium" style={{ color: "var(--orbit-text-muted)" }}>{label}</span>
      <span className="text-xs font-bold tabular-nums" style={{ color: alert ? "#ef4444" : "var(--orbit-text-primary)" }}>{value}</span>
    </div>
  );
}

function AppCard({ app }: { app: AppNocEntry }) {
  const t = app.telemetry;
  const cfg = STATUS_CFG[app.status];
  const Icon = cfg.icon;
  const hasAlerts = (t.failedRequests ?? 0) > 0 || (t.exceptions ?? 0) > 0 || (t.authFailures ?? 0) > 0;

  return (
    <div
      className="rounded-2xl flex flex-col gap-4 p-5 transition-shadow hover:shadow-lg"
      style={{ background: "var(--orbit-bg-card)", border: `1px solid ${hasAlerts && app.status !== "healthy" ? cfg.border : "var(--orbit-border)"}` }}
    >
      {/* Card header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-0.5 min-w-0">
          <Link
            to={`/noc/applications/${app.slug}`}
            className="text-base font-bold truncate hover:underline"
            style={{ color: "var(--orbit-text-primary)" }}
          >
            {app.displayName}
          </Link>
          <span className="text-xs font-mono" style={{ color: "var(--orbit-text-muted)" }}>/{app.slug}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {app.url && (
            <a href={app.url} target="_blank" rel="noreferrer" className="rounded-lg p-1.5 hover:bg-[var(--orbit-border)]" style={{ color: "var(--orbit-text-muted)" }}>
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
          <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold" style={{ color: cfg.color, background: cfg.bg }}>
            <Icon className="h-3 w-3" />
            {cfg.label}
          </span>
        </div>
      </div>

      {/* Availability bar */}
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--orbit-text-muted)" }}>Availability (24h)</span>
        </div>
        <AvailabilityBar value={t.availability} />
      </div>

      {/* Metric pills */}
      <div className="flex flex-wrap gap-2">
        <MetricPill icon={Clock}       label="Avg Response" value={fmt(t.avgResponseMs, "ms")} />
        <MetricPill icon={Activity}    label="Requests"     value={fmt(t.totalRequests, "count")} />
        <MetricPill icon={Users}       label="Sessions"     value={fmt(t.activeSessions, "count")} />
        <MetricPill icon={Zap}         label="Failed"       value={fmt(t.failedRequests, "count")} alert={(t.failedRequests ?? 0) > 0} />
        <MetricPill icon={ShieldAlert} label="Exceptions"   value={fmt(t.exceptions, "count")} alert={(t.exceptions ?? 0) > 0} />
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between pt-1" style={{ borderTop: "1px solid var(--orbit-border)" }}>
        <span className="text-[10px] px-2 py-0.5 rounded-full font-medium capitalize" style={{ background: "var(--orbit-bg-page)", color: "var(--orbit-text-muted)", border: "1px solid var(--orbit-border)" }}>
          {app.category}
        </span>
        <Link
          to={`/noc/applications/${app.slug}`}
          className="inline-flex items-center gap-1 text-xs font-medium hover:underline"
          style={{ color: "var(--orbit-primary)" }}
        >
          View details <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </div>
  );
}

// ── Fleet summary bar ─────────────────────────────────────────────────────────

function FleetBar({ healthy, degraded, unhealthy, unknown, total }: { healthy: number; degraded: number; unhealthy: number; unknown: number; total: number }) {
  if (total === 0) return null;
  const segments = [
    { count: healthy,   color: "#22c55e", label: "Healthy"   },
    { count: degraded,  color: "#f59e0b", label: "Degraded"  },
    { count: unhealthy, color: "#ef4444", label: "Unhealthy" },
    { count: unknown,   color: "var(--orbit-border)", label: "Unknown" },
  ];
  return (
    <div className="rounded-2xl px-5 py-4 flex flex-col gap-3" style={{ background: "var(--orbit-bg-card)", border: "1px solid var(--orbit-border)" }}>
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold" style={{ color: "var(--orbit-text-primary)" }}>Fleet Health</span>
        <span className="text-xs" style={{ color: "var(--orbit-text-muted)" }}>{total} application{total !== 1 ? "s" : ""} monitored</span>
      </div>
      <div className="flex gap-0.5 rounded-full overflow-hidden" style={{ height: 8 }}>
        {segments.map((s) =>
          s.count > 0 ? (
            <div key={s.label} style={{ flex: s.count, background: s.color }} title={`${s.label}: ${s.count}`} />
          ) : null,
        )}
      </div>
      <div className="flex flex-wrap gap-4">
        {segments.map((s) => (
          <div key={s.label} className="flex items-center gap-1.5">
            <div className="h-2 w-2 rounded-full shrink-0" style={{ background: s.color }} />
            <span className="text-xs" style={{ color: "var(--orbit-text-muted)" }}>
              <span className="font-bold tabular-nums" style={{ color: "var(--orbit-text-primary)" }}>{s.count}</span> {s.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function ApplicationDashboard() {
  const { data, isLoading, error, refetch, isFetching, dataUpdatedAt } = useApplicationMetrics();

  const lastUpdated = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : null;

  const healthy   = data?.apps.filter((a) => a.status === "healthy").length   ?? 0;
  const degraded  = data?.apps.filter((a) => a.status === "degraded").length  ?? 0;
  const unhealthy = data?.apps.filter((a) => a.status === "unhealthy").length ?? 0;
  const unknown   = data?.apps.filter((a) => a.status === "unknown").length   ?? 0;
  const total     = data?.apps.length ?? 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "var(--orbit-text-primary)" }}>Applications</h1>
          <p className="text-sm mt-1" style={{ color: "var(--orbit-text-muted)" }}>
            Live App Insights telemetry · 24h window · auto-refreshes every 60s
            {lastUpdated && <span className="ml-2 opacity-70">· Updated {lastUpdated}</span>}
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
        <div className="flex items-center gap-3 py-20 justify-center" style={{ color: "var(--orbit-text-muted)" }}>
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="text-sm">Fetching application telemetry…</span>
        </div>
      ) : error ? (
        <div className="rounded-xl p-4 text-sm" style={{ color: "#ef4444", border: "1px solid #ef444433", background: "var(--orbit-bg-card)" }}>
          {error.message}
        </div>
      ) : data ? (
        <>
          <FleetBar healthy={healthy} degraded={degraded} unhealthy={unhealthy} unknown={unknown} total={total} />

          {data.apps.length === 0 ? (
            <div className="rounded-2xl p-12 text-center text-sm" style={{ background: "var(--orbit-bg-card)", border: "1px solid var(--orbit-border)", color: "var(--orbit-text-muted)" }}>
              No registered applications found. Register one in Admin → Applications.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
              {data.apps.map((app) => <AppCard key={app.slug} app={app} />)}
            </div>
          )}

          <p className="text-xs" style={{ color: "var(--orbit-text-muted)" }}>
            Data captured at {new Date(data.capturedAt).toLocaleString()} · Telemetry window: last 24 hours
          </p>
        </>
      ) : null}
    </div>
  );
}
