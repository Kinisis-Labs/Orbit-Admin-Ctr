import { Activity, Database, FileCheck2, HardDrive, RefreshCw, ShieldCheck } from "lucide-react";
import { useCorpusHealth } from "../api/hooks";
import { ErrorState, LoadingState, Panel, StatusBadge } from "../components/Ui";

const COMPONENT_LABELS: Record<string, string> = {
  api: "Corpus API",
  database: "PostgreSQL",
  blob: "Private Blob storage",
  upload: "Upload pipeline",
  processing: "Image processing",
  review: "Human review",
  freeze: "Manifest freeze",
  regression: "Recorded regression",
  purge: "Rights purge",
  audit: "Audit trail",
  cleanup: "Ephemeral cleanup",
};

export function CorpusHealthPage() {
  const health = useCorpusHealth();
  if (health.isLoading) return <LoadingState label="Loading operational health…" />;
  if (health.error || !health.data) {
    return <ErrorState error={health.error} retry={() => void health.refetch()} />;
  }
  const data = health.data;
  const degraded = Object.values(data.components).filter((status) => status === "Degraded").length;
  const unknown = Object.values(data.components).filter((status) => status === "Unknown").length;
  return (
    <div className="space-y-4">
      <Panel className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--orbit-text-muted)]">
              Overall status
            </p>
            <div className="mt-2 flex items-center gap-3">
              <Activity className="h-7 w-7 text-cyan-400" />
              <h2 className="text-2xl font-semibold">{data.status}</h2>
              <StatusBadge value={data.status} />
            </div>
            <p className="mt-2 text-xs text-[var(--orbit-text-secondary)]">
              Generated {new Date(data.generatedAt).toLocaleString()}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void health.refetch()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--orbit-border)] px-3 py-2 text-xs"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </button>
        </div>
      </Panel>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Panel className="p-4">
          <p className="text-xs text-[var(--orbit-text-muted)]">Ready for review</p>
          <p className="mt-2 text-2xl font-semibold">{data.counts.readyForReview}</p>
        </Panel>
        <Panel className="p-4">
          <p className="text-xs text-[var(--orbit-text-muted)]">Pending freezes</p>
          <p className="mt-2 text-2xl font-semibold">{data.counts.pendingFreezeOperations}</p>
        </Panel>
        <Panel className="p-4">
          <p className="text-xs text-[var(--orbit-text-muted)]">Degraded components</p>
          <p className="mt-2 text-2xl font-semibold text-amber-300">{degraded}</p>
        </Panel>
        <Panel className="p-4">
          <p className="text-xs text-[var(--orbit-text-muted)]">Unknown probes</p>
          <p className="mt-2 text-2xl font-semibold text-sky-300">{unknown}</p>
        </Panel>
      </div>
      <Panel className="p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <ShieldCheck className="h-4 w-4 text-emerald-400" />
          Component health
        </h2>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {Object.entries(data.components).map(([name, status]) => (
            <div
              key={name}
              className="flex items-center justify-between rounded-lg border border-[var(--orbit-border)] bg-[var(--orbit-bg-page)] p-3"
            >
              <span className="text-sm">{COMPONENT_LABELS[name] ?? name}</span>
              <StatusBadge value={status} />
            </div>
          ))}
        </div>
      </Panel>
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel className="p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <FileCheck2 className="h-4 w-4 text-violet-400" />
            Capabilities
          </h2>
          <div className="mt-4 grid grid-cols-2 gap-3">
            {Object.entries(data.capabilities).map(([name, enabled]) => (
              <div key={name} className="rounded-lg border border-[var(--orbit-border)] p-3">
                <p className="capitalize text-xs text-[var(--orbit-text-muted)]">{name}</p>
                <p
                  className={`mt-1 text-sm font-medium ${enabled ? "text-emerald-300" : "text-red-300"}`}
                >
                  {enabled ? "Enabled" : "Disabled"}
                </p>
              </div>
            ))}
          </div>
        </Panel>
        <Panel className="p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Database className="h-4 w-4 text-cyan-400" />
            Workload counts
          </h2>
          <div className="mt-4 space-y-3 text-xs">
            <div className="flex justify-between">
              <span className="text-[var(--orbit-text-muted)]">Processing states</span>
              <span>
                {Object.values(data.counts.processing).reduce((sum, value) => sum + value, 0)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--orbit-text-muted)]">Purge operations</span>
              <span>
                {Object.values(data.counts.purges).reduce((sum, value) => sum + value, 0)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--orbit-text-muted)]">Regression runs</span>
              <span>
                {Object.values(data.counts.regressions).reduce((sum, value) => sum + value, 0)}
              </span>
            </div>
            <div className="flex items-center gap-2 rounded-lg bg-[var(--orbit-bg-page)] p-3 text-[var(--orbit-text-secondary)]">
              <HardDrive className="h-4 w-4" />
              Blob and upload probes remain Unknown when only database-derived telemetry is
              available.
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}
