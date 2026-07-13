import { Link } from "react-router-dom";
import {
  ShieldCheck,
  Siren,
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
  Zap,
} from "lucide-react";
import { useAuth } from "../auth/AuthProvider";
import { useInfrastructureMetrics, useIncidents, useUXSnapshot } from "../../services/noc";
import { usePlatformHealth, type HistoryPoint, type HealthStatus as PlatformHealthStatus } from "../../services/health";

// ── Constants ─────────────────────────────────────────────────────────────────

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

const PH_STATUS: Record<PlatformHealthStatus, { color: string; bg: string; label: string; icon: React.ElementType }> = {
  healthy:   { color: "#22c55e", bg: "rgba(34,197,94,0.12)",   label: "Healthy",   icon: CheckCircle2 },
  degraded:  { color: "#f59e0b", bg: "rgba(245,158,11,0.12)",  label: "Degraded",  icon: AlertTriangle },
  unhealthy: { color: "#ef4444", bg: "rgba(239,68,68,0.12)",   label: "Unhealthy", icon: XCircle },
  unknown:   { color: "#94a3b8", bg: "rgba(148,163,184,0.12)", label: "Unknown",   icon: HelpCircle },
};

// ── Small helpers ─────────────────────────────────────────────────────────────

function healthIcon(status: Health, cls = "h-4 w-4") {
  const c = H_COLOR[status];
  if (status === "healthy")  return <CheckCircle2  className={cls} style={{ color: c }} />;
  if (status === "warning")  return <AlertTriangle className={cls} style={{ color: c }} />;
  if (status === "critical") return <XCircle       className={cls} style={{ color: c }} />;
  return                            <HelpCircle    className={cls} style={{ color: c }} />;
}

function scoreColor(n: number | null) {
  if (n === null) return "#6B7280";
  return n >= 90 ? "#10B981" : n >= 70 ? "#F59E0B" : "#EF4444";
}

function fmt(v: number | null, unit: string) {
  if (v === null) return "—";
  if (unit === "%") return `${v.toFixed(1)}%`;
  if (unit === "ms") return `${Math.round(v)}ms`;
  if (unit === "count") return v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v.toLocaleString();
  return String(v);
}

// ── KPI strip tile ────────────────────────────────────────────────────────────

function KpiTile({ icon: Icon, label, value, sub, color, to }: {
  icon: React.ElementType; label: string; value: React.ReactNode;
  sub?: string; color: string; to: string;
}) {
  return (
    <Link to={to} style={{ textDecoration: "none" }}>
      <div
        className="rounded-2xl px-5 py-4 flex flex-col gap-2 h-full transition-opacity hover:opacity-80"
        style={{ background: "var(--orbit-bg-card)", border: `1px solid ${color}33` }}
      >
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--orbit-text-muted)" }}>{label}</span>
          <div className="rounded-lg p-1.5" style={{ background: `${color}18` }}>
            <Icon className="h-4 w-4" style={{ color }} />
          </div>
        </div>
        <span className="text-3xl font-bold tabular-nums leading-none" style={{ color }}>{value}</span>
        {sub && <span className="text-xs" style={{ color: "var(--orbit-text-muted)" }}>{sub}</span>}
        <div className="flex items-center gap-1 mt-auto pt-1" style={{ borderTop: "1px solid var(--orbit-border)" }}>
          <span className="text-[11px]" style={{ color: "var(--orbit-text-muted)" }}>View details</span>
          <ArrowRight className="h-3 w-3" style={{ color: "var(--orbit-text-muted)" }} />
        </div>
      </div>
    </Link>
  );
}

// ── Domain card (compact, no scroll) ─────────────────────────────────────────

