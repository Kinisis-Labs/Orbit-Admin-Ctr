import { Link } from "react-router-dom";
import {
  ShieldCheck,
  Siren,
  TrendingUp,
  Gauge,
  Server,
  Network,
  Cpu,
  MonitorSmartphone,
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  HelpCircle,
  Database,
  Globe,
  Activity,
  Clock,
  RefreshCw,
  Loader2,
} from "lucide-react";
import { useAuth } from "../auth/AuthProvider";
import { useInfrastructureMetrics, useIncidents, useUXSnapshot } from "../../services/noc";
import { usePlatformHealth, type HistoryPoint, type HealthStatus as PlatformHealthStatus } from "../../services/health";

// ── Helpers ───────────────────────────────────────────────────────────────────

type Health = "healthy" | "warning" | "critical" | "unknown";

const H_COLOR: Record<Health, string> = {
  healthy: "#10B981",
  warning: "#F59E0B",
  critical: "#EF4444",
  unknown: "#6B7280",
};

const H_BG: Record<Health, string> = {
  healthy: "rgba(16,185,129,0.08)",
  warning: "rgba(245,158,11,0.08)",
  critical: "rgba(239,68,68,0.08)",
  unknown: "rgba(107,114,128,0.08)",
};

const H_BORDER: Record<Health, string> = {
  healthy: "rgba(16,185,129,0.25)",
  warning: "rgba(245,158,11,0.25)",
  critical: "rgba(239,68,68,0.25)",
  unknown: "rgba(107,114,128,0.25)",
};

function HealthIcon({ status, size = "h-5 w-5" }: { status: Health; size?: string }) {
  const c = H_COLOR[status];
  if (status === "healthy") return <CheckCircle2 className={size} style={{ color: c }} />;
  if (status === "warning") return <AlertTriangle className={size} style={{ color: c }} />;
  if (status === "critical") return <XCircle className={size} style={{ color: c }} />;
  return <HelpCircle className={size} style={{ color: c }} />;
}

function scoreColor(n: number | null): string {
  if (n === null) return "#6B7280";
  if (n >= 90) return "#10B981";
  if (n >= 70) return "#F59E0B";
  return "#EF4444";
}

// ── Executive KPI tile (top row) ──────────────────────────────────────────────

function ExecKpi({
  icon: Icon,
  label,
  value,
  sub,
  color,
  to,
}: {
  icon: React.ElementType;
  label: string;
  value: React.ReactNode;
  sub?: string;
  color: string;
  to: string;
}) {
  return (
    <Link
      to={to}
      className="rounded-xl px-5 py-4 flex items-center gap-4 transition-opacity hover:opacity-80"
      style={{ background: "var(--orbit-bg-card)", border: `1px solid ${color}40`, textDecoration: "none" }}
    >
      <div className="rounded-lg p-3 flex-shrink-0" style={{ background: `${color}15` }}>
        <Icon className="h-6 w-6" style={{ color }} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium uppercase tracking-wide" style={{ color: "var(--orbit-text-muted)" }}>{label}</p>
        <p className="text-2xl font-bold mt-0.5 tabular-nums" style={{ color }}>{value}</p>
        {sub && <p className="text-xs mt-0.5" style={{ color: "var(--orbit-text-muted)" }}>{sub}</p>}
      </div>
      <ArrowRight className="h-4 w-4 flex-shrink-0" style={{ color: "var(--orbit-text-muted)" }} />
    </Link>
  );
}

// ── Column section card ────────────────────────────────────────────────────────

function SectionCard({
  title,
  icon: Icon,
  to,
  health,
  children,
}: {
  title: string;
  icon: React.ElementType;
  to: string;
  health: Health;
  children: React.ReactNode;
}) {
  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{ background: "var(--orbit-bg-card)", border: `1px solid ${H_BORDER[health]}` }}
    >
      <Link
        to={to}
        className="flex items-center justify-between px-4 py-3 transition-opacity hover:opacity-80"
        style={{ borderBottom: "1px solid var(--orbit-border)", background: H_BG[health], textDecoration: "none" }}
      >
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4" style={{ color: "var(--orbit-text-muted)" }} />
          <span className="text-sm font-semibold" style={{ color: "var(--orbit-text-primary)" }}>{title}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-xs capitalize font-medium" style={{ color: H_COLOR[health] }}>{health}</span>
          <HealthIcon status={health} size="h-4 w-4" />
        </div>
      </Link>
      <div className="p-3 space-y-1">{children}</div>
    </div>
  );
}

