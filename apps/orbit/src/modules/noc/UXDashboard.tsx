import {
  RefreshCw,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Gauge,
  Globe,
  Bug,
  FlaskConical,
  Route,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { useUXSnapshot } from "../../services/noc";

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtMs(v: number | null): string {
  if (v === null) return "—";
  if (v >= 1000) return `${(v / 1000).toFixed(1)}s`;
  return `${Math.round(v)}ms`;
}

function fmtNum(v: number | null): string {
  if (v === null) return "—";
  return v.toLocaleString();
}

function latencyColor(ms: number | null): string {
  if (ms === null) return "#6B7280";
  if (ms > 3000) return "#EF4444";
  if (ms > 1000) return "#F59E0B";
  return "#10B981";
}

function scoreColor(score: number | null): string {
  if (score === null) return "#6B7280";
  if (score >= 90) return "#10B981";
  if (score >= 70) return "#F59E0B";
  return "#EF4444";
}

function scoreLabel(score: number | null): string {
  if (score === null) return "Unknown";
  if (score >= 90) return "Excellent";
  if (score >= 70) return "Fair";
  if (score >= 50) return "Poor";
  return "Critical";
}

// ── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  sub,
  color,
  icon: Icon,
}: {
  label: string;
  value: string;
  sub?: string;
  color: string;
  icon: React.ElementType;
}) {
  return (
    <div
      className="rounded-xl px-5 py-4 flex items-center gap-4"
      style={{ background: "var(--orbit-bg-card)", border: "1px solid var(--orbit-border)" }}
    >
      <div className="rounded-lg p-2.5" style={{ background: `${color}18` }}>
        <Icon className="h-5 w-5" style={{ color }} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium uppercase tracking-wide" style={{ color: "var(--orbit-text-muted)" }}>{label}</p>
        <p className="text-2xl font-bold mt-0.5 tabular-nums" style={{ color }}>{value}</p>
        {sub && <p className="text-xs mt-0.5" style={{ color: "var(--orbit-text-muted)" }}>{sub}</p>}
      </div>
    </div>
  );
}

// ── Section card ──────────────────────────────────────────────────────────────

function Section({ title, icon: Icon, children }: { title: string; icon: React.ElementType; children: React.ReactNode }) {
  return (
    <div className="rounded-xl overflow-hidden" style={{ background: "var(--orbit-bg-card)", border: "1px solid var(--orbit-border)" }}>
      <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: "1px solid var(--orbit-border)" }}>
        <Icon className="h-4 w-4" style={{ color: "var(--orbit-text-muted)" }} />
        <h2 className="text-sm font-semibold" style={{ color: "var(--orbit-text-primary)" }}>{title}</h2>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

// ── Empty row ─────────────────────────────────────────────────────────────────

function EmptyRow({ msg }: { msg: string }) {
  return (
    <p className="text-xs py-4 text-center" style={{ color: "var(--orbit-text-muted)" }}>{msg}</p>
  );
}

// ── Main Dashboard ────────────────────────────────────────────────────────────