function DomainCard({ title, icon: Icon, to, health, loading, children }: {
  title: string; icon: React.ElementType; to: string;
  health: Health; loading?: boolean; children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl overflow-hidden flex flex-col" style={{ background: "var(--orbit-bg-card)", border: `1px solid ${H_BORDER[health]}` }}>
      <Link to={to} style={{ textDecoration: "none" }}>
        <div className="flex items-center justify-between px-4 py-2.5 transition-opacity hover:opacity-80" style={{ background: H_BG[health], borderBottom: "1px solid var(--orbit-border)" }}>
          <div className="flex items-center gap-2">
            <Icon className="h-3.5 w-3.5" style={{ color: H_COLOR[health] }} />
            <span className="text-xs font-semibold" style={{ color: "var(--orbit-text-primary)" }}>{title}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-semibold capitalize" style={{ color: H_COLOR[health] }}>{health}</span>
            {healthIcon(health, "h-3.5 w-3.5")}
          </div>
        </div>
      </Link>
      <div className="p-3 flex-1">
        {loading ? (
          <div className="space-y-1.5">
            {[1,2,3].map(i => <div key={i} className="h-3 rounded animate-pulse" style={{ background: "var(--orbit-border)" }} />)}
          </div>
        ) : children}
      </div>
    </div>
  );
}

/** Two-column key=value chip grid inside a DomainCard */
function ChipGrid({ items }: { items: { label: string; value: string; color?: string }[] }) {
  return (
    <div className="grid grid-cols-2 gap-1.5">
      {items.map(({ label, value, color }) => (
        <div key={label} className="rounded-lg px-2.5 py-1.5" style={{ background: "var(--orbit-bg-page)", border: "1px solid var(--orbit-border)" }}>
          <p className="text-[10px] font-medium" style={{ color: "var(--orbit-text-muted)" }}>{label}</p>
          <p className="text-xs font-bold tabular-nums mt-0.5" style={{ color: color ?? "var(--orbit-text-primary)" }}>{value}</p>
        </div>
      ))}
    </div>
  );
}

// ── Platform health check row ─────────────────────────────────────────────────

