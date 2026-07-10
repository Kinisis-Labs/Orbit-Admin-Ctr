import { RefreshCw, Loader2, Info, BrainCircuit, Search } from "lucide-react";
import { useAiMetrics } from "../../services/noc";

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(value: number | null, unit: string): string {
  if (value === null) return "—";
  if (unit === "%") return `${value.toFixed(1)}%`;
  if (unit === "ms") return `${Math.round(value)} ms`;
  if (unit === "M") return value >= 1_000_000 ? `${(value / 1_000_000).toFixed(2)}M` : value.toLocaleString();
  return value.toLocaleString();
}

function MetricCard({
  label,
  value,
  unit,
  highlight,
  subtext,
}: {
  label: string;
  value: number | null;
  unit: string;
  highlight?: "red" | "green" | "yellow";
  subtext?: string;
}) {
  let color = "var(--orbit-text-primary)";
  if (value !== null) {
    if (highlight === "red" && value > 0) color = "#ef4444";
    else if (highlight === "yellow" && value > 5) color = "#f59e0b";
    else if (highlight === "green" && value > 0) color = "#22c55e";
  }

  return (
    <div
      className="rounded-xl px-5 py-4 flex flex-col gap-1"
      style={{ background: "var(--orbit-bg-card)", border: "1px solid var(--orbit-border)" }}
    >
      <span className="text-xs font-medium" style={{ color: "var(--orbit-text-muted)" }}>
        {label}
      </span>
      <span className="text-2xl font-bold tabular-nums" style={{ color }}>
        {fmt(value, unit)}
      </span>
      {subtext && (
        <span className="text-xs" style={{ color: "var(--orbit-text-muted)" }}>
          {subtext}
        </span>
      )}
    </div>
  );
}

function SectionHeader({ icon: Icon, title }: { icon: React.ElementType; title: string }) {
  return (
    <div className="flex items-center gap-2 mt-2">
      <Icon className="h-4 w-4" style={{ color: "var(--orbit-text-muted)" }} />
      <h2 className="text-sm font-semibold" style={{ color: "var(--orbit-text-primary)" }}>
        {title}
      </h2>
      <div className="flex-1 h-px" style={{ background: "var(--orbit-border)" }} />
    </div>
  );
}

function UnconfiguredBanner({ resource, envVars }: { resource: string; envVars: string[] }) {
  return (
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
        {resource} not configured — set{" "}
        {envVars.map((v, i) => (
          <span key={v}>
            <code className="font-mono text-xs">{v}</code>
            {i < envVars.length - 1 ? " and " : ""}
          </span>
        ))}{" "}
        to enable live metrics.
      </span>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function AIDashboard() {
  const { data, isLoading, error, refetch, isFetching, dataUpdatedAt } = useAiMetrics();

  const lastUpdated = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    : null;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "var(--orbit-text-primary)" }}>
            AI NOC
          </h1>
          <p className="text-sm mt-1" style={{ color: "var(--orbit-text-muted)" }}>
            Azure OpenAI · Azure AI Search · 24h window · auto-refreshes every 60s
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
          <span className="text-sm">Fetching AI platform metrics…</span>
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
          {/* ── Azure OpenAI ── */}
          <SectionHeader icon={BrainCircuit} title="Azure OpenAI" />

          {!data.openAiConfigured ? (
            <UnconfiguredBanner
              resource="Azure OpenAI"
              envVars={["AZURE_OPENAI_RESOURCE_ID"]}
            />
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <MetricCard
                label="Total Tokens (24h)"
                value={data.openAi.tokenUsage}
                unit="M"
                subtext="token transactions"
              />
              <MetricCard
                label="Prompt Tokens"
                value={data.openAi.promptTokens}
                unit="M"
              />
              <MetricCard
                label="Completion Tokens"
                value={data.openAi.completionTokens}
                unit="M"
              />
              <MetricCard
                label="Avg Latency"
                value={data.openAi.avgLatencyMs}
                unit="ms"
                highlight="yellow"
                subtext="per request"
              />
              <MetricCard
                label="Error Rate"
                value={data.openAi.errorRate}
                unit="%"
                highlight="red"
              />
              <MetricCard
                label="Total Requests"
                value={data.openAi.totalRequests}
                unit=""
                subtext="24h"
              />
            </div>
          )}

          {/* ── Azure AI Search ── */}
          <SectionHeader icon={Search} title="Azure AI Search" />

          {!data.aiSearchConfigured ? (
            <UnconfiguredBanner
              resource="Azure AI Search"
              envVars={["AZURE_SEARCH_RESOURCE_ID"]}
            />
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <MetricCard
                label="Document Count"
                value={data.aiSearch.documentCount}
                unit=""
                subtext="indexed docs"
              />
              <MetricCard
                label="Query Latency"
                value={data.aiSearch.queryLatencyMs}
                unit="ms"
                highlight="yellow"
                subtext="avg response"
              />
              <MetricCard
                label="Throttled Queries"
                value={data.aiSearch.throttledQueryPct}
                unit="%"
                highlight="red"
              />
              <MetricCard
                label="Total Queries"
                value={data.aiSearch.totalQueries}
                unit=""
                subtext="24h"
              />
            </div>
          )}

          <p className="text-xs" style={{ color: "var(--orbit-text-muted)" }}>
            Captured at {new Date(data.capturedAt).toLocaleString()} · metrics via Azure Monitor REST API
          </p>
        </>
      ) : null}
    </div>
  );
}