export function UXDashboard() {
  const { data, isLoading, error, refetch, isFetching, dataUpdatedAt } = useUXSnapshot();

  const lastUpdated = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : null;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "var(--orbit-text-primary)" }}>
            User Experience & Service Quality
          </h1>
          <p className="text-sm mt-1" style={{ color: "var(--orbit-text-muted)" }}>
            App Insights — load times, latency, errors, synthetics · refreshes every 2m
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
          <span className="text-sm">Querying Application Insights…</span>
        </div>
      ) : error ? (
        <div className="rounded-xl p-4 text-sm" style={{ color: "#ef4444", border: "1px solid #ef444433", background: "var(--orbit-bg-card)" }}>
          {error.message}
        </div>
      ) : data ? (
        <div className="space-y-4">
          {/* No App Insights banner */}
          {!data.appInsightsConfigured && (
            <div className="rounded-xl px-5 py-4 text-sm" style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.25)", color: "#f59e0b" }}>
              <strong>App Insights not configured</strong> — set <code className="font-mono text-xs">APPLICATIONINSIGHTS_CONNECTION_STRING</code> and <code className="font-mono text-xs">AZURE_APP_INSIGHTS_RESOURCE_ID_ORBIT</code> (ARM resource ID) to enable UX telemetry.
            </div>
          )}

          {/* Stat cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              label="UX Score"
              value={data.overallScore !== null ? `${data.overallScore}` : "—"}
              sub={scoreLabel(data.overallScore)}
              color={scoreColor(data.overallScore)}
              icon={Gauge}
            />
            <StatCard
              label="Avg API Latency"
              value={fmtMs(
                data.apiLatencyByRegion.length > 0
                  ? Math.round(data.apiLatencyByRegion.reduce((a, r) => a + (r.avgMs ?? 0), 0) / data.apiLatencyByRegion.length)
                  : null,
              )}
              sub="across all regions"
              color="#4361F1"
              icon={Globe}
            />
            <StatCard
              label="Errors (1h)"
              value={fmtNum(data.errorDistribution.reduce((a, e) => a + e.count, 0))}
              sub={`${data.errorDistribution.length} distinct types`}
              color={data.errorDistribution.reduce((a, e) => a + e.count, 0) > 100 ? "#EF4444" : "#10B981"}
              icon={Bug}
            />
            <StatCard
              label="Synthetics"
              value={
                data.syntheticResults.length > 0
                  ? `${data.syntheticResults.filter((s) => s.success).length}/${data.syntheticResults.length}`
                  : "—"
              }
              sub="passing checks"
              color={
                data.syntheticResults.length > 0 && data.syntheticResults.some((s) => !s.success)
                  ? "#EF4444"
                  : "#10B981"
              }
              icon={FlaskConical}
            />
          </div>

          {/* Main grid — 2 cols */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Portal load times */}
            <Section title="Portal Load Times (p95)" icon={Gauge}>
              {data.portalLoadTimes.length === 0 ? (
                <EmptyRow msg="No page view telemetry — ensure App Insights JS SDK is installed." />
              ) : (
                <div className="space-y-1">
                  <ResponsiveContainer width="100%" height={180}>
                    <BarChart
                      data={data.portalLoadTimes.map((p) => ({ name: p.page.replace(/^\//, "").slice(0, 20) || "/", p95: p.p95Ms }))}
                      layout="vertical"
                      margin={{ top: 0, right: 8, bottom: 0, left: 4 }}
                    >
                      <XAxis type="number" hide />
                      <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 10, fill: "var(--orbit-text-muted)" }} />
                      <Tooltip
                        contentStyle={{ background: "var(--orbit-bg-card)", border: "1px solid var(--orbit-border)", borderRadius: 8, fontSize: 11 }}
                        formatter={(v: number) => [`${Math.round(v)}ms`, "p95"]}
                      />
                      <Bar dataKey="p95" radius={[0, 4, 4, 0]}>
                        {data.portalLoadTimes.map((p) => (
                          <Cell key={p.page} fill={latencyColor(p.p95Ms)} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                  <div className="mt-2 space-y-1">
                    {data.portalLoadTimes.slice(0, 5).map((p) => (
                      <div key={p.page} className="flex items-center justify-between text-xs px-1">
                        <span className="truncate max-w-[60%]" style={{ color: "var(--orbit-text-secondary)" }}>{p.page || "/"}</span>
                        <div className="flex gap-4 tabular-nums" style={{ color: "var(--orbit-text-muted)" }}>
                          <span>p50 {fmtMs(p.p50Ms)}</span>
                          <span style={{ color: latencyColor(p.p95Ms) }}>p95 {fmtMs(p.p95Ms)}</span>
                          <span>{fmtNum(p.sessions)} sessions</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </Section>

            {/* API latency by region */}
            <Section title="API Latency by Region" icon={Globe}>
              {data.apiLatencyByRegion.length === 0 ? (
                <EmptyRow msg="No regional request data available." />
              ) : (
                <div className="space-y-2">
                  {data.apiLatencyByRegion.map((r) => (
                    <div key={r.region} className="rounded-lg px-3 py-2.5" style={{ background: "var(--orbit-bg-page)", border: "1px solid var(--orbit-border)" }}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-medium" style={{ color: "var(--orbit-text-primary)" }}>{r.region}</span>
                        <span className="text-xs font-semibold tabular-nums" style={{ color: latencyColor(r.avgMs) }}>{fmtMs(r.avgMs)} avg</span>
                      </div>
                      <div className="flex gap-4 text-xs" style={{ color: "var(--orbit-text-muted)" }}>
                        <span>p95 {fmtMs(r.p95Ms)}</span>
                        <span>{fmtNum(r.requestCount)} reqs</span>
                        <span style={{ color: (r.failureRate ?? 0) > 5 ? "#EF4444" : (r.failureRate ?? 0) > 1 ? "#F59E0B" : "#10B981" }}>
                          {r.failureRate !== null ? `${r.failureRate.toFixed(1)}% fail` : "—"}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Section>

            {/* Error distribution */}
            <Section title="Error Distribution (1h)" icon={Bug}>
              {data.errorDistribution.length === 0 ? (
                <EmptyRow msg="No exceptions recorded in the last hour." />
              ) : (
                <div className="space-y-1">
                  {data.errorDistribution.map((e) => (
                    <div key={e.type} className="py-2 px-1" style={{ borderBottom: "1px solid var(--orbit-border)" }}>
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium truncate max-w-[70%]" style={{ color: "var(--orbit-text-secondary)" }}>
                          {e.type.split(".").pop() ?? e.type}
                        </span>
                        <div className="flex items-center gap-3 text-xs tabular-nums">
                          <span style={{ color: e.count > 50 ? "#EF4444" : "#F59E0B" }}>{fmtNum(e.count)} errors</span>
                          {e.affectedUsers !== null && (
                            <span style={{ color: "var(--orbit-text-muted)" }}>{fmtNum(e.affectedUsers)} users</span>
                          )}
                        </div>
                      </div>
                      {e.sample && (
                        <p className="text-xs mt-0.5 truncate" style={{ color: "var(--orbit-text-muted)" }}>{e.sample}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </Section>

            {/* Synthetics + Failing journeys stacked */}
            <div className="space-y-4">
              <Section title="Synthetic Transaction Results" icon={FlaskConical}>
                {data.syntheticResults.length === 0 ? (
                  <EmptyRow msg="No results yet — availability test runs every 5 minutes. Check back shortly." />
                ) : (
                  <div className="space-y-1">
                    {data.syntheticResults.map((s, i) => (
                      <div key={i} className="flex items-center gap-3 py-1.5 px-1" style={{ borderBottom: "1px solid var(--orbit-border)" }}>
                        {s.success
                          ? <CheckCircle2 className="h-4 w-4 flex-shrink-0" style={{ color: "#10B981" }} />
                          : <XCircle className="h-4 w-4 flex-shrink-0" style={{ color: "#EF4444" }} />}
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium truncate" style={{ color: "var(--orbit-text-secondary)" }}>{s.name}</p>
                          <p className="text-xs" style={{ color: "var(--orbit-text-muted)" }}>{s.location}</p>
                        </div>
                        <span className="text-xs tabular-nums" style={{ color: latencyColor(s.durationMs) }}>{fmtMs(s.durationMs)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </Section>

              <Section title="Top Failing User Journeys" icon={Route}>
                {data.failingJourneys.length === 0 ? (
                  <EmptyRow msg="No failing journeys detected." />
                ) : (
                  <div className="space-y-1">
                    {data.failingJourneys.map((j, i) => (
                      <div key={i} className="flex items-center gap-3 py-1.5 px-1" style={{ borderBottom: "1px solid var(--orbit-border)" }}>
                        <AlertTriangle className="h-4 w-4 flex-shrink-0" style={{ color: "#F59E0B" }} />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium truncate" style={{ color: "var(--orbit-text-secondary)" }}>{j.journey}</p>
                          {j.topError && (
                            <p className="text-xs truncate" style={{ color: "var(--orbit-text-muted)" }}>{j.topError}</p>
                          )}
                        </div>
                        <div className="text-right text-xs tabular-nums">
                          <p style={{ color: "#EF4444" }}>{fmtNum(j.failureCount)} fails</p>
                          {j.affectedUsers !== null && (
                            <p style={{ color: "var(--orbit-text-muted)" }}>{fmtNum(j.affectedUsers)} users</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Section>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