function PhRow({ check, icon: Icon }: {
  check: { name: string; status: PlatformHealthStatus; latencyMs?: number; timedOut?: boolean; history: HistoryPoint[] };
  icon: React.ElementType;
}) {
  const cfg = PH_STATUS[check.status];
  const SI = cfg.icon;
  return (
    <div className="flex items-center justify-between py-2" style={{ borderBottom: "1px solid var(--orbit-border)" }}>
      <div className="flex items-center gap-2 min-w-0">
        <Icon className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--orbit-text-muted)" }} />
        <span className="text-xs font-medium truncate" style={{ color: "var(--orbit-text-primary)" }}>{check.name}</span>
      </div>
      <div className="flex items-center gap-2 shrink-0 ml-2">
        <span className="flex gap-0.5">
          {check.history.map((p, i) => (
            <span key={i} className="inline-block rounded-sm" style={{ width: 5, height: 10, background: PH_STATUS[p.status].color, opacity: 0.85 }} />
          ))}
        </span>
        {check.latencyMs !== undefined && (
          <span className="text-[11px] tabular-nums w-12 text-right" style={{ color: "var(--orbit-text-muted)" }}>{check.latencyMs}ms</span>
        )}
        {check.timedOut && <Clock className="h-3 w-3" style={{ color: "#ef4444" }} />}
        <div className="flex items-center gap-1 rounded-full px-2 py-0.5" style={{ background: cfg.bg }}>
          <SI className="h-3 w-3" style={{ color: cfg.color }} />
          <span className="text-[11px] font-semibold" style={{ color: cfg.color }}>{cfg.label}</span>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function DashboardPage() {
  const { user } = useAuth();
  void user;

  const { data: infra, isLoading: infraLoading } = useInfrastructureMetrics();
  const { data: incidents, isLoading: incLoading } = useIncidents();
  const { data: ux, isLoading: uxLoading } = useUXSnapshot();
  const { data: ph, isLoading: phLoading, refetch: phRefetch, isFetching: phFetching } = usePlatformHealth();

  // ── Derived ──────────────────────────────────────────────────────────────────
  const overallHealth: Health = infra?.overallHealth ?? "unknown";
  const criticalCount =
    (infra?.containerApps.filter(g => g.health === "critical").length ?? 0) +
    (infra?.database.filter(g => g.health === "critical").length ?? 0) +
    (infra?.network.filter(g => g.health === "critical").length ?? 0) +
    (infra?.api.filter(g => g.health === "critical").length ?? 0);

  const activeIncidents   = incidents?.metrics.activeCount   ?? 0;
  const criticalIncidents = incidents?.metrics.criticalCount ?? 0;
  const uxScore           = ux?.overallScore ?? null;

  const caGroup   = infra?.containerApps[0];
  const dbGroup   = infra?.database[0];
  const netGroup  = infra?.network[0];
  const vpnGroups = infra?.vpn ?? [];
  const lbGroups  = infra?.loadBalancers ?? [];
  const apiGroup  = infra?.api[0];

  const phOverall = ph?.overall ?? "unknown";
  const phCfg     = PH_STATUS[phOverall];

  // All-systems banner label
  const bannerLabel =
    overallHealth === "healthy"  ? "All Systems Operational" :
    overallHealth === "warning"  ? "Degraded Performance"    :
    overallHealth === "critical" ? "Critical Issues Detected" :
    "Awaiting Data";

  return (
    <div className="space-y-4">

      {/* ── ZONE 1: Header + status banner ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "var(--orbit-text-primary)" }}>Enterprise Overview</h1>
          <p className="text-xs mt-0.5" style={{ color: "var(--orbit-text-muted)" }}>
            Kinisis Labs platform · live telemetry
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-full px-4 py-2" style={{ background: H_BG[overallHealth], border: `1px solid ${H_BORDER[overallHealth]}` }}>
          {healthIcon(overallHealth)}
          <span className="text-sm font-semibold" style={{ color: H_COLOR[overallHealth] }}>{bannerLabel}</span>
        </div>
      </div>

      {/* ── ZONE 2: KPI strip (4 tiles, fixed height) ── */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        <KpiTile
          icon={ShieldCheck} label="System Health" to="/noc/infrastructure"
          color={H_COLOR[overallHealth]}
          value={infraLoading ? <Loader2 className="h-5 w-5 animate-spin inline" /> : overallHealth === "healthy" ? "100" : overallHealth === "warning" ? "72" : overallHealth === "critical" ? "35" : "—"}
          sub={infraLoading ? undefined : `${criticalCount} critical resource${criticalCount !== 1 ? "s" : ""}`}
        />
        <KpiTile
          icon={Siren} label="Active Incidents" to="/noc/incidents"
          color={criticalIncidents > 0 ? "#EF4444" : activeIncidents > 0 ? "#F59E0B" : "#10B981"}
          value={incLoading ? <Loader2 className="h-5 w-5 animate-spin inline" /> : activeIncidents}
          sub={incLoading ? undefined : `${criticalIncidents} critical`}
        />
        <KpiTile
          icon={Gauge} label="UX Score" to="/noc/ux"
          color={scoreColor(uxScore)}
          value={uxLoading ? <Loader2 className="h-5 w-5 animate-spin inline" /> : uxScore !== null ? uxScore : "—"}
          sub={uxLoading ? undefined : uxScore !== null ? `out of 100` : "No telemetry"}
        />
        <KpiTile
          icon={ShieldCheck} label="Security" to="/noc/security"
          color="#4361F1"
          value="—"
          sub="View posture →"
        />
      </div>

      {/* ── ZONE 3: Platform Health rail (compact, never expands) ── */}
      <div className="rounded-2xl overflow-hidden" style={{ background: "var(--orbit-bg-card)", border: "1px solid var(--orbit-border)" }}>
        <div className="flex items-center justify-between px-4 py-2.5" style={{ borderBottom: "1px solid var(--orbit-border)", background: "var(--orbit-bg-page)" }}>
          <div className="flex items-center gap-3">
            <Activity className="h-3.5 w-3.5" style={{ color: "var(--orbit-text-muted)" }} />
            <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--orbit-text-muted)" }}>Platform Health</span>
            <div className="flex items-center gap-1.5 rounded-full px-2.5 py-0.5" style={{ background: phCfg.bg }}>
              <phCfg.icon className="h-3 w-3" style={{ color: phCfg.color }} />
              <span className="text-xs font-semibold" style={{ color: phCfg.color }}>{phCfg.label}</span>
            </div>
            {ph && (
              <span className="text-[11px]" style={{ color: "var(--orbit-text-muted)" }}>
                {new Date(ph.checkedAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </span>
            )}
          </div>
          <button onClick={() => void phRefetch()} disabled={phFetching} className="flex items-center gap-1 text-xs disabled:opacity-40" style={{ color: "var(--orbit-text-muted)" }}>
            <RefreshCw className={`h-3 w-3 ${phFetching ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x" style={{ borderColor: "var(--orbit-border)" }}>
          <div className="px-4 pb-2">
            <div className="flex items-center gap-2 py-2" style={{ borderBottom: "1px solid var(--orbit-border)" }}>
              <Server className="h-3 w-3" style={{ color: "var(--orbit-text-muted)" }} />
              <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--orbit-text-muted)" }}>Core Services</span>
            </div>
            {phLoading ? (
              <div className="py-3 flex justify-center"><Loader2 className="h-4 w-4 animate-spin" style={{ color: "var(--orbit-text-muted)" }} /></div>
            ) : ph ? (
              <>
                <PhRow check={ph.orbit} icon={Server} />
                <PhRow check={ph.database} icon={Database} />
              </>
            ) : (
              <p className="text-xs py-3 text-center" style={{ color: "var(--orbit-text-muted)" }}>Unavailable</p>
            )}
          </div>
          <div className="px-4 pb-2">
            <div className="flex items-center gap-2 py-2" style={{ borderBottom: "1px solid var(--orbit-border)" }}>
              <Globe className="h-3 w-3" style={{ color: "var(--orbit-text-muted)" }} />
              <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--orbit-text-muted)" }}>
                Applications{ph ? ` (${ph.applications.length})` : ""}
              </span>
            </div>
            {phLoading ? (
              <div className="py-3 flex justify-center"><Loader2 className="h-4 w-4 animate-spin" style={{ color: "var(--orbit-text-muted)" }} /></div>
            ) : ph && ph.applications.length > 0 ? (
              ph.applications.map(app => <PhRow key={app.name} check={app} icon={Globe} />)
            ) : (
              <p className="text-xs py-3 text-center" style={{ color: "var(--orbit-text-muted)" }}>No health check URLs configured</p>
            )}
          </div>
        </div>
      </div>

      {/* ── ZONE 4: Domain cards — 3 columns, all same height ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">

        {/* Compute */}
        <DomainCard title="Compute" icon={Server} to="/noc/infrastructure" health={caGroup?.health ?? "unknown"} loading={infraLoading}>
          <ChipGrid items={caGroup?.metrics.map(m => ({ label: m.metricName.replace(/([A-Z])/g, " $1").trim(), value: fmt(m.value, m.unit) })) ?? [{ label: "Status", value: "No data" }]} />
        </DomainCard>

        {/* Database */}
        <DomainCard title="Database" icon={Cpu} to="/noc/infrastructure" health={dbGroup?.health ?? "unknown"} loading={infraLoading}>
          <ChipGrid items={dbGroup?.metrics.slice(0, 4).map(m => ({ label: m.metricName.replace(/_/g, " "), value: fmt(m.value, m.unit), color: m.metricName === "cpu_percent" && (m.value ?? 0) > 80 ? "#ef4444" : undefined })) ?? [{ label: "Status", value: "No data" }]} />
        </DomainCard>

        {/* Network & Storage */}
        <DomainCard title="Network & Storage" icon={Network} to="/noc/infrastructure" health={netGroup?.health ?? "unknown"} loading={infraLoading}>
          <ChipGrid items={netGroup?.metrics.slice(0, 4).map(m => ({ label: m.metricName, value: fmt(m.value, m.unit) })) ?? [{ label: "Status", value: "No data" }]} />
        </DomainCard>

        {/* Virtual Networks */}
        <DomainCard title="Virtual Networks" icon={Network} to="/noc/infrastructure" health={vpnGroups.length ? (vpnGroups.some(v => v.health === "critical") ? "critical" : vpnGroups.some(v => v.health === "warning") ? "warning" : vpnGroups.every(v => v.health === "healthy") ? "healthy" : "unknown") : "unknown"} loading={infraLoading}>
          {vpnGroups.length > 0 ? (
            <div className="space-y-1.5">
              {vpnGroups.map(vg => (
                <div key={vg.name} className="flex items-center justify-between rounded-lg px-2.5 py-1.5" style={{ background: "var(--orbit-bg-page)", border: "1px solid var(--orbit-border)" }}>
                  <span className="text-xs font-medium truncate" style={{ color: "var(--orbit-text-primary)" }}>{vg.name}</span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="text-[11px] font-semibold capitalize" style={{ color: H_COLOR[vg.health] }}>{vg.health}</span>
                    {healthIcon(vg.health, "h-3.5 w-3.5")}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs py-2 text-center" style={{ color: "var(--orbit-text-muted)" }}>No VNETs configured</p>
          )}
        </DomainCard>

        {/* Load Balancers */}
        <DomainCard title="Load Balancers" icon={Zap} to="/noc/infrastructure" health={lbGroups.length ? (lbGroups.some(l => l.health === "critical") ? "critical" : lbGroups.some(l => l.health === "warning") ? "warning" : lbGroups.every(l => l.health === "healthy") ? "healthy" : "unknown") : "unknown"} loading={infraLoading}>
          {lbGroups.length > 0 ? (
            <div className="space-y-1.5">
              {lbGroups.map(lb => {
                const byteM = lb.metrics.find(m => m.metricName === "ByteCount");
                const vip   = lb.metrics.find(m => m.metricName === "VipAvailability");
                return (
                  <div key={lb.name} className="rounded-lg px-2.5 py-1.5" style={{ background: "var(--orbit-bg-page)", border: "1px solid var(--orbit-border)" }}>
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium truncate" style={{ color: "var(--orbit-text-primary)" }}>{lb.name}</span>
                      <span className="text-[11px] font-semibold capitalize shrink-0 ml-2" style={{ color: H_COLOR[lb.health] }}>{lb.health}</span>
                    </div>
                    <div className="flex gap-3 mt-1">
                      {vip && <span className="text-[11px]" style={{ color: "var(--orbit-text-muted)" }}>VIP {fmt(vip.value, vip.unit)}</span>}
                      {byteM && <span className="text-[11px]" style={{ color: "var(--orbit-text-muted)" }}>{fmt(byteM.value, byteM.unit)} bytes</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-xs py-2 text-center" style={{ color: "var(--orbit-text-muted)" }}>No LBs configured</p>
          )}
        </DomainCard>

        {/* Incidents & UX */}
        <DomainCard
          title="Incidents & UX"
          icon={MonitorSmartphone}
          to="/noc/incidents"
          health={criticalIncidents > 0 ? "critical" : activeIncidents > 0 ? "warning" : uxScore !== null && uxScore < 70 ? "warning" : "healthy"}
          loading={incLoading && uxLoading}
        >
          <ChipGrid items={[
            { label: "Active Incidents", value: incLoading ? "…" : String(activeIncidents), color: activeIncidents > 0 ? "#F59E0B" : "#10B981" },
            { label: "Critical",         value: incLoading ? "…" : String(criticalIncidents), color: criticalIncidents > 0 ? "#EF4444" : "#10B981" },
            { label: "MTTA",             value: incLoading ? "…" : incidents?.metrics.mttaMinutes != null ? `${Math.round(incidents.metrics.mttaMinutes)}m` : "—" },
            { label: "UX Score",         value: uxLoading  ? "…" : uxScore !== null ? `${uxScore}/100` : "—", color: scoreColor(uxScore) },
          ]} />
        </DomainCard>

      </div>
    </div>
  );
}
