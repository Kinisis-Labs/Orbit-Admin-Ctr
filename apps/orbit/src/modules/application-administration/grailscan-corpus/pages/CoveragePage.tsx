import { BarChart3, CheckCircle2, Layers3, Target } from "lucide-react";
import { useCoverageSummary } from "../api/hooks";
import { ErrorState, LoadingState, Panel, StatusBadge } from "../components/Ui";

function CoverageBar({ label, value, maximum }: { label: string; value: number; maximum: number }) {
  const percent = maximum > 0 ? Math.min(100, (value / maximum) * 100) : 0;
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-3 text-xs">
        <span className="capitalize text-[var(--orbit-text-secondary)]">
          {label.replaceAll("_", " ")}
        </span>
        <span className="font-mono text-[var(--orbit-text-primary)]">{value}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-[var(--orbit-bg-page)]">
        <div
          className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-violet-500"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

export function CorpusCoveragePage() {
  const coverage = useCoverageSummary();
  if (coverage.isLoading) return <LoadingState label="Computing corpus coverage…" />;
  if (coverage.error || !coverage.data) {
    return <ErrorState error={coverage.error} retry={() => void coverage.refetch()} />;
  }
  const data = coverage.data;
  const percent = Math.min(100, (data.approved / data.targetImages) * 100);
  const categoryMaximum = Math.max(1, ...Object.values(data.byCategory));
  const statusMaximum = Math.max(1, ...Object.values(data.byStatus));
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Panel className="p-4">
          <p className="flex items-center gap-2 text-xs text-[var(--orbit-text-muted)]">
            <Target className="h-4 w-4 text-cyan-400" /> Production target
          </p>
          <p className="mt-2 text-3xl font-semibold">{data.targetImages}</p>
          <p className="mt-1 text-xs text-[var(--orbit-text-secondary)]">release-eligible images</p>
        </Panel>
        <Panel className="p-4">
          <p className="flex items-center gap-2 text-xs text-[var(--orbit-text-muted)]">
            <CheckCircle2 className="h-4 w-4 text-emerald-400" /> Approved evidence
          </p>
          <p className="mt-2 text-3xl font-semibold text-emerald-300">{data.approved}</p>
          <p className="mt-1 text-xs text-[var(--orbit-text-secondary)]">
            {percent.toFixed(1)}% of target
          </p>
        </Panel>
        <Panel className="p-4">
          <p className="flex items-center gap-2 text-xs text-[var(--orbit-text-muted)]">
            <Layers3 className="h-4 w-4 text-amber-400" /> Remaining
          </p>
          <p className="mt-2 text-3xl font-semibold text-amber-200">{data.remaining}</p>
          <p className="mt-1 text-xs text-[var(--orbit-text-secondary)]">
            additional eligible images
          </p>
        </Panel>
        <Panel className="p-4">
          <p className="flex items-center gap-2 text-xs text-[var(--orbit-text-muted)]">
            <BarChart3 className="h-4 w-4 text-violet-400" /> Categories
          </p>
          <p className="mt-2 text-3xl font-semibold">{Object.keys(data.byCategory).length}</p>
          <p className="mt-1 text-xs text-[var(--orbit-text-secondary)]">
            represented in approved pool
          </p>
        </Panel>
      </div>
      <Panel className="p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold">Target readiness</h2>
            <p className="mt-1 text-xs text-[var(--orbit-text-muted)]">
              Only completed, non-duplicate, non-purged, hash-verified images are counted.
            </p>
          </div>
          <span className="text-2xl font-semibold text-cyan-300">{percent.toFixed(1)}%</span>
        </div>
        <div className="mt-4 h-4 overflow-hidden rounded-full bg-[var(--orbit-bg-page)]">
          <div
            className="h-full rounded-full bg-gradient-to-r from-cyan-500 via-blue-500 to-violet-500"
            style={{ width: `${percent}%` }}
          />
        </div>
        <div className="mt-2 flex justify-between text-[11px] text-[var(--orbit-text-muted)]">
          <span>0</span>
          <span>{data.targetImages} image goal</span>
        </div>
      </Panel>
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel className="p-5">
          <div className="mb-5">
            <h2 className="text-sm font-semibold">Approved images by category</h2>
            <p className="mt-1 text-xs text-[var(--orbit-text-muted)]">
              Release-eligible images associated with the current verified identity.
            </p>
          </div>
          <div className="space-y-4">
            {Object.entries(data.byCategory)
              .sort(([, left], [, right]) => right - left)
              .map(([category, count]) => (
                <CoverageBar
                  key={category}
                  label={category}
                  value={count}
                  maximum={categoryMaximum}
                />
              ))}
            {Object.keys(data.byCategory).length === 0 && (
              <p className="py-10 text-center text-sm text-[var(--orbit-text-muted)]">
                No approved categories yet.
              </p>
            )}
          </div>
        </Panel>
        <Panel className="p-5">
          <div className="mb-5">
            <h2 className="text-sm font-semibold">Capture-group pipeline</h2>
            <p className="mt-1 text-xs text-[var(--orbit-text-muted)]">
              Operational distribution across the complete review lifecycle.
            </p>
          </div>
          <div className="space-y-4">
            {Object.entries(data.byStatus)
              .sort(([, left], [, right]) => right - left)
              .map(([status, count]) => (
                <div key={status}>
                  <div className="mb-1.5 flex items-center justify-between gap-3">
                    <StatusBadge value={status} />
                    <span className="font-mono text-xs">{count}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-[var(--orbit-bg-page)]">
                    <div
                      className="h-full rounded-full bg-cyan-500/70"
                      style={{ width: `${Math.min(100, (count / statusMaximum) * 100)}%` }}
                    />
                  </div>
                </div>
              ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}
