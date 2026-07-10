import {
  ShieldAlert,
  RefreshCw,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Info,
  Check,
} from "lucide-react";
import { useSecurityEvents, useAcknowledgeSecurityEvent, type SecurityEvent } from "../../services/noc";

// ── Helpers ───────────────────────────────────────────────────────────────────

function severityColor(severity: string): string {
  switch (severity) {
    case "critical": return "#ef4444";
    case "warning": return "#f59e0b";
    case "error": return "#ef4444";
    default: return "var(--orbit-text-muted)";
  }
}

function severityBg(severity: string): string {
  switch (severity) {
    case "critical": return "rgba(239,68,68,0.1)";
    case "warning": return "rgba(245,158,11,0.1)";
    case "error": return "rgba(239,68,68,0.1)";
    default: return "var(--orbit-bg-page)";
  }
}

function SummaryTile({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div
      className="rounded-xl px-5 py-4 flex flex-col gap-1"
      style={{ background: "var(--orbit-bg-card)", border: "1px solid var(--orbit-border)" }}
    >
      <span className="text-xs font-medium" style={{ color: "var(--orbit-text-muted)" }}>
        {label}
      </span>
      <span className="text-3xl font-bold tabular-nums" style={{ color: color ?? "var(--orbit-text-primary)" }}>
        {value}
      </span>
    </div>
  );
}