function MetricRow({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex items-center justify-between px-1 py-1.5" style={{ borderBottom: "1px solid var(--orbit-border)" }}>
      <span className="text-xs" style={{ color: "var(--orbit-text-muted)" }}>{label}</span>
      <span className="text-xs font-semibold tabular-nums" style={{ color: color ?? "var(--orbit-text-secondary)" }}>{value}</span>
    </div>
  );
}

function Skeleton() {
  return <div className="h-4 rounded animate-pulse" style={{ background: "var(--orbit-border)" }} />;
}

// ── Platform Health mini-card ──────────────────────────────────────────────────

const PH_STATUS: Record<PlatformHealthStatus, { color: string; bg: string; label: string; icon: React.ElementType }> = {
  healthy:   { color: "#22c55e", bg: "rgba(34,197,94,0.12)",   label: "Healthy",   icon: CheckCircle2 },
  degraded:  { color: "#f59e0b", bg: "rgba(245,158,11,0.12)",  label: "Degraded",  icon: AlertTriangle },
  unhealthy: { color: "#ef4444", bg: "rgba(239,68,68,0.12)",   label: "Unhealthy", icon: XCircle },
  unknown:   { color: "#94a3b8", bg: "rgba(148,163,184,0.12)", label: "Unknown",   icon: HelpCircle },
};

function PhHistoryDots({ history }: { history: HistoryPoint[] }) {
  if (!history.length) return <span style={{ color: "var(--orbit-text-muted)" }}>—</span>;
  return (
    <span className="flex items-center gap-0.5">
      {history.map((p, i) => (
        <span
          key={i}
          className="inline-block rounded-sm"
          style={{ width: 6, height: 12, background: PH_STATUS[p.status].color, opacity: 0.8 }}
          title={`${p.status} · ${p.latencyMs}ms`}
        />
      ))}
    </span>
  );
}

