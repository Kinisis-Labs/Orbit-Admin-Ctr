import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  CircleDollarSign,
  Clock3,
  FlaskConical,
  Play,
  ShieldCheck,
  Target,
  XCircle,
} from "lucide-react";
import { usePermission } from "../../../../hooks/usePermission";
import {
  parseRegressionAccuracy,
  useCorpusVersions,
  useCreateRegressionRun,
  useRegressionResults,
  useRegressionRun,
  useRegressionRuns,
} from "../api/hooks";
import { ErrorState, LoadingState, Panel, StatusBadge } from "../components/Ui";

function summaryNumber(summary: Record<string, unknown> | null, key: string): number | null {
  return summary && typeof summary[key] === "number" ? summary[key] : null;
}

export function CorpusRegressionPage() {
  const canRun = usePermission("grailscan.corpus.run_regression");
  const versions = useCorpusVersions();
  const runs = useRegressionRuns();
  const createRun = useCreateRegressionRun();
  const [selectedRunId, setSelectedRunId] = useState("");
  const [versionId, setVersionId] = useState("");
  const [priorRunId, setPriorRunId] = useState("");
  const [failuresOnly, setFailuresOnly] = useState(false);
  const run = useRegressionRun(selectedRunId);
  const results = useRegressionResults(selectedRunId, failuresOnly);
  useEffect(() => {
    if (!selectedRunId && runs.data?.runs[0]) setSelectedRunId(runs.data.runs[0].id);
  }, [runs.data, selectedRunId]);
  useEffect(() => {
    if (!versionId) {
      const eligible = versions.data?.versions.find(
        (item) => item.status === "active" || item.status === "frozen",
      );
      if (eligible) setVersionId(eligible.id);
    }
  }, [versionId, versions.data]);
  const selected = run.data?.run;
  const eligibleVersions =
    versions.data?.versions.filter(
      (item) => item.status === "active" || item.status === "frozen",
    ) ?? [];
  const eligibleBaselines = useMemo(
    () =>
      runs.data?.runs.filter(
        (item) => item.versionId === versionId && item.status === "completed",
      ) ?? [],
    [runs.data, versionId],
  );
  if (versions.isLoading || runs.isLoading)
    return <LoadingState label="Loading regression operations…" />;
  if (versions.error || runs.error) {
    return <ErrorState error={versions.error ?? runs.error} retry={() => void runs.refetch()} />;
  }
  const accuracy = parseRegressionAccuracy(selected?.summaryJson ?? null);
  const failureRate = summaryNumber(selected?.summaryJson ?? null, "failureRate");
  const matched = summaryNumber(selected?.summaryJson ?? null, "matched");
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    createRun.mutate(
      { versionId, priorRunId: priorRunId || undefined },
      { onSuccess: ({ run: created }) => setSelectedRunId(created.id) },
    );
  };
  return (
    <div className="space-y-4">
      <Panel className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <FlaskConical className="h-4 w-4 text-violet-400" /> Recorded-evidence regression
            </h2>
            <p className="mt-1 max-w-2xl text-xs text-[var(--orbit-text-muted)]">
              Replays frozen provider evidence with outbound provider calls disabled and zero
              external cost.
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-emerald-300">
            <ShieldCheck className="h-4 w-4" /> Recorded mode enforced
          </div>
        </div>
        {canRun && (
          <form onSubmit={submit} className="mt-4 grid gap-3 md:grid-cols-[1fr_1fr_auto]">
            <label className="text-xs">
              Frozen or active corpus version
              <select
                required
                value={versionId}
                onChange={(event) => {
                  setVersionId(event.target.value);
                  setPriorRunId("");
                }}
                className="mt-1 h-9 w-full rounded-lg border border-[var(--orbit-border)] bg-[var(--orbit-bg-page)] px-3 text-sm"
              >
                <option value="">Select version</option>
                {eligibleVersions.map((version) => (
                  <option key={version.id} value={version.id}>
                    v{version.versionName} · {version.status}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs">
              Comparison baseline
              <select
                value={priorRunId}
                onChange={(event) => setPriorRunId(event.target.value)}
                className="mt-1 h-9 w-full rounded-lg border border-[var(--orbit-border)] bg-[var(--orbit-bg-page)] px-3 text-sm"
              >
                <option value="">No baseline</option>
                {eligibleBaselines.map((baseline) => (
                  <option key={baseline.id} value={baseline.id}>
                    {new Date(baseline.createdAt).toLocaleString()}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              disabled={!versionId || createRun.isPending}
              className="mt-5 inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-violet-600 px-4 text-sm font-medium text-white disabled:opacity-40"
            >
              <Play className="h-4 w-4" /> {createRun.isPending ? "Queueing…" : "Run regression"}
            </button>
          </form>
        )}
        {createRun.error && (
          <div className="mt-3">
            <ErrorState error={createRun.error} />
          </div>
        )}
      </Panel>
      <div className="grid gap-4 xl:grid-cols-[330px_minmax(0,1fr)]">
        <Panel className="h-fit overflow-hidden">
          <div className="border-b border-[var(--orbit-border)] p-4">
            <h3 className="text-sm font-semibold">Run history</h3>
            <p className="mt-1 text-xs text-[var(--orbit-text-muted)]">
              {runs.data?.runs.length ?? 0} immutable runs
            </p>
          </div>
          <div className="max-h-[72vh] overflow-y-auto p-2">
            {runs.data?.runs.map((item) => {
              const itemAccuracy = parseRegressionAccuracy(item.summaryJson);
              const version = versions.data?.versions.find(
                (candidate) => candidate.id === item.versionId,
              );
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSelectedRunId(item.id)}
                  className={`mb-1 w-full rounded-lg border p-3 text-left ${selectedRunId === item.id ? "border-violet-500/50 bg-violet-500/10" : "border-transparent hover:bg-[var(--orbit-bg-card-hover)]"}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">
                      v{version?.versionName ?? item.versionId.slice(0, 8)}
                    </span>
                    <StatusBadge value={item.status} />
                  </div>
                  <p className="mt-1 text-xs text-[var(--orbit-text-muted)]">
                    {itemAccuracy == null
                      ? `${item.completedCount}/${item.totalCount}`
                      : `${(itemAccuracy * 100).toFixed(1)}% accuracy`}{" "}
                    · {new Date(item.createdAt).toLocaleDateString()}
                  </p>
                </button>
              );
            })}
          </div>
        </Panel>
        <div>
          {run.isLoading && <LoadingState label="Loading regression run…" />}
          {run.error && <ErrorState error={run.error} retry={() => void run.refetch()} />}
          {selected && (
            <div className="space-y-4">
              <Panel className="p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold">Regression {selected.id.slice(0, 8)}</h3>
                      <StatusBadge value={selected.status} />
                    </div>
                    <p className="mt-1 text-xs text-[var(--orbit-text-muted)]">
                      {selected.completedCount} of {selected.totalCount} members processed
                    </p>
                  </div>
                  <span className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
                    External provider cost: ${selected.providerCostUsd}
                  </span>
                </div>
                {(selected.status === "queued" || selected.status === "running") && (
                  <div className="mt-4 h-2 overflow-hidden rounded-full bg-[var(--orbit-bg-page)]">
                    <div
                      className="h-full rounded-full bg-violet-500 transition-all"
                      style={{
                        width: `${selected.totalCount > 0 ? (selected.completedCount / selected.totalCount) * 100 : 0}%`,
                      }}
                    />
                  </div>
                )}
              </Panel>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <Panel className="p-4">
                  <p className="flex items-center gap-2 text-xs text-[var(--orbit-text-muted)]">
                    <Target className="h-4 w-4 text-emerald-400" />
                    Accuracy
                  </p>
                  <p className="mt-2 text-2xl font-semibold">
                    {accuracy == null ? "—" : `${(accuracy * 100).toFixed(2)}%`}
                  </p>
                </Panel>
                <Panel className="p-4">
                  <p className="flex items-center gap-2 text-xs text-[var(--orbit-text-muted)]">
                    <XCircle className="h-4 w-4 text-red-400" />
                    Failure rate
                  </p>
                  <p className="mt-2 text-2xl font-semibold">
                    {failureRate == null ? "—" : `${(failureRate * 100).toFixed(2)}%`}
                  </p>
                </Panel>
                <Panel className="p-4">
                  <p className="flex items-center gap-2 text-xs text-[var(--orbit-text-muted)]">
                    <Activity className="h-4 w-4 text-cyan-400" />
                    Matched
                  </p>
                  <p className="mt-2 text-2xl font-semibold">{matched ?? "—"}</p>
                </Panel>
                <Panel className="p-4">
                  <p className="flex items-center gap-2 text-xs text-[var(--orbit-text-muted)]">
                    <CircleDollarSign className="h-4 w-4 text-emerald-400" />
                    Provider cost
                  </p>
                  <p className="mt-2 text-2xl font-semibold">${selected.providerCostUsd}</p>
                </Panel>
              </div>
              <Panel className="overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--orbit-border)] p-4">
                  <div>
                    <h3 className="text-sm font-semibold">Per-member outcomes</h3>
                    <p className="mt-1 text-xs text-[var(--orbit-text-muted)]">
                      Expected versus recorded-provider prediction.
                    </p>
                  </div>
                  <label className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={failuresOnly}
                      onChange={(event) => setFailuresOnly(event.target.checked)}
                    />
                    Failures only
                  </label>
                </div>
                {results.isLoading ? (
                  <LoadingState label="Loading outcomes…" />
                ) : results.error ? (
                  <ErrorState error={results.error} retry={() => void results.refetch()} />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-[var(--orbit-bg-page)] text-[var(--orbit-text-muted)]">
                        <tr>
                          <th className="px-4 py-2">Member</th>
                          <th className="px-4 py-2">Result</th>
                          <th className="px-4 py-2">Confidence</th>
                          <th className="px-4 py-2">Latency</th>
                          <th className="px-4 py-2">Failure</th>
                        </tr>
                      </thead>
                      <tbody>
                        {results.data?.results.map((result) => (
                          <tr key={result.id} className="border-t border-[var(--orbit-border)]">
                            <td className="px-4 py-3 font-mono">
                              {result.versionMemberId.slice(0, 12)}…
                            </td>
                            <td className="px-4 py-3">
                              <StatusBadge value={result.matched ? "matched" : "mismatch"} />
                            </td>
                            <td className="px-4 py-3">{result.confidence ?? "—"}</td>
                            <td className="px-4 py-3">
                              <span className="inline-flex items-center gap-1">
                                <Clock3 className="h-3 w-3" />
                                {result.latencyMs} ms
                              </span>
                            </td>
                            <td className="px-4 py-3">{result.failureCategory ?? "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {results.data?.results.length === 0 && (
                      <p className="p-10 text-center text-sm text-[var(--orbit-text-muted)]">
                        No outcomes match this filter.
                      </p>
                    )}
                  </div>
                )}
              </Panel>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
