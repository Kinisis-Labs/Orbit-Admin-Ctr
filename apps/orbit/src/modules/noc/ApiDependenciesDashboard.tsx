import { RefreshCw, Loader2, Info, CheckCircle2, XCircle, AlertTriangle, HelpCircle } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

// ── Types ─────────────────────────────────────────────────────────────────────

interface DependencyEntry {
  name: string;
  callsPerHour: number | null;
  calls24h: number | null;
  avgDurationMs: number | null;
  failedCalls: number | null;
  errorRate: number | null;
  lastSeen: string | null;
  configured: boolean;
}

interface DependencySnapshot {
  entries: DependencyEntry[];
  appSlug: string;
  appName: string;
  capturedAt: string;
  appInsightsConfigured: boolean;
}

// ── Cost-sensitive APIs ───────────────────────────────────────────────────────

const COST_SENSITIVE = new Set(["Azure OpenAI", "OpenAI", "Ximilar", "RoboFlow"]);
const AI_APIS = new Set(["Azure OpenAI", "OpenAI"]);

// ── Data hook ─────────────────────────────────────────────────────────────────

function useApiDependencies(enabled = true) {
  return useQuery<DependencySnapshot>({
    queryKey: ["noc", "api-dependencies"],
    queryFn: async () => {
      const res = await fetch("/api/noc/api-dependencies");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json() as Promise<DependencySnapshot>;
    },
    refetchInterval: 60_000,
    enabled,
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(v: number | null, unit: string): string {
  if (v === null) return "—";
  if (unit === "ms") return `${Math.round(v)} ms`;
  if (unit === "%") return `${v.toFixed(1)}%`;
  if (unit === "/hr") return v.toLocaleString();
  return v.toLocaleString();
}

function StatusIcon({ entry }: { entry: DependencyEntry }) {
  if (!entry.configured) return <HelpCircle className="h-4 w-4" style={{ color: "var(--orbit-text-muted)" }} />;
  if (entry.errorRate !== null && entry.errorRate > 10) return <XCircle className="h-4 w-4" style={{ color: "#ef4444" }} />;
  if (entry.errorRate !== null && entry.errorRate > 2) return <AlertTriangle className="h-4 w-4" style={{ color: "#f59e0b" }} />;
  if (entry.calls24h !== null) return <CheckCircle2 className="h-4 w-4" style={{ color: "#22c55e" }} />;
  return <HelpCircle className="h-4 w-4" style={{ color: "var(--orbit-text-muted)" }} />;
}

function ErrorRateCell({ rate }: { rate: number | null }) {
  if (rate === null) return <span style={{ color: "var(--orbit-text-muted)" }}>—</span>;
  const color = rate > 10 ? "#ef4444" : rate > 2 ? "#f59e0b" : "#22c55e";
  return <span style={{ color }}>{rate.toFixed(1)}%</span>;
}

// ── Summary tiles ─────────────────────────────────────────────────────────────

function SummaryTiles({ entries }: { entries: DependencyEntry[] }) {
  const active = entries.filter((e) => e.calls24h !== null && e.calls24h > 0).length;
  const unhealthy = entries.filter((e) => e.errorRate !== null && e.errorRate > 10).length;
  const totalCalls = entries.reduce((s, e) => s + (e.calls24h ?? 0), 0);
  const totalFailed = entries.reduce((s, e) => s + (e.failedCalls ?? 0), 0);

  const tiles = [
    { label: "Active APIs", value: active, sub: `of ${entries.length} monitored`, color: "#4361f1" },
    { label: "Unhealthy", value: unhealthy, sub: "error rate > 10%", color: "#ef4444" },
    { label: "Total Calls (24h)", value: totalCalls.toLocaleString(), sub: "across all APIs", color: "var(--orbit-text-primary)" },
    { label: "Failed Calls (24h)", value: totalFailed.toLocaleString(), sub: "across all APIs", color: totalFailed > 0 ? "#f59e0b" : "#22c55e" },
  ];

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      {tiles.map((t) => (
        <div key={t.label} className="rounded-xl px-5 py-4 flex flex-col gap-1" style={{ background: "var(--orbit-bg-card)", border: "1px solid var(--orbit-border)" }}>
          <span className="text-xs font-medium" style={{ color: "var(--orbit-text-muted)" }}>{t.label}</span>
          <span className="text-2xl font-bold tabular-nums" style={{ color: t.color }}>{t.value}</span>
          <span className="text-xs" style={{ color: "var(--orbit-text-muted)" }}>{t.sub}</span>
        </div>
      ))}
    </div>
  );
}

// ── Reusable API table ────────────────────────────────────────────────────────

function ApiTable({ title, entries, accentColor }: { title: string; entries: DependencyEntry[]; accentColor: string }) {
  return (
    <div className="space-y-2">
      <h2 className="text-sm font-semibold uppercase tracking-widest px-1" style={{ color: accentColor }}>
        {title}
      </h2>
      <div className="rounded-xl overflow-hidden" style={{ background: "var(--orbit-bg-card)", border: "1px solid var(--orbit-border)" }}>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ borderBottom: "1px solid var(--orbit-border)" }}>
              {["", "API", "Calls / hr", "Calls (24h)", "Avg Latency", "Failed", "Error Rate", "Last Seen"].map((h) => (
                <th key={h} className="px-4 py-3 text-left text-xs font-semibold" style={{ color: "var(--orbit-text-muted)" }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-center text-sm" style={{ color: "var(--orbit-text-muted)" }}>
                  No entries
                </td>
              </tr>
            ) : (
              entries.map((entry) => (
                <tr key={entry.name} style={{ borderBottom: "1px solid var(--orbit-border)" }}>
                  <td className="px-4 py-3"><StatusIcon entry={entry} /></td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="font-medium" style={{ color: "var(--orbit-text-primary)" }}>{entry.name}</span>
                      {COST_SENSITIVE.has(entry.name) && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold" style={{ background: "rgba(245,158,11,0.15)", color: "#f59e0b" }}>
                          COST
                        </span>
                      )}
                      {!entry.configured && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold" style={{ background: "var(--orbit-border)", color: "var(--orbit-text-muted)" }}>
                          NOT INSTRUMENTED
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 tabular-nums text-right" style={{ color: "var(--orbit-text-secondary)" }}>{fmt(entry.callsPerHour, "/hr")}</td>
                  <td className="px-4 py-3 tabular-nums text-right" style={{ color: "var(--orbit-text-secondary)" }}>{fmt(entry.calls24h, "")}</td>
                  <td className="px-4 py-3 tabular-nums text-right" style={{ color: "var(--orbit-text-secondary)" }}>{fmt(entry.avgDurationMs, "ms")}</td>
                  <td className="px-4 py-3 tabular-nums text-right" style={{ color: entry.failedCalls ? "#ef4444" : "var(--orbit-text-secondary)" }}>{fmt(entry.failedCalls, "")}</td>
                  <td className="px-4 py-3 tabular-nums text-right"><ErrorRateCell rate={entry.errorRate} /></td>
                  <td className="px-4 py-3 text-xs" style={{ color: "var(--orbit-text-muted)" }}>
                    {entry.lastSeen
                      ? new Date(entry.lastSeen).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
                      : "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Main Dashboard ────────────────────────────────────────────────────────────

export function ApiDependenciesDashboard() {
  const { data, isLoading, error, refetch, isFetching, dataUpdatedAt } = useApiDependencies();

  const lastUpdated = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : null;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "var(--orbit-text-primary)" }}>API Dependencies</h1>
          <p className="text-sm mt-1" style={{ color: "var(--orbit-text-muted)" }}>
            GrailBabe 3rd-party API usage · 24h window · auto-refreshes every 60s
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
          <span className="text-sm">Fetching API dependency telemetry…</span>
        </div>
      ) : error ? (
        <div className="rounded-xl p-4 text-sm" style={{ color: "#ef4444", border: "1px solid #ef444433", background: "var(--orbit-bg-card)" }}>
          {(error as Error).message}
        </div>
      ) : data ? (
        <>
          {!data.appInsightsConfigured && (
            <div className="flex items-start gap-3 rounded-xl px-4 py-3 text-sm" style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.3)", color: "#f59e0b" }}>
              <Info className="h-4 w-4 mt-0.5 shrink-0" />
              <span>
                App Insights not configured for GrailBabe — add the connection string in{" "}
                <a href="/admin/applications" className="underline">Admin → Applications</a>.
                Showing known APIs with no live data.
              </span>
            </div>
          )}

          <SummaryTiles entries={data.entries} />

          {/* AI APIs section */}
          <ApiTable
            title="AI Providers"
            entries={data.entries.filter((e) => AI_APIS.has(e.name))}
            accentColor="#818cf8"
          />

          {/* 3rd-party APIs section */}
          <ApiTable
            title="3rd-Party APIs"
            entries={data.entries.filter((e) => !AI_APIS.has(e.name))}
            accentColor="var(--orbit-text-muted)"
          />

          <p className="text-xs" style={{ color: "var(--orbit-text-muted)" }}>
            APIs marked <span className="font-semibold" style={{ color: "var(--orbit-text-secondary)" }}>NOT INSTRUMENTED</span> are known GrailBabe dependencies but have not yet sent telemetry.
            Add App Insights dependency tracking to the GrailBabe backend to see live data.
          </p>
        </>
      ) : null}
    </div>
  );
}
