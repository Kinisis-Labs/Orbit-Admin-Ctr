import { useState } from "react";
import {
  ShieldAlert,
  RefreshCw,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Info,
  Check,
  ShieldCheck,
  ChevronDown,
  ChevronRight,
  Filter,
} from "lucide-react";
import {
  useSecurityEvents,
  useAcknowledgeSecurityEvent,
  useResolveSecurityEvent,
  type SecurityEvent,
} from "../../services/noc";

// ── Helpers ───────────────────────────────────────────────────────────────────

const SEV_ORDER = ["critical", "error", "warning", "informational", "info", "unknown"];

function sevColor(s: string) {
  if (s === "critical") return "#ef4444";
  if (s === "error") return "#f97316";
  if (s === "warning") return "#f59e0b";
  if (s === "informational" || s === "info") return "#3b82f6";
  return "var(--orbit-text-muted)";
}
function sevBg(s: string) {
  if (s === "critical") return "rgba(239,68,68,0.1)";
  if (s === "error") return "rgba(249,115,22,0.1)";
  if (s === "warning") return "rgba(245,158,11,0.1)";
  if (s === "informational" || s === "info") return "rgba(59,130,246,0.1)";
  return "var(--orbit-bg-page)";
}

function isInfoSeverity(e: SecurityEvent): boolean {
  return e.severity === "info" || e.severity === "informational";
}

function getEventStatus(e: SecurityEvent): "active" | "acknowledged" | "resolved" {
  if (e.acknowledgedBy?.startsWith("resolved:")) return "resolved";
  if (e.acknowledged) return "acknowledged";
  if (isInfoSeverity(e)) return "resolved";
  return "active";
}

function SummaryTile({ label, value, color, sub }: { label: string; value: number; color?: string; sub?: string }) {
  return (
    <div
      className="rounded-xl px-5 py-4 flex flex-col gap-1"
      style={{ background: "var(--orbit-bg-card)", border: "1px solid var(--orbit-border)" }}
    >
      <span className="text-xs font-medium" style={{ color: "var(--orbit-text-muted)" }}>{label}</span>
      <span className="text-3xl font-bold tabular-nums" style={{ color: color ?? "var(--orbit-text-primary)" }}>
        {value}
      </span>
      {sub && <span className="text-xs" style={{ color: "var(--orbit-text-muted)" }}>{sub}</span>}
    </div>
  );
}

function SevBadge({ severity }: { severity: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold uppercase tracking-wide"
      style={{ color: sevColor(severity), background: sevBg(severity) }}
    >
      {(severity === "critical" || severity === "error") && <XCircle className="h-3 w-3" />}
      {severity === "warning" && <AlertTriangle className="h-3 w-3" />}
      {(severity === "informational" || severity === "info") && <Info className="h-3 w-3" />}
      {severity}
    </span>
  );
}