function PhCheckRow({ check, icon: Icon }: { check: { name: string; status: PlatformHealthStatus; latencyMs?: number; httpStatus?: number; timedOut?: boolean; history: HistoryPoint[]; message?: string }; icon: React.ElementType }) {
  const cfg = PH_STATUS[check.status];
  const StatusIcon = cfg.icon;
  return (
    <div className="flex items-center justify-between px-1 py-2" style={{ borderBottom: "1px solid var(--orbit-border)" }}>
      <div className="flex items-center gap-2 min-w-0">
        <Icon className="h-3.5 w-3.5 flex-shrink-0" style={{ color: "var(--orbit-text-muted)" }} />
        <span className="text-xs font-medium truncate" style={{ color: "var(--orbit-text-primary)" }}>{check.name}</span>
      </div>
      <div className="flex items-center gap-3 flex-shrink-0 ml-2">
        <PhHistoryDots history={check.history} />
        {check.latencyMs !== undefined && (
          <span className="text-xs tabular-nums" style={{ color: "var(--orbit-text-muted)" }}>{check.latencyMs}ms</span>
        )}
        {check.timedOut && <Clock className="h-3 w-3" style={{ color: "#ef4444" }} />}
        <div className="flex items-center gap-1 rounded-full px-2 py-0.5" style={{ background: cfg.bg }}>
          <StatusIcon className="h-3 w-3" style={{ color: cfg.color }} />
          <span className="text-xs font-medium" style={{ color: cfg.color }}>{cfg.label}</span>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function DashboardPage() {
  const { user } = useAuth();
  const { data: infra, isLoading: infraLoading } = useInfrastructureMetrics();
  const { data: incidents, isLoading: incLoading } = useIncidents();
  const { data: ux, isLoading: uxLoading } = useUXSnapshot();
  const { data: ph, isLoading: phLoading, refetch: phRefetch, isFetching: phFetching } = usePlatformHealth();

  // ── Derived values ───────────────────────────────────────────────────────────
  const overallHealth: Health = infra?.overallHealth ?? "unknown";

  const criticalCount =
    (infra?.containerApps.filter((g) => g.health === "critical").length ?? 0) +
    (infra?.database.filter((g) => g.health === "critical").length ?? 0) +
    (infra?.network.filter((g) => g.health === "critical").length ?? 0) +
    (infra?.api.filter((g) => g.health === "critical").length ?? 0);

  const activeIncidents = incidents?.metrics.activeCount ?? 0;
  const criticalIncidents = incidents?.metrics.criticalCount ?? 0;

  const uxScore = ux?.overallScore ?? null;
  const errorRate = ux?.apiLatencyByRegion.length
    ? (ux.apiLatencyByRegion.reduce((a, r) => a + (r.failureRate ?? 0), 0) / ux.apiLatencyByRegion.length).toFixed(1)
    : null;

  const caGroup = infra?.containerApps[0];
  const dbGroup = infra?.database[0];
  const netGroup = infra?.network[0];
  const vpnGroups = infra?.vpn ?? [];
  const lbGroups = infra?.loadBalancers ?? [];
  const apiGroup = infra?.api[0];

  const phOverall = ph?.overall ?? "unknown";
  const phCfg = PH_STATUS[phOverall];

  function fmtMetric(v: number | null, unit: string) {
    if (v === null) return "—";
    if (unit === "%") return `${v.toFixed(1)}%`;
    if (unit === "ms") return `${Math.round(v)}ms`;
    if (unit === "count") return v.toLocaleString();
    return String(v);
  }

  void user;

  return (
    <div className="space-y-3">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold" style={{ color: "var(--orbit-text-primary)" }}>Enterprise Overview</h1>
        <div
          className="flex items-center gap-2 rounded-lg px-3 py-1.5"
          style={{ background: H_BG[overallHealth], border: `1px solid ${H_BORDER[overallHealth]}` }}
        >
          <HealthIcon status={overallHealth} size="h-4 w-4" />
          <span className="text-xs font-semibold capitalize" style={{ color: H_COLOR[overallHealth] }}>
            {overallHealth === "healthy" ? "All Systems Operational"
              : overallHealth === "warning" ? "Degraded Performance"
              : overallHealth === "critical" ? "Critical Issues"
              : "Awaiting Data"}
          </span>
        </div>
      </div>

      {/* ── ROW 1: Executive KPIs (compact) ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        <ExecKpi
          icon={ShieldCheck}
          label="System Health"
          value={infraLoading ? "…" : overallHealth === "healthy" ? "100" : overallHealth === "warning" ? "72" : overallHealth === "critical" ? "35" : "—"}
          sub={infraLoading ? "Loading…" : `${criticalCount} critical resource${criticalCount !== 1 ? "s" : ""}`}
          color={H_COLOR[overallHealth]}
          to="/noc/infrastructure"
        />
        <ExecKpi
          icon={Siren}
          label="Active Incidents"
          value={incLoading ? "…" : activeIncidents}
          sub={incLoading ? "Loading…" : `${criticalIncidents} critical`}
          color={criticalIncidents > 0 ? "#EF4444" : activeIncidents > 0 ? "#F59E0B" : "#10B981"}
          to="/noc/incidents"
        />
        <ExecKpi
          icon={Gauge}
          label="UX Score"
          value={uxLoading ? "…" : uxScore !== null ? uxScore : "—"}
          sub={uxLoading ? "Loading…" : errorRate !== null ? `${errorRate}% API error rate` : "No telemetry"}
          color={scoreColor(uxScore)}
          to="/noc/ux"
        />
        <ExecKpi
          icon={TrendingUp}
          label="Security Posture"
          value="—"
          sub="View security posture"
          color="#4361F1"
          to="/noc/security"
        />
      </div>

      {/* ── ROW 2: Platform Health (full-width horizontal) ── */}
      <div className="rounded-xl overflow-hidden" style={{ background: "var(--orbit-bg-card)", border: "1px solid var(--orbit-border)" }}>
        <div className="px-4 py-2 flex items-center justify-between" style={{ borderBottom: "1px solid var(--orbit-border)", background: "var(--orbit-bg-page)" }}>
          <div className="flex items-center gap-3">
            <Activity className="h-3.5 w-3.5" style={{ color: "var(--orbit-text-muted)" }} />
            <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--orbit-text-muted)" }}>Platform Health</span>
            <div className="flex items-center gap-1.5 rounded-full px-2 py-0.5" style={{ background: phCfg.bg }}>
              <phCfg.icon className="h-3 w-3" style={{ color: phCfg.color }} />
              <span className="text-xs font-semibold" style={{ color: phCfg.color }}>Platform {phCfg.label}</span>
            </div>
            {ph && <span className="text-xs" style={{ color: "var(--orbit-text-muted)" }}>
              {new Date(ph.checkedAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </span>}
          </div>
          <button
            onClick={() => void phRefetch()}
            disabled={phFetching}
            className="flex items-center gap-1 text-xs disabled:opacity-40"
            style={{ color: "var(--orbit-text-muted)" }}
          >
            <RefreshCw className={`h-3 w-3 ${phFetching ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x" style={{ borderColor: "var(--orbit-border)" }}>
          {/* Core services */}
          <div className="px-3 pb-1">
            <div className="px-1 py-2 flex items-center gap-2" style={{ borderBottom: "1px solid var(--orbit-border)" }}>
              <Server className="h-3 w-3" style={{ color: "var(--orbit-text-muted)" }} />
              <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--orbit-text-muted)" }}>Core Services</span>
            </div>
            {phLoading ? (
              <div className="py-3 flex justify-center"><Loader2 className="h-4 w-4 animate-spin" style={{ color: "var(--orbit-text-muted)" }} /></div>
            ) : ph ? (
              <>
                <PhCheckRow check={ph.orbit} icon={Server} />
                <PhCheckRow check={ph.database} icon={Database} />
              </>
            ) : (
              <p className="text-xs py-3 text-center" style={{ color: "var(--orbit-text-muted)" }}>Unavailable</p>
            )}
          </div>
          {/* Applications */}
          <div className="px-3 pb-1">
            <div className="px-1 py-2 flex items-center gap-2" style={{ borderBottom: "1px solid var(--orbit-border)" }}>
              <Globe className="h-3 w-3" style={{ color: "var(--orbit-text-muted)" }} />
              <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--orbit-text-muted)" }}>
                Applications{ph && <span className="ml-1.5 font-normal">({ph.applications.length})</span>}
              </span>
            </div>
            {phLoading ? (
              <div className="py-3 flex justify-center"><Loader2 className="h-4 w-4 animate-spin" style={{ color: "var(--orbit-text-muted)" }} /></div>
            ) : ph && ph.applications.length > 0 ? (
              ph.applications.map((app) => (
                <PhCheckRow key={app.name} check={app} icon={Globe} />
              ))
            ) : (
              <p className="text-xs py-3 text-center" style={{ color: "var(--orbit-text-muted)" }}>
                {phLoading ? "" : "No health check URLs configured"}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* ── ROW 3: Infrastructure + API & Service Quality side by side ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">

        {/* COL 1 — Infrastructure */}
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-widest px-1" style={{ color: "var(--orbit-text-muted)" }}>
            Infrastructure
          </p>
          <SectionCard title="Compute" icon={Server} to="/noc/infrastructure" health={caGroup?.health ?? "unknown"}>
            {infraLoading ? <><Skeleton /><Skeleton /></> : caGroup ? (
              caGroup.metrics.map((m) => (
                <MetricRow key={m.metricName} label={m.metricName.replace(/([A-Z])/g, " $1").trim()} value={fmtMetric(m.value, m.unit)} />
              ))
            ) : <p className="text-xs py-2 text-center" style={{ color: "var(--orbit-text-muted)" }}>No data</p>}
          </SectionCard>
          <SectionCard title="Database" icon={Cpu} to="/noc/infrastructure" health={dbGroup?.health ?? "unknown"}>
            {infraLoading ? <><Skeleton /><Skeleton /></> : dbGroup ? (
              dbGroup.metrics.slice(0, 4).map((m) => (
                <MetricRow key={m.metricName} label={m.metricName.replace(/_/g, " ")} value={fmtMetric(m.value, m.unit)} />
              ))
            ) : <p className="text-xs py-2 text-center" style={{ color: "var(--orbit-text-muted)" }}>No data</p>}
          </SectionCard>
          <SectionCard title="Network & Storage" icon={Network} to="/noc/infrastructure" health={netGroup?.health ?? "unknown"}>
            {infraLoading ? <><Skeleton /><Skeleton /></> : netGroup ? (
              netGroup.metrics.map((m) => (
                <MetricRow key={m.metricName} label={m.metricName} value={fmtMetric(m.value, m.unit)} />
              ))
            ) : <p className="text-xs py-2 text-center" style={{ color: "var(--orbit-text-muted)" }}>No data</p>}
          </SectionCard>
          {vpnGroups.map((vg) => (
            <SectionCard key={vg.name} title={vg.name} icon={Network} to="/noc/infrastructure" health={vg.health}>
              {infraLoading ? <><Skeleton /><Skeleton /></> : (
                vg.metrics.map((m) => (
                  <MetricRow key={m.metricName} label={m.metricName} value={fmtMetric(m.value, m.unit)} />
                ))
              )}
            </SectionCard>
          ))}
          {lbGroups.map((lb) => (
            <SectionCard key={lb.name} title={lb.name} icon={Network} to="/noc/infrastructure" health={lb.health}>
              {infraLoading ? <><Skeleton /><Skeleton /></> : (
                lb.metrics.map((m) => (
                  <MetricRow key={m.metricName} label={m.metricName} value={fmtMetric(m.value, m.unit)} />
                ))
              )}
            </SectionCard>
          ))}
        </div>

        {/* COL 2 — API + Incidents + UX */}
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-widest px-1" style={{ color: "var(--orbit-text-muted)" }}>
            API & Service Quality
          </p>
          <SectionCard title="API & Observability" icon={MonitorSmartphone} to="/noc/infrastructure" health={apiGroup?.health ?? "unknown"}>
            {infraLoading ? <><Skeleton /><Skeleton /></> : apiGroup ? (
              apiGroup.metrics.map((m) => (
                <MetricRow key={m.metricName} label={m.metricName.replace(/\//g, " / ")} value={fmtMetric(m.value, m.unit)} />
              ))
            ) : <p className="text-xs py-2 text-center" style={{ color: "var(--orbit-text-muted)" }}>No data</p>}
          </SectionCard>
          <SectionCard title="Azure Monitor Alerts" icon={Siren} to="/noc/incidents" health={criticalIncidents > 0 ? "critical" : activeIncidents > 0 ? "warning" : "healthy"}>
            {incLoading ? <><Skeleton /><Skeleton /></> : incidents ? (
              <>
                <MetricRow label="Active" value={String(incidents.metrics.activeCount)} color={incidents.metrics.activeCount > 0 ? "#F59E0B" : "#10B981"} />
                <MetricRow label="Critical" value={String(incidents.metrics.criticalCount)} color={incidents.metrics.criticalCount > 0 ? "#EF4444" : "#10B981"} />
                <MetricRow label="MTTA" value={incidents.metrics.mttaMinutes !== null ? `${Math.round(incidents.metrics.mttaMinutes)}m` : "—"} />
                <MetricRow label="MTTR" value={incidents.metrics.mttrMinutes !== null ? `${Math.round(incidents.metrics.mttrMinutes)}m` : "—"} />
              </>
            ) : <p className="text-xs py-2 text-center" style={{ color: "var(--orbit-text-muted)" }}>No data</p>}
          </SectionCard>
          <SectionCard title="UX & Error Rate" icon={Gauge} to="/noc/ux" health={uxScore === null ? "unknown" : uxScore >= 90 ? "healthy" : uxScore >= 70 ? "warning" : "critical"}>
            {uxLoading ? <><Skeleton /><Skeleton /></> : ux ? (
              <>
                <MetricRow label="UX Score" value={ux.overallScore !== null ? `${ux.overallScore}/100` : "—"} color={scoreColor(ux.overallScore)} />
                <MetricRow label="Error types (1h)" value={String(ux.errorDistribution.length)} />
                <MetricRow label="Synthetics passing" value={`${ux.syntheticResults.filter((s) => s.success).length}/${ux.syntheticResults.length}`} />
                <MetricRow label="Failing journeys" value={String(ux.failingJourneys.length)} color={ux.failingJourneys.length > 0 ? "#F59E0B" : "#10B981"} />
              </>
            ) : <p className="text-xs py-2 text-center" style={{ color: "var(--orbit-text-muted)" }}>No telemetry</p>}
          </SectionCard>
        </div>

      </div>
    </div>
  );
}