function EventRow({ event, onAcknowledge }: { event: SecurityEvent; onAcknowledge: (id: string) => void }) {
  return (
    <tr
      style={{
        borderBottom: "1px solid var(--orbit-border)",
        opacity: event.acknowledged ? 0.5 : 1,
      }}
    >
      <td className="px-4 py-3">
        <span
          className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold"
          style={{ color: severityColor(event.severity), background: severityBg(event.severity) }}
        >
          {event.severity}
        </span>
      </td>
      <td className="px-4 py-3">
        <span className="text-xs font-mono" style={{ color: "var(--orbit-text-muted)" }}>
          {event.source}
        </span>
      </td>
      <td className="px-4 py-3 text-sm" style={{ color: "var(--orbit-text-secondary)", maxWidth: 320 }}>
        <p className="truncate">{event.detail}</p>
        {event.user && (
          <p className="text-xs mt-0.5" style={{ color: "var(--orbit-text-muted)" }}>
            {event.user}{event.ip ? ` · ${event.ip}` : ""}
          </p>
        )}
      </td>
      <td className="px-4 py-3 text-xs" style={{ color: "var(--orbit-text-muted)", whiteSpace: "nowrap" }}>
        {new Date(event.createdAt).toLocaleTimeString(undefined, {
          hour: "2-digit",
          minute: "2-digit",
        })}
      </td>
      <td className="px-4 py-3 text-right">
        {!event.acknowledged && event.source !== "orbit-audit" && (
          <button
            onClick={() => onAcknowledge(event.id)}
            className="rounded px-2 py-1 text-xs font-medium"
            style={{
              background: "var(--orbit-bg-page)",
              border: "1px solid var(--orbit-border)",
              color: "var(--orbit-text-muted)",
            }}
          >
            <Check className="h-3 w-3 inline mr-1" />
            Ack
          </button>
        )}
      </td>
    </tr>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function SecurityDashboard() {
  const { data, isLoading, error, refetch, isFetching, dataUpdatedAt } = useSecurityEvents();
  const { mutate: acknowledge } = useAcknowledgeSecurityEvent();

  const lastUpdated = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    : null;

  const allEvents = [...(data?.securityEvents ?? []), ...(data?.auditEvents ?? [])].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "var(--orbit-text-primary)" }}>
            Security
          </h1>
          <p className="text-sm mt-1" style={{ color: "var(--orbit-text-muted)" }}>
            Entra sign-in logs, security events, Orbit audit · 24h window · auto-refreshes every 60s
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
          <span className="text-sm">Fetching security events…</span>
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
          {!data.graphConfigured && (
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
                Microsoft Graph not configured — set{" "}
                <code className="font-mono text-xs">AZURE_TENANT_ID</code>,{" "}
                <code className="font-mono text-xs">AZURE_CLIENT_ID</code>, and{" "}
                <code className="font-mono text-xs">AZURE_CLIENT_SECRET</code> (or Managed Identity) to
                enable Entra sign-in telemetry. Showing Orbit audit events only.
              </span>
            </div>
          )}

          {/* Sign-in summary tiles */}
          <div className="grid grid-cols-3 gap-4">
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
          </div>

          {/* Recent sign-ins */}
          {data.recentSignIns.length > 0 && (
            <div
              className="rounded-xl overflow-hidden"
              style={{ background: "var(--orbit-bg-card)", border: "1px solid var(--orbit-border)" }}
            >
              <div
                className="flex items-center gap-2 px-4 py-3"
                style={{ borderBottom: "1px solid var(--orbit-border)" }}
              >
                <ShieldAlert className="h-4 w-4" style={{ color: "var(--orbit-text-muted)" }} />
                <span className="text-sm font-semibold" style={{ color: "var(--orbit-text-primary)" }}>
                  Recent Sign-ins
                </span>
              </div>
              <table className="w-full">
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--orbit-border)" }}>
                    {["Status", "User", "UPN", "IP", "Time"].map((h) => (
                      <th
                        key={h}
                        className="px-4 py-2 text-left text-xs font-semibold"
                        style={{ color: "var(--orbit-text-muted)" }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.recentSignIns.map((s) => (
                    <tr key={s.id} style={{ borderBottom: "1px solid var(--orbit-border)" }}>
                      <td className="px-4 py-2">
                        {s.success ? (
                          <CheckCircle2 className="h-4 w-4" style={{ color: "#22c55e" }} />
                        ) : (
                          <XCircle className="h-4 w-4" style={{ color: "#ef4444" }} />
                        )}
                      </td>
                      <td className="px-4 py-2 text-sm" style={{ color: "var(--orbit-text-secondary)" }}>
                        {s.user}
                      </td>
                      <td className="px-4 py-2 text-xs font-mono" style={{ color: "var(--orbit-text-muted)" }}>
                        {s.upn}
                      </td>
                      <td className="px-4 py-2 text-xs font-mono" style={{ color: "var(--orbit-text-muted)" }}>
                        {s.ip}
                      </td>
                      <td className="px-4 py-2 text-xs" style={{ color: "var(--orbit-text-muted)", whiteSpace: "nowrap" }}>
                        {new Date(s.createdAt).toLocaleTimeString(undefined, {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Security event feed */}
          <div
            className="rounded-xl overflow-hidden"
            style={{ background: "var(--orbit-bg-card)", border: "1px solid var(--orbit-border)" }}
          >
            <div
              className="flex items-center gap-2 px-4 py-3"
              style={{ borderBottom: "1px solid var(--orbit-border)" }}
            >
              <AlertTriangle className="h-4 w-4" style={{ color: "var(--orbit-text-muted)" }} />
              <span className="text-sm font-semibold" style={{ color: "var(--orbit-text-primary)" }}>
                Security Event Feed
              </span>
              <span className="ml-auto text-xs" style={{ color: "var(--orbit-text-muted)" }}>
                {allEvents.length} events (24h)
              </span>
            </div>
            <table className="w-full">
              <thead>
                <tr style={{ borderBottom: "1px solid var(--orbit-border)" }}>
                  {["Severity", "Source", "Detail", "Time", ""].map((h) => (
                    <th
                      key={h}
                      className="px-4 py-2 text-left text-xs font-semibold"
                      style={{ color: "var(--orbit-text-muted)" }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {allEvents.length === 0 ? (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-4 py-8 text-sm text-center"
                      style={{ color: "var(--orbit-text-muted)" }}
                    >
                      No security events in the last 24 hours.
                    </td>
                  </tr>
                ) : (
                  allEvents.map((e) => (
                    <EventRow key={e.id} event={e} onAcknowledge={(id) => acknowledge(id)} />
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