function StatusBadge({ status }: { status: "active" | "acknowledged" | "resolved" }) {
  const cfg = {
    active: { color: "#ef4444", label: "Active" },
    acknowledged: { color: "#f59e0b", label: "Acknowledged" },
    resolved: { color: "#22c55e", label: "Resolved" },
  }[status];
  return (
    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold"
      style={{ color: cfg.color, background: `${cfg.color}18` }}>
      {status === "resolved" ? <ShieldCheck className="h-3 w-3" /> : status === "acknowledged" ? <Check className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
      {cfg.label}
    </span>
  );
}

function EventRow({
  event,
  onAcknowledge,
  onResolve,
}: {
  event: SecurityEvent;
  onAcknowledge: (id: string) => void;
  onResolve: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const status = getEventStatus(event);
  const isAudit = event.source === "orbit-audit";
  const isAutoResolved = isInfoSeverity(event) && !event.acknowledged;

  return (
    <>
      <tr
        onClick={() => setExpanded((x) => !x)}
        className="cursor-pointer"
        style={{
          borderBottom: expanded ? "none" : "1px solid var(--orbit-border)",
          opacity: status === "resolved" ? 0.55 : 1,
          background: expanded ? "var(--orbit-bg-page)" : undefined,
        }}
      >
        <td className="px-4 py-3 w-4">
          {expanded
            ? <ChevronDown className="h-3.5 w-3.5" style={{ color: "var(--orbit-text-muted)" }} />
            : <ChevronRight className="h-3.5 w-3.5" style={{ color: "var(--orbit-text-muted)" }} />}
        </td>
        <td className="px-3 py-3"><SevBadge severity={event.severity} /></td>
        <td className="px-3 py-3">
          <span className="text-xs font-mono" style={{ color: "var(--orbit-text-muted)" }}>{event.source}</span>
        </td>
        <td className="px-3 py-3 text-sm" style={{ color: "var(--orbit-text-secondary)", maxWidth: 340 }}>
          <p className="truncate">{event.detail}</p>
          {event.user && (
            <p className="text-xs mt-0.5" style={{ color: "var(--orbit-text-muted)" }}>
              {event.user}{event.ip ? ` · ${event.ip}` : ""}
            </p>
          )}
        </td>
        <td className="px-3 py-3 text-xs whitespace-nowrap" style={{ color: "var(--orbit-text-muted)" }}>
          {new Date(event.createdAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
        </td>
        <td className="px-3 py-3"><StatusBadge status={status} /></td>
        <td className="px-3 py-3 text-right" onClick={(e) => e.stopPropagation()}>
          {!isAudit && !isAutoResolved && status === "active" && (
            <div className="flex items-center gap-1 justify-end">
              <button
                onClick={() => onAcknowledge(event.id)}
                className="rounded px-2 py-1 text-xs font-medium"
                style={{ background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.3)", color: "#f59e0b" }}
              >
                <Check className="h-3 w-3 inline mr-1" />Ack
              </button>
              <button
                onClick={() => onResolve(event.id)}
                className="rounded px-2 py-1 text-xs font-medium"
                style={{ background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.3)", color: "#22c55e" }}
              >
                <ShieldCheck className="h-3 w-3 inline mr-1" />Resolve
              </button>
            </div>
          )}
          {!isAudit && status === "acknowledged" && (
            <button
              onClick={() => onResolve(event.id)}
              className="rounded px-2 py-1 text-xs font-medium"
              style={{ background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.3)", color: "#22c55e" }}
            >
              <ShieldCheck className="h-3 w-3 inline mr-1" />Resolve
            </button>
          )}
        </td>
      </tr>
      {expanded && (
        <tr style={{ borderBottom: "1px solid var(--orbit-border)", background: "var(--orbit-bg-page)" }}>
          <td colSpan={7} className="px-6 py-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
              <div>
                <p className="font-semibold mb-1" style={{ color: "var(--orbit-text-muted)" }}>Detail</p>
                <p style={{ color: "var(--orbit-text-secondary)" }}>{event.detail}</p>
              </div>
              {event.user && (
                <div>
                  <p className="font-semibold mb-1" style={{ color: "var(--orbit-text-muted)" }}>User</p>
                  <p style={{ color: "var(--orbit-text-secondary)" }}>{event.user}</p>
                </div>
              )}
              {event.ip && (
                <div>
                  <p className="font-semibold mb-1" style={{ color: "var(--orbit-text-muted)" }}>IP Address</p>
                  <p className="font-mono" style={{ color: "var(--orbit-text-secondary)" }}>{event.ip}</p>
                </div>
              )}
              <div>
                <p className="font-semibold mb-1" style={{ color: "var(--orbit-text-muted)" }}>Event Type</p>
                <p className="font-mono" style={{ color: "var(--orbit-text-secondary)" }}>{event.type}</p>
              </div>
              <div>
                <p className="font-semibold mb-1" style={{ color: "var(--orbit-text-muted)" }}>Fired At</p>
                <p style={{ color: "var(--orbit-text-secondary)" }}>
                  {new Date(event.createdAt).toLocaleString()}
                </p>
              </div>
              {event.acknowledgedAt && (
                <div>
                  <p className="font-semibold mb-1" style={{ color: "var(--orbit-text-muted)" }}>
                    {status === "resolved" ? "Resolved At" : "Acknowledged At"}
                  </p>
                  <p style={{ color: "var(--orbit-text-secondary)" }}>
                    {new Date(event.acknowledgedAt).toLocaleString()}
                  </p>
                </div>
              )}
              {event.acknowledgedBy && (
                <div>
                  <p className="font-semibold mb-1" style={{ color: "var(--orbit-text-muted)" }}>
                    {status === "resolved" ? "Resolved By" : "Acknowledged By"}
                  </p>
                  <p style={{ color: "var(--orbit-text-secondary)" }}>
                    {event.acknowledgedBy.replace("resolved:", "")}
                  </p>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

type TabKey = "active" | "acknowledged" | "resolved" | "all";

export function SecurityDashboard() {
  const { data, isLoading, error, refetch, isFetching, dataUpdatedAt } = useSecurityEvents();
  const { mutate: acknowledge } = useAcknowledgeSecurityEvent();
  const { mutate: resolve } = useResolveSecurityEvent();

  const [tab, setTab] = useState<TabKey>("active");
  const [sevFilter, setSevFilter] = useState<string>("all");
  const [srcFilter, setSrcFilter] = useState<string>("all");

  const lastUpdated = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : null;

  const allEvents = [...(data?.securityEvents ?? []), ...(data?.auditEvents ?? [])].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  const sources = Array.from(new Set(allEvents.map((e) => e.source)));

  const filteredEvents = allEvents.filter((e) => {
    const status = getEventStatus(e);
    const tabMatch =
      tab === "all" ? true :
      tab === "active" ? status === "active" :
      tab === "acknowledged" ? status === "acknowledged" :
      status === "resolved";
    const sevMatch = sevFilter === "all" || e.severity === sevFilter;
    const srcMatch = srcFilter === "all" || e.source === srcFilter;
    return tabMatch && sevMatch && srcMatch;
  });

  const counts = {
    active: allEvents.filter((e) => getEventStatus(e) === "active").length,
    acknowledged: allEvents.filter((e) => getEventStatus(e) === "acknowledged").length,
    resolved: allEvents.filter((e) => getEventStatus(e) === "resolved").length,
    all: allEvents.length,
  };

  const sevCounts = SEV_ORDER.reduce<Record<string, number>>((acc, s) => {
    acc[s] = allEvents.filter((e) => e.severity === s).length;
    return acc;
  }, {});

  const TABS: { key: TabKey; label: string }[] = [
    { key: "active", label: "Active" },
    { key: "acknowledged", label: "Acknowledged" },
    { key: "resolved", label: "Resolved" },
    { key: "all", label: "All Events" },
  ];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "var(--orbit-text-primary)" }}>Security</h1>
          <p className="text-sm mt-1" style={{ color: "var(--orbit-text-muted)" }}>
            Entra sign-in logs, security events, Orbit audit · 24h window · auto-refreshes every 60s
            {lastUpdated && <span className="ml-2">· Last updated {lastUpdated}</span>}
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
          <span className="text-sm">Fetching security events…</span>
        </div>
      ) : error ? (
        <div className="rounded-xl p-4 text-sm"
          style={{ color: "#ef4444", border: "1px solid #ef444433", background: "var(--orbit-bg-card)" }}>
          {error.message}
        </div>
      ) : data ? (
        <>
          {!data.graphConfigured && (
            <div className="flex items-start gap-3 rounded-xl px-4 py-3 text-sm"
              style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.3)", color: "#f59e0b" }}>
              <Info className="h-4 w-4 mt-0.5 shrink-0" />
              <span>
                Microsoft Graph not configured — set{" "}
                <code className="font-mono text-xs">AZURE_TENANT_ID</code>,{" "}
                <code className="font-mono text-xs">AZURE_CLIENT_ID</code>, and{" "}
                <code className="font-mono text-xs">AZURE_CLIENT_SECRET</code> (or Managed Identity) to
                enable Entra sign-in telemetry. Showing Orbit audit events only.
              </span>
            </div>
          )}

          {/* Sign-in KPI tiles */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <SummaryTile label="Total Sign-ins (24h)" value={data.signInSummary.totalSignIns24h} />
            <SummaryTile
              label="Failed Sign-ins (24h)"
              value={data.signInSummary.failedSignIns24h}
              color={data.signInSummary.failedSignIns24h > 0 ? "#f59e0b" : undefined}
            />
            <SummaryTile
              label="MFA Failures (24h)"
              value={data.signInSummary.mfaFailureCount}
              color={data.signInSummary.mfaFailureCount > 0 ? "#ef4444" : undefined}
            />
            <SummaryTile
              label="Active Security Events"
              value={counts.active}
              color={counts.active > 0 ? "#ef4444" : undefined}
              sub={counts.active > 0 ? "Require action" : "All clear"}
            />
          </div>

          {/* Severity breakdown */}
          {allEvents.length > 0 && (
            <div className="rounded-xl px-5 py-4 flex flex-wrap items-center gap-4"
              style={{ background: "var(--orbit-bg-card)", border: "1px solid var(--orbit-border)" }}>
              <span className="text-xs font-semibold mr-2" style={{ color: "var(--orbit-text-muted)" }}>
                By Severity
              </span>
              {["critical", "error", "warning", "informational", "info"].map((s) => {
                const cnt = sevCounts[s] ?? 0;
                if (cnt === 0) return null;
                return (
                  <button
                    key={s}
                    onClick={() => setSevFilter(sevFilter === s ? "all" : s)}
                    className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition-opacity"
                    style={{
                      color: sevColor(s),
                      background: sevBg(s),
                      outline: sevFilter === s ? `2px solid ${sevColor(s)}` : undefined,
                      opacity: sevFilter !== "all" && sevFilter !== s ? 0.4 : 1,
                    }}
                  >
                    {cnt} {s}
                  </button>
                );
              })}
            </div>
          )}

          {/* Recent sign-ins */}
          {data.recentSignIns.length > 0 && (
            <div className="rounded-xl overflow-hidden"
              style={{ background: "var(--orbit-bg-card)", border: "1px solid var(--orbit-border)" }}>
              <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: "1px solid var(--orbit-border)" }}>
                <ShieldAlert className="h-4 w-4" style={{ color: "var(--orbit-text-muted)" }} />
                <span className="text-sm font-semibold" style={{ color: "var(--orbit-text-primary)" }}>
                  Recent Sign-ins
                </span>
              </div>
              <table className="w-full">
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--orbit-border)" }}>
                    {["Status", "User", "UPN", "IP", "Reason", "Time"].map((h) => (
                      <th key={h} className="px-4 py-2 text-left text-xs font-semibold"
                        style={{ color: "var(--orbit-text-muted)" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.recentSignIns.map((s) => (
                    <tr key={s.id} style={{ borderBottom: "1px solid var(--orbit-border)" }}>
                      <td className="px-4 py-2">
                        {s.success
                          ? <CheckCircle2 className="h-4 w-4" style={{ color: "#22c55e" }} />
                          : <XCircle className="h-4 w-4" style={{ color: "#ef4444" }} />}
                      </td>
                      <td className="px-4 py-2 text-sm" style={{ color: "var(--orbit-text-secondary)" }}>{s.user}</td>
                      <td className="px-4 py-2 text-xs font-mono" style={{ color: "var(--orbit-text-muted)" }}>{s.upn}</td>
                      <td className="px-4 py-2 text-xs font-mono" style={{ color: "var(--orbit-text-muted)" }}>{s.ip}</td>
                      <td className="px-4 py-2 text-xs" style={{ color: s.failureReason ? "#f59e0b" : "var(--orbit-text-muted)" }}>
                        {s.failureReason ?? "—"}
                      </td>
                      <td className="px-4 py-2 text-xs whitespace-nowrap" style={{ color: "var(--orbit-text-muted)" }}>
                        {new Date(s.createdAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Security event feed — tabbed */}
          <div className="rounded-xl overflow-hidden"
            style={{ background: "var(--orbit-bg-card)", border: "1px solid var(--orbit-border)" }}>

            {/* Tab bar */}
            <div className="flex items-center gap-0 px-4 pt-3"
              style={{ borderBottom: "1px solid var(--orbit-border)" }}>
              {TABS.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className="px-4 py-2 text-xs font-semibold mr-1 rounded-t-lg"
                  style={{
                    color: tab === t.key ? "var(--orbit-text-primary)" : "var(--orbit-text-muted)",
                    background: tab === t.key ? "var(--orbit-bg-page)" : "transparent",
                    borderBottom: tab === t.key ? "2px solid #6366f1" : "2px solid transparent",
                  }}
                >
                  {t.label}
                  <span
                    className="ml-1.5 rounded-full px-1.5 py-0.5 text-xs"
                    style={{
                      background: tab === t.key ? "#6366f120" : "var(--orbit-bg-page)",
                      color: tab === t.key ? "#6366f1" : "var(--orbit-text-muted)",
                    }}
                  >
                    {counts[t.key]}
                  </span>
                </button>
              ))}
              {/* Source filter */}
              {sources.length > 1 && (
                <div className="ml-auto flex items-center gap-2 pb-2">
                  <Filter className="h-3.5 w-3.5" style={{ color: "var(--orbit-text-muted)" }} />
                  <select
                    value={srcFilter}
                    onChange={(e) => setSrcFilter(e.target.value)}
                    className="text-xs rounded px-2 py-1"
                    style={{
                      background: "var(--orbit-bg-page)",
                      border: "1px solid var(--orbit-border)",
                      color: "var(--orbit-text-secondary)",
                    }}
                  >
                    <option value="all">All sources</option>
                    {sources.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              )}
            </div>

            {/* Table */}
            <table className="w-full">
              <thead>
                <tr style={{ borderBottom: "1px solid var(--orbit-border)" }}>
                  {["", "Severity", "Source", "Detail", "Time", "Status", "Actions"].map((h) => (
                    <th key={h} className="px-3 py-2 text-left text-xs font-semibold"
                      style={{ color: "var(--orbit-text-muted)" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredEvents.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-sm text-center" style={{ color: "var(--orbit-text-muted)" }}>
                      {tab === "active" ? "No active security events — all clear." : `No ${tab} events.`}
                    </td>
                  </tr>
                ) : (
                  filteredEvents.map((e) => (
                    <EventRow
                      key={e.id}
                      event={e}
                      onAcknowledge={(id) => acknowledge(id)}
                      onResolve={(id) => resolve(id)}
                    />
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </div>
  );
}
