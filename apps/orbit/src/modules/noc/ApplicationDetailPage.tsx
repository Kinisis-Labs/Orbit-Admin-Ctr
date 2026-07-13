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
  Activity,
  Clock,
  Users,
  Zap,
  ShieldAlert,
  AlertCircle,
  Globe,
  Tag,
  Info,
} from "lucide-react";
import { useApplicationDetail, type AppStatus } from "../../services/noc";

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_CFG: Record<AppStatus, { icon: React.ElementType; label: string; color: string; bg: string }> = {
  healthy:   { icon: CheckCircle2,  label: "Healthy",   color: "#22c55e", bg: "rgba(34,197,94,0.1)"  },
  degraded:  { icon: AlertTriangle, label: "Degraded",  color: "#f59e0b", bg: "rgba(245,158,11,0.1)" },
  unhealthy: { icon: XCircle,       label: "Unhealthy", color: "#ef4444", bg: "rgba(239,68,68,0.1)"  },
  unknown:   { icon: HelpCircle,    label: "Unknown",   color: "var(--orbit-text-muted)", bg: "var(--orbit-bg-page)" },
};

function fmtVal(value: number | null, unit: "%" | "ms" | "count"): string {
  if (value === null) return "—";
  if (unit === "%") return `${value.toFixed(2)}%`;
  if (unit === "ms") return value >= 1000 ? `${(value / 1000).toFixed(2)}s` : `${Math.round(value)} ms`;
  return value >= 1_000_000
    ? `${(value / 1_000_000).toFixed(1)}M`
    : value >= 1000
      ? `${(value / 1000).toFixed(1)}k`
      : value.toLocaleString();
}

function availColor(v: number | null): string {
  if (v === null) return "var(--orbit-text-muted)";
  if (v >= 99.9) return "#22c55e";
  if (v >= 99) return "#4ade80";
  if (v >= 95) return "#f59e0b";
  return "#ef4444";
}

function MetricCard({
  icon: Icon,
  label,
  value,
  unit,
  sublabel,
  alert,
  success,
}: {
  icon: React.ElementType;
  label: string;
  value: number | null;
  unit: "%" | "ms" | "count";
  sublabel?: string;
  alert?: boolean;
  success?: boolean;
}) {
  const hasValue = value !== null;
  const isAlert = alert && hasValue && (value as number) > 0;
  const isSuccess = success && hasValue && (value as number) >= 99;
  const valueColor = isAlert ? "#ef4444" : isSuccess ? "#22c55e" : "var(--orbit-text-primary)";
  const borderColor = isAlert ? "rgba(239,68,68,0.3)" : "var(--orbit-border)";
  const bgColor = isAlert ? "rgba(239,68,68,0.04)" : "var(--orbit-bg-card)";

  return (
    <div
      className="rounded-2xl p-5 flex flex-col gap-3"
      style={{ background: bgColor, border: `1px solid ${borderColor}` }}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--orbit-text-muted)" }}>
          {label}
        </span>
        <div className="rounded-lg p-1.5" style={{ background: "var(--orbit-bg-page)", border: "1px solid var(--orbit-border)" }}>
          <Icon className="h-3.5 w-3.5" style={{ color: isAlert ? "#ef4444" : "var(--orbit-text-muted)" }} />
        </div>
      </div>
      <div>
        <span className="text-3xl font-bold tabular-nums" style={{ color: valueColor }}>
          {fmtVal(value, unit)}
        </span>
        {sublabel && (
          <p className="text-xs mt-1" style={{ color: "var(--orbit-text-muted)" }}>{sublabel}</p>
        )}
      </div>
    </div>
  );
}

