import {
  AlertTriangle,
  XCircle,
  CheckCircle2,
  Clock,
  RefreshCw,
  Loader2,
  ShieldAlert,
  Timer,
  TrendingDown,
  Info,
} from "lucide-react";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import {
  useIncidents,
  useIncidentTrend,
  type AzureAlert,
  type AlertSeverity,
  type AlertStatus,
  type IncidentMetrics,
} from "../../services/noc";

// ── Constants ─────────────────────────────────────────────────────────────────

const SEV_COLOR: Record<AlertSeverity, string> = {
  critical: "#ef4444",
  error: "#f97316",
  warning: "#f59e0b",
  informational: "#3b82f6",
  unknown: "#6b7280",
};

const SEV_BG: Record<AlertSeverity, string> = {
  critical: "rgba(239,68,68,0.12)",
  error: "rgba(249,115,22,0.12)",
  warning: "rgba(245,158,11,0.12)",
  informational: "rgba(59,130,246,0.12)",
  unknown: "rgba(107,114,128,0.12)",
};

const STATUS_COLOR: Record<AlertStatus, string> = {
  active: "#ef4444",
  acknowledged: "#f59e0b",
  resolved: "#22c55e",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtAge(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 60) return `${mins}m`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h ${mins % 60}m`;
  return `${Math.floor(mins / 1440)}d`;
}

function fmtMinutes(m: number | null): string {
  if (m === null) return "—";
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function SeverityBadge({ severity }: { severity: AlertSeverity }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold uppercase tracking-wide"
      style={{ background: SEV_BG[severity], color: SEV_COLOR[severity] }}
    >
      {severity === "critical" && <XCircle className="h-3 w-3" />}
      {severity === "error" && <AlertTriangle className="h-3 w-3" />}
      {severity === "warning" && <AlertTriangle className="h-3 w-3" />}
      {severity === "informational" && <Info className="h-3 w-3" />}
      {severity}
    </span>
  );
}

function StatusDot({ status }: { status: AlertStatus }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium capitalize" style={{ color: STATUS_COLOR[status] }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: STATUS_COLOR[status] }} />
      {status}
    </span>
  );
}

// ── Summary stat card ─────────────────────────────────────────────────────────

function StatCard({ label, value, sub, color, icon: Icon }: {
  label: string;
  value: string | number;
  sub?: string;
  color: string;
  icon: React.ElementType;
}) {
  return (
    <div
      className="rounded-xl px-5 py-4 flex items-start gap-4"
      style={{ background: "var(--orbit-bg-card)", border: "1px solid var(--orbit-border)" }}
    >
      <div className="rounded-lg p-2.5 mt-0.5" style={{ background: `${color}18` }}>
        <Icon className="h-5 w-5" style={{ color }} />
      </div>
      <div>
        <p className="text-2xl font-bold tabular-nums" style={{ color }}>{value}</p>
        <p className="text-sm font-medium mt-0.5" style={{ color: "var(--orbit-text-secondary)" }}>{label}</p>
        {sub && <p className="text-xs mt-0.5" style={{ color: "var(--orbit-text-muted)" }}>{sub}</p>}
      </div>
    </div>
  );
}

// ── Alert row ─────────────────────────────────────────────────────────────────

function AlertRow({ alert }: { alert: AzureAlert }) {
  const age = fmtAge(alert.firedAt);
  const slaMinutes = 240;
  const ageMinutes = (Date.now() - new Date(alert.firedAt).getTime()) / 60_000;
  const slaAtRisk = alert.status === "active" && ageMinutes > slaMinutes * 0.8;

  return (
    <div
      className="flex items-start gap-3 px-4 py-3"
      style={{ borderBottom: "1px solid var(--orbit-border)" }}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <SeverityBadge severity={alert.severity} />
          <span className="text-sm font-medium truncate" style={{ color: "var(--orbit-text-primary)" }}>
            {alert.name}
          </span>
          {slaAtRisk && (
            <span className="text-xs font-semibold rounded-full px-2 py-0.5" style={{ background: "rgba(239,68,68,0.12)", color: "#ef4444" }}>
              SLA at risk
            </span>
          )}
        </div>
        {alert.description && (
          <p className="text-xs mt-1 truncate" style={{ color: "var(--orbit-text-muted)" }}>{alert.description}</p>
        )}
      </div>
      <div className="flex flex-col items-end gap-1 shrink-0">
        <StatusDot status={alert.status} />
        <span className="text-xs tabular-nums" style={{ color: "var(--orbit-text-muted)" }}>
          {alert.service}
        </span>
        <span className="text-xs tabular-nums" style={{ color: "var(--orbit-text-muted)" }}>
          <Clock className="inline h-3 w-3 mr-0.5" />{age}
        </span>
      </div>
    </div>
  );
}

// ── By-service breakdown ──────────────────────────────────────────────────────

function ServiceBreakdown({ byService }: { byService: Record<string, number> }) {
  const entries = Object.entries(byService).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return null;
  const data = entries.map(([name, count]) => ({ name, count }));
  return (
    <div className="rounded-xl overflow-hidden" style={{ background: "var(--orbit-bg-card)", border: "1px solid var(--orbit-border)" }}>
      <div className="px-4 py-3" style={{ borderBottom: "1px solid var(--orbit-border)" }}>
        <p className="text-sm font-semibold" style={{ color: "var(--orbit-text-primary)" }}>Alerts by Service</p>
      </div>
      <div className="p-4">
        <ResponsiveContainer width="100%" height={160}>
          <BarChart data={data} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 8 }}>
            <XAxis type="number" hide />
            <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 11, fill: "var(--orbit-text-secondary)" }} />
            <Tooltip
              contentStyle={{ background: "var(--orbit-bg-card)", border: "1px solid var(--orbit-border)", borderRadius: 8, fontSize: 11 }}
              cursor={{ fill: "rgba(124,58,237,0.08)" }}
            />
            <Bar dataKey="count" fill="#7C3AED" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ── MTTA / MTTR trend chart ───────────────────────────────────────────────────

function MttrTrendChart({ trend }: { trend: { date: string; mttaMinutes: number | null; mttrMinutes: number | null; count: number }[] }) {
  if (trend.length === 0) return (
    <div className="h-32 flex items-center justify-center text-xs" style={{ color: "var(--orbit-text-muted)" }}>
      No trend data yet — requires incident history in database
    </div>
  );
  const data = trend.map((t) => ({ ...t, date: t.date.slice(5) }));
  return (
    <ResponsiveContainer width="100%" height={140}>
      <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--orbit-border)" />
        <XAxis dataKey="date" tick={{ fontSize: 10, fill: "var(--orbit-text-muted)" }} />
        <YAxis tick={{ fontSize: 10, fill: "var(--orbit-text-muted)" }} width={32} />
        <Tooltip
          contentStyle={{ background: "var(--orbit-bg-card)", border: "1px solid var(--orbit-border)", borderRadius: 8, fontSize: 11 }}
          formatter={(v: number) => [`${v}m`, ""]}
        />
        <Line type="monotone" dataKey="mttaMinutes" name="MTTA" stroke="#f59e0b" strokeWidth={2} dot={false} connectNulls />
        <Line type="monotone" dataKey="mttrMinutes" name="MTTR" stroke="#7C3AED" strokeWidth={2} dot={false} connectNulls />
      </LineChart>
    </ResponsiveContainer>
  );
}

// ── Main Dashboard ────────────────────────────────────────────────────────────

export function IncidentDashboard() {
  const { data, isLoading, error, refetch, isFetching, dataUpdatedAt } = useIncidents();
  const { data: trendData } = useIncidentTrend(7);

  const lastUpdated = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : null;

  const activeAlerts = data?.alerts.filter((a) => a.status === "active") ?? [];
  const otherAlerts = data?.alerts.filter((a) => a.status !== "active") ?? [];
  const m = data?.metrics;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "var(--orbit-text-primary)" }}>
            Azure Monitor Alerts
          </h1>
          <p className="text-sm mt-1" style={{ color: "var(--orbit-text-muted)" }}>
            Azure Monitor Alerts · unified ITSM signals · refreshes every 2m
            {lastUpdated && <span className="ml-2">· {lastUpdated}</span>}
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
          <span className="text-sm">Fetching Azure Monitor alerts…</span>
        </div>
      ) : error ? (
        <div className="rounded-xl p-4 text-sm" style={{ color: "#ef4444", border: "1px solid #ef444433", background: "var(--orbit-bg-card)" }}>
          {error.message}
        </div>
      ) : data ? (
        <div className="space-y-6">
          {/* Not configured notice */}
          {!data.azureConfigured && (
            <div className="flex items-start gap-3 rounded-xl px-4 py-3 text-sm" style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.3)", color: "#f59e0b" }}>
              <Info className="h-4 w-4 mt-0.5 shrink-0" />
              Azure Monitor not configured — set <code className="font-mono text-xs mx-1">AZURE_SUBSCRIPTION_IDS</code> and Managed Identity to enable live alerts.
            </div>
          )}

          {/* Summary stats */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard label="Active" value={m?.activeCount ?? 0} sub={m?.criticalCount ? `${m.criticalCount} critical` : undefined} color="#ef4444" icon={ShieldAlert} />
            <StatCard label="SLA at Risk" value={m?.slaAtRiskCount ?? 0} sub="within 80% of SLA window" color="#f59e0b" icon={AlertTriangle} />
            <StatCard label="MTTA" value={fmtMinutes(m?.mttaMinutes ?? null)} sub="mean time to acknowledge" color="#7C3AED" icon={Timer} />
            <StatCard label="MTTR" value={fmtMinutes(m?.mttrMinutes ?? null)} sub="mean time to resolve" color="#22c55e" icon={TrendingDown} />
          </div>

          {/* Active incidents + service breakdown side by side */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Active incident list */}
            <div className="lg:col-span-2 rounded-xl overflow-hidden" style={{ background: "var(--orbit-bg-card)", border: "1px solid var(--orbit-border)" }}>
              <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: "1px solid var(--orbit-border)" }}>
                <p className="text-sm font-semibold" style={{ color: "var(--orbit-text-primary)" }}>
                  Active Incidents
                  <span className="ml-2 text-xs font-normal px-1.5 py-0.5 rounded-full" style={{ background: "rgba(239,68,68,0.12)", color: "#ef4444" }}>
                    {activeAlerts.length}
                  </span>
                </p>
              </div>
              {activeAlerts.length === 0 ? (
                <div className="flex items-center justify-center gap-2 py-10 text-sm" style={{ color: "var(--orbit-text-muted)" }}>
                  <CheckCircle2 className="h-4 w-4" style={{ color: "#22c55e" }} />
                  No active incidents
                </div>
              ) : (
                activeAlerts.map((a) => <AlertRow key={a.id} alert={a} />)
              )}
            </div>

            {/* Service breakdown */}
            <div className="space-y-4">
              <ServiceBreakdown byService={m?.byService ?? {}} />

              {/* Severity breakdown */}
              <div className="rounded-xl overflow-hidden" style={{ background: "var(--orbit-bg-card)", border: "1px solid var(--orbit-border)" }}>
                <div className="px-4 py-3" style={{ borderBottom: "1px solid var(--orbit-border)" }}>
                  <p className="text-sm font-semibold" style={{ color: "var(--orbit-text-primary)" }}>By Severity</p>
                </div>
                <div className="divide-y" style={{ borderColor: "var(--orbit-border)" }}>
                  {(["critical", "error", "warning", "informational"] as AlertSeverity[]).map((sev) => (
                    <div key={sev} className="flex items-center justify-between px-4 py-2">
                      <SeverityBadge severity={sev} />
                      <span className="text-sm font-semibold tabular-nums" style={{ color: SEV_COLOR[sev] }}>
                        {m?.bySeverity[sev] ?? 0}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* MTTA/MTTR trend + acknowledged/resolved */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Trend chart */}
            <div className="rounded-xl overflow-hidden" style={{ background: "var(--orbit-bg-card)", border: "1px solid var(--orbit-border)" }}>
              <div className="px-4 py-3" style={{ borderBottom: "1px solid var(--orbit-border)" }}>
                <p className="text-sm font-semibold" style={{ color: "var(--orbit-text-primary)" }}>MTTA / MTTR — 7 Day Trend</p>
                <p className="text-xs mt-0.5" style={{ color: "var(--orbit-text-muted)" }}>
                  <span className="inline-block w-3 h-0.5 mr-1 align-middle" style={{ background: "#f59e0b" }} />MTTA &nbsp;
                  <span className="inline-block w-3 h-0.5 mr-1 align-middle" style={{ background: "#7C3AED" }} />MTTR
                </p>
              </div>
              <div className="p-4">
                <MttrTrendChart trend={trendData?.trend ?? []} />
              </div>
            </div>

            {/* Acknowledged + resolved */}
            <div className="rounded-xl overflow-hidden" style={{ background: "var(--orbit-bg-card)", border: "1px solid var(--orbit-border)" }}>
              <div className="px-4 py-3" style={{ borderBottom: "1px solid var(--orbit-border)" }}>
                <p className="text-sm font-semibold" style={{ color: "var(--orbit-text-primary)" }}>
                  Acknowledged / Resolved
                  <span className="ml-2 text-xs font-normal px-1.5 py-0.5 rounded-full" style={{ background: "rgba(34,197,94,0.12)", color: "#22c55e" }}>
                    {otherAlerts.length}
                  </span>
                </p>
              </div>
              <div className="overflow-y-auto" style={{ maxHeight: 220 }}>
                {otherAlerts.length === 0 ? (
                  <div className="py-8 text-center text-xs" style={{ color: "var(--orbit-text-muted)" }}>No resolved alerts in current window</div>
                ) : (
                  otherAlerts.map((a) => <AlertRow key={a.id} alert={a} />)
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
