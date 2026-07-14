import { useState } from "react";
import {
  RefreshCw,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  GitBranch,
  Play,
  AlertTriangle,
  Info,
  ExternalLink,
  Activity,
} from "lucide-react";
import { useWorkflowSnapshot, type WorkflowRun, type WorkflowSummary } from "../../services/noc";

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtDuration(ms: number | null): string {
  if (ms === null) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
}

function fmtRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function conclusionColor(c: string | null, status: string): string {
  if (status === "in_progress" || status === "queued") return "#f59e0b";
  if (c === "success") return "#22c55e";
  if (c === "failure" || c === "timed_out") return "#ef4444";
  if (c === "cancelled") return "#94a3b8";
  return "#94a3b8";
}

function healthColor(h: WorkflowSummary["health"]): string {
  if (h === "healthy") return "#22c55e";
  if (h === "degraded") return "#f59e0b";
  if (h === "critical") return "#ef4444";
  return "#94a3b8";
}

function healthBg(h: WorkflowSummary["health"]): string {
  return healthColor(h) + "18";
}

function ConclusionIcon({ conclusion, status }: { conclusion: string | null; status: string }) {
  const color = conclusionColor(conclusion, status);
  if (status === "in_progress") return <Play className="h-3.5 w-3.5 animate-pulse" style={{ color }} />;
  if (status === "queued") return <Clock className="h-3.5 w-3.5" style={{ color }} />;
  if (conclusion === "success") return <CheckCircle2 className="h-3.5 w-3.5" style={{ color }} />;
  if (conclusion === "failure" || conclusion === "timed_out") return <XCircle className="h-3.5 w-3.5" style={{ color }} />;
  return <Activity className="h-3.5 w-3.5" style={{ color }} />;
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function KpiTile({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div className="rounded-xl px-5 py-4 flex flex-col gap-1"
      style={{ background: "var(--orbit-bg-card)", border: "1px solid var(--orbit-border)" }}>
      <span className="text-xs font-medium" style={{ color: "var(--orbit-text-muted)" }}>{label}</span>
      <span className="text-3xl font-bold tabular-nums" style={{ color: color ?? "var(--orbit-text-primary)" }}>{value}</span>
      {sub && <span className="text-xs" style={{ color: "var(--orbit-text-muted)" }}>{sub}</span>}
    </div>
  );
}

function SummaryRow({ s }: { s: WorkflowSummary }) {
  return (
    <tr style={{ borderBottom: "1px solid var(--orbit-border)" }}>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold"
            style={{ color: healthColor(s.health), background: healthBg(s.health) }}>
            {s.health}
          </span>
        </div>
      </td>
      <td className="px-4 py-3">
        <p className="text-sm font-medium" style={{ color: "var(--orbit-text-primary)" }}>{s.workflow}</p>
        <p className="text-xs" style={{ color: "var(--orbit-text-muted)" }}>{s.repo}</p>
      </td>
      <td className="px-4 py-3 text-sm tabular-nums text-center" style={{ color: "var(--orbit-text-secondary)" }}>
        {s.totalRuns}
      </td>
      <td className="px-4 py-3 text-sm tabular-nums text-center"
        style={{ color: s.failureCount > 0 ? "#ef4444" : "var(--orbit-text-muted)" }}>
        {s.failureCount > 0 ? `${s.failureCount} ✗` : "0"}
      </td>
      <td className="px-4 py-3 text-sm tabular-nums text-center"
        style={{ color: s.successRate !== null && s.successRate < 80 ? "#f59e0b" : "#22c55e" }}>
        {s.successRate !== null ? `${s.successRate}%` : "—"}
      </td>
      <td className="px-4 py-3 text-sm tabular-nums text-center" style={{ color: "var(--orbit-text-muted)" }}>
        {fmtDuration(s.avgDurationMs)}
      </td>
      <td className="px-4 py-3 text-xs whitespace-nowrap" style={{ color: "var(--orbit-text-muted)" }}>
        {s.lastRunAt ? fmtRelative(s.lastRunAt) : "—"}
      </td>
    </tr>
  );
}

function RunRow({ run }: { run: WorkflowRun }) {
  return (
    <tr style={{ borderBottom: "1px solid var(--orbit-border)" }}>
      <td className="px-4 py-2.5">
        <ConclusionIcon conclusion={run.conclusion} status={run.status} />
      </td>
      <td className="px-4 py-2.5">
        <p className="text-sm font-medium truncate max-w-xs" style={{ color: "var(--orbit-text-primary)" }}>{run.name}</p>
        <p className="text-xs" style={{ color: "var(--orbit-text-muted)" }}>{run.workflow}</p>
      </td>
      <td className="px-4 py-2.5 text-xs" style={{ color: "var(--orbit-text-muted)" }}>
        <span className="flex items-center gap-1">
          <GitBranch className="h-3 w-3" />{run.branch}
        </span>
      </td>
      <td className="px-4 py-2.5 text-xs" style={{ color: "var(--orbit-text-muted)" }}>{run.repo}</td>
      <td className="px-4 py-2.5 text-xs tabular-nums" style={{ color: "var(--orbit-text-muted)" }}>
        {fmtDuration(run.durationMs)}
      </td>
      <td className="px-4 py-2.5 text-xs whitespace-nowrap" style={{ color: "var(--orbit-text-muted)" }}>
        {fmtRelative(run.startedAt)}
      </td>
      <td className="px-4 py-2.5">
        <a href={run.url} target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs"
          style={{ color: "var(--orbit-accent)" }}>
          <ExternalLink className="h-3 w-3" />
        </a>
      </td>
    </tr>
  );
}

// ── Main Dashboard ─────────────────────────────────────────────────────────────

export function WorkflowsDashboard() {
  const { data, isLoading, error, refetch, isFetching, dataUpdatedAt } = useWorkflowSnapshot();
  const [tab, setTab] = useState<"runs" | "summaries">("summaries");
  const [conclusionFilter, setConclusionFilter] = useState<string>("all");

  const lastUpdated = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : null;

  const filteredRuns = (data?.recentRuns ?? []).filter((r) => {
    if (conclusionFilter === "all") return true;
    if (conclusionFilter === "in_progress") return r.status === "in_progress" || r.status === "queued";
    return r.conclusion === conclusionFilter;
  });

  const successRate = data && data.totalRuns24h > 0
    ? Math.round(((data.totalRuns24h - data.failedRuns24h) / data.totalRuns24h) * 100)
    : null;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "var(--orbit-text-primary)" }}>Workflow & Automation Health</h1>
          <p className="text-sm mt-1" style={{ color: "var(--orbit-text-muted)" }}>
            GitHub Actions · 24h window · auto-refreshes every 2m
            {lastUpdated && <span className="ml-2">· Updated {lastUpdated}</span>}
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
          <span className="text-sm">Fetching workflow data…</span>
        </div>
      ) : error ? (
        <div className="rounded-xl p-4 text-sm"
          style={{ color: "#ef4444", border: "1px solid #ef444433", background: "var(--orbit-bg-card)" }}>
          {(error as Error).message}
        </div>
      ) : data ? (
        <>
          {!data.githubConfigured && (
            <div className="flex items-start gap-3 rounded-xl px-4 py-3 text-sm"
              style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.3)", color: "#f59e0b" }}>
              <Info className="h-4 w-4 mt-0.5 shrink-0" />
              <span>
                GitHub not configured — set <code className="font-mono text-xs">GITHUB_TOKEN</code>,{" "}
                <code className="font-mono text-xs">GITHUB_ORG</code>, and{" "}
                <code className="font-mono text-xs">GITHUB_REPOS</code> (comma-separated repo names) on the Container App.
              </span>
            </div>
          )}

          {/* KPI tiles */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <KpiTile label="Total Runs (24h)" value={data.totalRuns24h} />
            <KpiTile
              label="Failed Runs (24h)"
              value={data.failedRuns24h}
              color={data.failedRuns24h > 0 ? "#ef4444" : undefined}
              sub={data.failedRuns24h > 0 ? "Require attention" : "All passing"}
            />
            <KpiTile
              label="Success Rate"
              value={successRate !== null ? `${successRate}%` : "—"}
              color={successRate !== null && successRate < 80 ? "#f59e0b" : "#22c55e"}
            />
            <KpiTile
              label="In Progress"
              value={data.inProgressRuns}
              color={data.inProgressRuns > 0 ? "#f59e0b" : undefined}
              sub={data.inProgressRuns > 0 ? "Running now" : "No active runs"}
            />
          </div>

          {/* Tabs */}
          <div className="rounded-2xl overflow-hidden"
            style={{ background: "var(--orbit-bg-card)", border: "1px solid var(--orbit-border)" }}>
            <div className="flex items-center gap-1 px-4 pt-4 pb-0 border-b"
              style={{ borderColor: "var(--orbit-border)" }}>
              {(["summaries", "runs"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className="px-4 py-2 text-sm font-medium rounded-t-lg transition-colors"
                  style={{
                    color: tab === t ? "var(--orbit-accent)" : "var(--orbit-text-muted)",
                    borderBottom: tab === t ? "2px solid var(--orbit-accent)" : "2px solid transparent",
                    background: "transparent",
                  }}
                >
                  {t === "summaries" ? "Workflow Summary" : "Recent Runs"}
                </button>
              ))}

              {tab === "runs" && (
                <div className="ml-auto flex items-center gap-2 pb-2">
                  <select
                    value={conclusionFilter}
                    onChange={(e) => setConclusionFilter(e.target.value)}
                    className="text-xs rounded px-2 py-1"
                    style={{ background: "var(--orbit-bg-page)", border: "1px solid var(--orbit-border)", color: "var(--orbit-text-secondary)" }}
                  >
                    <option value="all">All</option>
                    <option value="success">Success</option>
                    <option value="failure">Failure</option>
                    <option value="cancelled">Cancelled</option>
                    <option value="in_progress">In Progress</option>
                  </select>
                </div>
              )}
            </div>

            {tab === "summaries" ? (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--orbit-border)" }}>
                      {["Health", "Workflow", "Runs", "Failures", "Success Rate", "Avg Duration", "Last Run"].map((h) => (
                        <th key={h} className="px-4 py-2 text-left text-xs font-semibold"
                          style={{ color: "var(--orbit-text-muted)" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.summaries.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-4 py-10 text-sm text-center"
                          style={{ color: "var(--orbit-text-muted)" }}>
                          {data.githubConfigured ? "No workflow runs in the last 24h." : "Configure GitHub to see workflow data."}
                        </td>
                      </tr>
                    ) : (
                      data.summaries.map((s) => <SummaryRow key={`${s.repo}::${s.workflow}`} s={s} />)
                    )}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--orbit-border)" }}>
                      {["", "Run", "Branch", "Repo", "Duration", "Started", ""].map((h, i) => (
                        <th key={i} className="px-4 py-2 text-left text-xs font-semibold"
                          style={{ color: "var(--orbit-text-muted)" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRuns.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-4 py-10 text-sm text-center"
                          style={{ color: "var(--orbit-text-muted)" }}>
                          No runs match the current filter.
                        </td>
                      </tr>
                    ) : (
                      filteredRuns.map((r) => <RunRow key={r.id} run={r} />)
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {/* Failed runs callout */}
            {tab === "summaries" && data.summaries.some((s) => s.health === "critical") && (
              <div className="mx-4 mb-4 mt-2 flex items-start gap-3 rounded-xl px-4 py-3 text-sm"
                style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.3)", color: "#ef4444" }}>
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>
                  {data.summaries.filter((s) => s.health === "critical").length} workflow{data.summaries.filter((s) => s.health === "critical").length !== 1 ? "s" : ""} in critical state — success rate below 50%. Check the Recent Runs tab for details.
                </span>
              </div>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