function AvailabilityRing({ value }: { value: number | null }) {
  const pct = value ?? 0;
  const color = availColor(value);
  const radius = 52;
  const circ = 2 * Math.PI * radius;
  const dash = (Math.min(pct, 100) / 100) * circ;

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative" style={{ width: 140, height: 140 }}>
        <svg width={140} height={140} className="-rotate-90" style={{ display: "block" }}>
          <circle cx={70} cy={70} r={radius} fill="none" strokeWidth={10} stroke="var(--orbit-border)" />
          <circle
            cx={70} cy={70} r={radius} fill="none" strokeWidth={10}
            stroke={color}
            strokeDasharray={`${dash} ${circ}`}
            strokeLinecap="round"
            style={{ transition: "stroke-dasharray 0.6s ease" }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-bold tabular-nums" style={{ color }}>
            {value !== null ? `${value.toFixed(1)}%` : "—"}
          </span>
          <span className="text-[10px] font-medium uppercase tracking-wider" style={{ color: "var(--orbit-text-muted)" }}>
            uptime
          </span>
        </div>
      </div>
      <span className="text-xs" style={{ color: "var(--orbit-text-muted)" }}>Last 24 hours</span>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-3" style={{ borderBottom: "1px solid var(--orbit-border)" }}>
      <span className="text-xs font-semibold uppercase tracking-wider w-32 shrink-0 mt-0.5" style={{ color: "var(--orbit-text-muted)" }}>
        {label}
      </span>
      <span className="text-sm" style={{ color: "var(--orbit-text-primary)" }}>{value}</span>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function ApplicationDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const { data, isLoading, error, refetch, isFetching } = useApplicationDetail(slug ?? "");

  if (!slug) {
    return <p className="text-sm" style={{ color: "var(--orbit-text-muted)" }}>No application specified.</p>;
  }

  return (
    <div className="space-y-6">
      {/* Back nav */}
      <Link to="/noc/applications" className="inline-flex items-center gap-2 text-sm hover:underline" style={{ color: "var(--orbit-text-muted)" }}>
        <ArrowLeft className="h-4 w-4" />
        All Applications
      </Link>

      {isLoading ? (
        <div className="flex items-center gap-3 py-20 justify-center" style={{ color: "var(--orbit-text-muted)" }}>
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="text-sm">Fetching telemetry…</span>
        </div>
      ) : error ? (
        <div className="rounded-xl p-4 text-sm" style={{ color: "#ef4444", border: "1px solid #ef444433", background: "var(--orbit-bg-card)" }}>
          {error.message}
        </div>
      ) : data ? (
        <>
          {/* Page header */}
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-2xl font-bold" style={{ color: "var(--orbit-text-primary)" }}>
                  {data.displayName}
                </h1>
                {(() => {
                  const { icon: Icon, label, color, bg } = STATUS_CFG[data.status];
                  return (
                    <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold" style={{ color, background: bg }}>
                      <Icon className="h-3.5 w-3.5" />
                      {label}
                    </span>
                  );
                })()}
              </div>
              {data.description && (
                <p className="text-sm max-w-xl" style={{ color: "var(--orbit-text-muted)" }}>{data.description}</p>
              )}
              <div className="flex items-center gap-3 flex-wrap text-xs" style={{ color: "var(--orbit-text-muted)" }}>
                <span className="font-mono">/{data.slug}</span>
                <span>·</span>
                <span className="capitalize">{data.category}</span>
                {data.url && (
                  <>
                    <span>·</span>
                    <a href={data.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:underline" style={{ color: "var(--orbit-primary)" }}>
                      Open app <ExternalLink className="h-3 w-3" />
                    </a>
                  </>
                )}
              </div>
            </div>
            <button
              onClick={() => void refetch()}
              disabled={isFetching}
              className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50 shrink-0"
              style={{ background: "var(--orbit-bg-card)", border: "1px solid var(--orbit-border)", color: "var(--orbit-text-secondary)" }}
            >
              <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
              Refresh
            </button>
          </div>

          {/* Telemetry not configured banner */}
          {!data.appInsightsConfigured && (
            <div className="flex items-start gap-3 rounded-xl px-4 py-3 text-sm" style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.3)", color: "#f59e0b" }}>
              <Info className="h-4 w-4 mt-0.5 shrink-0" />
              <span>App Insights not configured — set <code className="font-mono text-xs">APPINSIGHTS_CONNECTION_STRING</code> to enable live telemetry.</span>
            </div>
          )}

          {/* Availability + key metrics hero row */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-5">
            {/* Availability ring */}
            <div className="md:col-span-1 rounded-2xl p-5 flex flex-col items-center justify-center gap-1" style={{ background: "var(--orbit-bg-card)", border: "1px solid var(--orbit-border)" }}>
              <AvailabilityRing value={data.telemetry.availability} />
            </div>

            {/* Key metric tiles */}
            <div className="md:col-span-3 grid grid-cols-2 md:grid-cols-3 gap-4">
              <MetricCard icon={Clock}       label="Avg Response"    value={data.telemetry.avgResponseMs}  unit="ms"    sublabel="Mean latency, 24h" />
              <MetricCard icon={Activity}    label="Total Requests"  value={data.telemetry.totalRequests}  unit="count" sublabel="All requests, 24h" />
              <MetricCard icon={Users}       label="Active Sessions" value={data.telemetry.activeSessions} unit="count" sublabel="Unique users, 24h" />
              <MetricCard icon={Zap}         label="Failed Requests" value={data.telemetry.failedRequests} unit="count" sublabel="4xx + 5xx responses" alert />
              <MetricCard icon={ShieldAlert} label="Exceptions"      value={data.telemetry.exceptions}     unit="count" sublabel="Unhandled exceptions" alert />
              <MetricCard icon={AlertCircle} label="Auth Failures"   value={data.telemetry.authFailures}   unit="count" sublabel="401/403 responses" alert />
            </div>
          </div>

          {/* App info panel */}
          <div className="rounded-2xl px-5 pt-4 pb-1" style={{ background: "var(--orbit-bg-card)", border: "1px solid var(--orbit-border)" }}>
            <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--orbit-text-muted)" }}>Application Info</p>
            <InfoRow label="Display Name" value={data.displayName} />
            <InfoRow label="Slug" value={<span className="font-mono text-xs">{data.slug}</span>} />
            <InfoRow label="Category" value={<span className="capitalize">{data.category}</span>} />
            {data.description && <InfoRow label="Description" value={data.description} />}
            {data.url && (
              <InfoRow
                label="URL"
                value={
                  <a href={data.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 hover:underline" style={{ color: "var(--orbit-primary)" }}>
                    <Globe className="h-3.5 w-3.5" />
                    {data.url}
                  </a>
                }
              />
            )}
            <InfoRow label="App Insights" value={
              <span className="inline-flex items-center gap-1.5">
                <Tag className="h-3.5 w-3.5" style={{ color: data.appInsightsConfigured ? "#22c55e" : "#ef4444" }} />
                {data.appInsightsConfigured ? "Configured" : "Not configured"}
              </span>
            } />
            <div className="py-3 text-xs" style={{ color: "var(--orbit-text-muted)" }}>
              Captured at {new Date(data.capturedAt).toLocaleString()} · 24h telemetry window · auto-refreshes every 60s
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
