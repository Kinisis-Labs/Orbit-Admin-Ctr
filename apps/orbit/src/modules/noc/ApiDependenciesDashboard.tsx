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

// ── Rate limit reference (from API Rate Limits & Access Reference 2026-07-10) ──
// window: "day" | "hour" | "min" | "sec"
// limit: numeric quota for that window
// tier: label shown in UI

interface RateLimit {
  limit: number;
  window: "day" | "hour" | "min" | "sec";
  tier: string;
}

const RATE_LIMITS: Record<string, RateLimit> = {
  "Stripe":            { limit: 100,     window: "sec",  tier: "Live" },
  "Rebrickable":       { limit: 3_600,   window: "day",  tier: "Standard (~1 req/sec)" },
  "Scryfall":          { limit: 7_200,   window: "hour", tier: "Free (2 req/sec)" },
  "magicthegathering": { limit: 5_000,   window: "hour", tier: "Free" },
  "TCG API":           { limit: 2_500,   window: "day",  tier: "Starter" },
  "TradingCardAPI":    { limit: 1_000,   window: "hour", tier: "Free" },
  "The Card API":      { limit: 2_000,   window: "day",  tier: "Pro" },
  "JustTCG":           { limit: 1_000,   window: "day",  tier: "Starter" },
  "Pokémon TCG":       { limit: 20_000,  window: "day",  tier: "With API Key" },
  "Brickset":          { limit: 100,     window: "day",  tier: "Standard" },
  "Ximilar":           { limit: 1_000,   window: "day",  tier: "Free (credits)" },
  "RoboFlow":          { limit: 60,      window: "min",  tier: "Per device" },
  "Azure OpenAI":      { limit: 0,       window: "hour", tier: "Token-based" },
  "OpenAI":            { limit: 0,       window: "hour", tier: "Token-based" },
};

// Convert any window to a 24h equivalent for utilization calculation
function limitPer24h(rl: RateLimit): number | null {
  if (rl.limit === 0) return null; // token-based, no simple quota
  if (rl.window === "day")  return rl.limit;
  if (rl.window === "hour") return rl.limit * 24;
  if (rl.window === "min")  return rl.limit * 60 * 24;
  if (rl.window === "sec")  return rl.limit * 60 * 60 * 24;
  return null;
}

function utilizationPct(entry: DependencyEntry): number | null {
  const rl = RATE_LIMITS[entry.name];
  if (!rl) return null;
  const quota = limitPer24h(rl);
  if (!quota || entry.calls24h === null) return null;
  return Math.min((entry.calls24h / quota) * 100, 100);
}

function fmtRateLimit(rl: RateLimit): string {
  if (rl.limit === 0) return "Token-based";
  return `${rl.limit.toLocaleString()} / ${rl.window}`;
}

function UsageBar({ pct }: { pct: number | null }) {
  if (pct === null) return <span style={{ color: "var(--orbit-text-muted)" }}>—</span>;
  const color = pct >= 80 ? "#ef4444" : pct >= 50 ? "#f59e0b" : "#22c55e";
  return (
    <div className="flex items-center gap-2">
      <div className="relative h-1.5 w-16 rounded-full overflow-hidden" style={{ background: "var(--orbit-border)" }}>
        <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="text-xs tabular-nums" style={{ color }}>{pct.toFixed(1)}%</span>
    </div>
  );
}

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
              {["", "API", "Rate Limit", "Tier", "Calls (24h)", "Usage", "Avg Latency", "Error Rate", "Last Seen"].map((h) => (
                <th key={h} className="px-4 py-3 text-left text-xs font-semibold" style={{ color: "var(--orbit-text-muted)" }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-6 text-center text-sm" style={{ color: "var(--orbit-text-muted)" }}>
                  No entries
                </td>
              </tr>
            ) : (
              entries.map((entry) => {
                const rl = RATE_LIMITS[entry.name];
                const pct = utilizationPct(entry);
                return (
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
                    <td className="px-4 py-3 tabular-nums text-xs" style={{ color: "var(--orbit-text-secondary)" }}>
                      {rl ? fmtRateLimit(rl) : <span style={{ color: "var(--orbit-text-muted)" }}>—</span>}
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: "var(--orbit-text-muted)" }}>
                      {rl ? rl.tier : "—"}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-right" style={{ color: "var(--orbit-text-secondary)" }}>{fmt(entry.calls24h, "")}</td>
                    <td className="px-4 py-3"><UsageBar pct={pct} /></td>
                    <td className="px-4 py-3 tabular-nums text-right" style={{ color: "var(--orbit-text-secondary)" }}>{fmt(entry.avgDurationMs, "ms")}</td>
                    <td className="px-4 py-3 tabular-nums text-right"><ErrorRateCell rate={entry.errorRate} /></td>
                    <td className="px-4 py-3 text-xs" style={{ color: "var(--orbit-text-muted)" }}>
                      {entry.lastSeen
                        ? new Date(entry.lastSeen).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
                        : "—"}
                    </td>
                  </tr>
                );
              })
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
