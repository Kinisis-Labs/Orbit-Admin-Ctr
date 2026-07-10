import { Activity, CheckCircle2, AlertTriangle, XCircle, RefreshCw, Database, Server, Globe, Loader2, Clock } from "lucide-react";
import { usePlatformHealth, type HealthStatus, type ServiceCheck, type HistoryPoint } from "../../services/health";

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<HealthStatus, { icon: React.ElementType; color: string; bg: string; label: string }> = {
  healthy: { icon: CheckCircle2, color: "#22c55e", bg: "rgba(34,197,94,0.12)", label: "Healthy" },
  degraded: { icon: AlertTriangle, color: "#f59e0b", bg: "rgba(245,158,11,0.12)", label: "Degraded" },
  unhealthy: { icon: XCircle, color: "#ef4444", bg: "rgba(239,68,68,0.12)", label: "Unhealthy" },
  unknown: { icon: AlertTriangle, color: "#94a3b8", bg: "rgba(148,163,184,0.12)", label: "Unknown" },
};

const STATUS_DOT: Record<HealthStatus, string> = {
  healthy: "#22c55e",
  degraded: "#f59e0b",
  unhealthy: "#ef4444",
  unknown: "#94a3b8",
};

const card: React.CSSProperties = {
  background: "var(--orbit-bg-card)",
  border: "1px solid var(--orbit-border)",
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

// ── History Dots ──────────────────────────────────────────────────────────────

function HistoryDots({ history }: { history: HistoryPoint[] }) {
  if (!history.length) return <span style={{ color: "var(--orbit-text-muted)" }}>—</span>;
  return (
    <span className="flex items-center gap-0.5" title="Last 10 checks (oldest → newest)">
      {history.map((p, i) => (
        <span
          key={i}
          className="inline-block rounded-sm"
          style={{ width: 8, height: 14, background: STATUS_DOT[p.status], opacity: 0.85 }}
          title={`${p.status} · ${p.latencyMs}ms · ${fmtTime(p.checkedAt)}`}
        />
      ))}
    </span>
  );
}

// ── Overall Status Banner ─────────────────────────────────────────────────────

function OverallBanner({ status, checkedAt }: { status: HealthStatus; checkedAt: string }) {
  const cfg = STATUS_CONFIG[status];
  const Icon = cfg.icon;
  return (
    <div className="flex items-center gap-4 rounded-xl px-6 py-5" style={{ background: cfg.bg, border: `1px solid ${cfg.color}33` }}>
      <Icon className="h-8 w-8 shrink-0" style={{ color: cfg.color }} />
      <div>
        <p className="text-lg font-bold" style={{ color: cfg.color }}>Platform {cfg.label}</p>
        <p className="text-xs mt-0.5" style={{ color: "var(--orbit-text-muted)" }}>Last checked {fmtDate(checkedAt)}</p>
      </div>
    </div>
  );
}

// ── Service Check Card ────────────────────────────────────────────────────────

function CheckCard({ check, icon: CardIcon }: { check: ServiceCheck; icon: React.ElementType }) {
  const cfg = STATUS_CONFIG[check.status];
  const StatusIcon = cfg.icon;
  return (
    <div className="rounded-xl p-5" style={card}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="rounded-lg p-2" style={{ background: "var(--orbit-bg-page)" }}>
            <CardIcon className="h-4 w-4" style={{ color: "var(--orbit-text-muted)" }} />
          </div>
          <div>
            <p className="text-sm font-semibold" style={{ color: "var(--orbit-text-primary)" }}>{check.name}</p>
            {check.message && (
              <p className="text-xs mt-0.5" style={{ color: check.status === "healthy" ? "var(--orbit-text-muted)" : "#f59e0b" }}>{check.message}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1.5 rounded-full px-2.5 py-1" style={{ background: cfg.bg }}>
          <StatusIcon className="h-3.5 w-3.5" style={{ color: cfg.color }} />
          <span className="text-xs font-medium" style={{ color: cfg.color }}>{cfg.label}</span>
        </div>
      </div>
      <div className="mt-3 pt-3 flex flex-wrap gap-x-5 gap-y-1" style={{ borderTop: "1px solid var(--orbit-border)" }}>
        {check.latencyMs !== undefined && (
          <span className="text-xs" style={{ color: "var(--orbit-text-muted)" }}>
            Latency: <span style={{ color: "var(--orbit-text-secondary)" }}>{check.latencyMs}ms</span>
          </span>
        )}
        {check.httpStatus !== undefined && (
          <span className="text-xs" style={{ color: "var(--orbit-text-muted)" }}>
            HTTP: <span style={{ color: check.httpStatus >= 400 ? "#ef4444" : "var(--orbit-text-secondary)" }}>{check.httpStatus}</span>
          </span>
        )}
        {check.timedOut && (
          <span className="flex items-center gap-1 text-xs" style={{ color: "#ef4444" }}>
            <Clock className="h-3 w-3" /> Timed out
          </span>
        )}
        {check.history.length > 0 && (
          <span className="flex items-center gap-1.5 text-xs" style={{ color: "var(--orbit-text-muted)" }}>
            History: <HistoryDots history={check.history} />
          </span>
        )}
      </div>
    </div>
  );
}

// ── App Checks Table ──────────────────────────────────────────────────────────

function AppChecksTable({ checks }: { checks: ServiceCheck[] }) {
  if (!checks.length) {
    return (
      <div className="rounded-xl p-8 text-center" style={card}>
        <Globe className="mx-auto h-8 w-8 mb-2 opacity-20" style={{ color: "var(--orbit-text-muted)" }} />
        <p className="text-sm" style={{ color: "var(--orbit-text-muted)" }}>
          No applications with health check URLs registered.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl overflow-hidden" style={card}>
      <table className="w-full text-xs">
        <thead>
          <tr style={{ borderBottom: "1px solid var(--orbit-border)", background: "var(--orbit-bg-page)" }}>
            {["Application", "Status", "HTTP", "Latency", "Timeout", "History (oldest→newest)", "Checked At"].map((h) => (
              <th key={h} className="px-4 py-3 text-left font-semibold uppercase tracking-wider" style={{ color: "var(--orbit-text-muted)" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {checks.map((c, i) => {
            const cfg = STATUS_CONFIG[c.status];
            const StatusIcon = cfg.icon;
            return (
              <tr key={c.name} style={{ borderBottom: i < checks.length - 1 ? "1px solid var(--orbit-border)" : undefined }}>
                <td className="px-4 py-3 font-medium" style={{ color: "var(--orbit-text-primary)" }}>{c.name}</td>
                <td className="px-4 py-3">
                  <span className="flex items-center gap-1.5">
                    <StatusIcon className="h-3.5 w-3.5" style={{ color: cfg.color }} />
                    <span style={{ color: cfg.color }}>{cfg.label}</span>
                  </span>
                  {c.message && (
                    <p className="mt-0.5 text-xs" style={{ color: "#f59e0b" }}>{c.message}</p>
                  )}
                </td>
                <td className="px-4 py-3 tabular-nums" style={{ color: c.httpStatus !== undefined && c.httpStatus >= 400 ? "#ef4444" : "var(--orbit-text-secondary)" }}>
                  {c.httpStatus ?? "—"}
                </td>
                <td className="px-4 py-3 tabular-nums" style={{ color: "var(--orbit-text-secondary)" }}>
                  {c.latencyMs !== undefined ? `${c.latencyMs}ms` : "—"}
                </td>
                <td className="px-4 py-3">
                  {c.timedOut
                    ? <span className="flex items-center gap-1" style={{ color: "#ef4444" }}><Clock className="h-3 w-3" /> Yes</span>
                    : <span style={{ color: "var(--orbit-text-muted)" }}>No</span>}
                </td>
                <td className="px-4 py-3"><HistoryDots history={c.history ?? []} /></td>
                <td className="px-4 py-3" style={{ color: "var(--orbit-text-muted)" }}>{fmtDate(c.checkedAt)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function HealthPage() {
  const { data, isLoading, error, refetch, isFetching } = usePlatformHealth();

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "var(--orbit-text-primary)" }}>Platform Health</h1>
          <p className="text-sm mt-1" style={{ color: "var(--orbit-text-muted)" }}>Live health status — refreshes every 30 seconds</p>
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
          <Loader2 className="h-5 w-5 animate-spin" /><span className="text-sm">Running health checks…</span>
        </div>
      ) : error ? (
        <div className="rounded-xl p-4 text-sm" style={{ color: "var(--orbit-danger, #ef4444)", border: "1px solid var(--orbit-danger, #ef4444)", background: "var(--orbit-bg-card)" }}>
          {error.message}
        </div>
      ) : data ? (
        <>
          <OverallBanner status={data.overall} checkedAt={data.checkedAt} />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <CheckCard check={data.orbit} icon={Server} />
            <CheckCard check={data.database} icon={Database} />
          </div>

          <div>
            <h2 className="text-sm font-semibold mb-3" style={{ color: "var(--orbit-text-muted)" }}>
              REGISTERED APPLICATIONS
              <span className="ml-2 text-xs font-normal">({data.applications.length} checked)</span>
            </h2>
            <AppChecksTable checks={data.applications} />
          </div>
        </>
      ) : null}
    </div>
  );
}
