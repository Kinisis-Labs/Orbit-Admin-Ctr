import { Link } from "react-router-dom";
import { AlertTriangle, ArrowRight, Database, Images, ScanSearch, Upload } from "lucide-react";
import { useCorpusOverview } from "../api/hooks";
import { ErrorState, LoadingState, Panel, StatusBadge } from "../components/Ui";

export function CorpusOverviewPage() {
  const query = useCorpusOverview();
  if (query.isLoading) return <LoadingState />;
  if (query.error || !query.data)
    return <ErrorState error={query.error} retry={() => void query.refetch()} />;
  const { metrics } = query.data;
  const cards = [
    [
      "Submissions",
      metrics.totalSubmissions,
      `${metrics.incompleteSubmissions} incomplete`,
      Upload,
    ],
    ["Review ready", metrics.reviewReadyGroups, `${metrics.claimedReviews} claimed`, ScanSearch],
    [
      "Approved pool",
      metrics.approvedPoolSize,
      `${metrics.targetProgressPercent.toFixed(1)}% of target`,
      Images,
    ],
    [
      "Processing queue",
      metrics.processingQueueDepth,
      `${metrics.failedProcessingStages} failed stages`,
      Database,
    ],
  ] as const;
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map(([label, value, detail, Icon]) => (
          <Panel key={label} className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs uppercase tracking-wider text-[var(--orbit-text-muted)]">
                  {label}
                </p>
                <p className="mt-2 text-3xl font-semibold">{value}</p>
              </div>
              <Icon className="h-5 w-5 text-cyan-400" />
            </div>
            <p className="mt-2 text-xs text-[var(--orbit-text-secondary)]">{detail}</p>
          </Panel>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Panel className="p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Operational alerts</h2>
            <span className="text-xs text-[var(--orbit-text-muted)]">
              Updated {new Date(query.data.generatedAt).toLocaleTimeString()}
            </span>
          </div>
          <div className="mt-4 space-y-2">
            {query.data.alerts.length === 0 ? (
              <p className="py-8 text-center text-sm text-[var(--orbit-text-muted)]">
                No active Golden Corpus alerts.
              </p>
            ) : (
              query.data.alerts.map((alert) => (
                <div
                  key={`${alert.code}-${alert.targetId}`}
                  className="flex items-center gap-3 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3"
                >
                  <AlertTriangle className="h-4 w-4 text-amber-400" />
                  <div className="flex-1">
                    <p className="text-sm font-medium">{alert.code.replaceAll("_", " ")}</p>
                    <p className="text-xs text-[var(--orbit-text-muted)]">
                      {alert.count} affected {alert.targetType}
                    </p>
                  </div>
                  <StatusBadge value={alert.severity} />
                </div>
              ))
            )}
          </div>
        </Panel>
        <Panel className="p-5">
          <h2 className="text-sm font-semibold">Shortcuts</h2>
          <div className="mt-3 space-y-2">
            {[
              ["New submission", "/admin/applications/grailscan-corpus/submissions?create=1"],
              ["Open submissions", "/admin/applications/grailscan-corpus/submissions"],
              ["Review queue", "/admin/applications/grailscan-corpus/review"],
            ].map(([label, to]) => (
              <Link
                key={label}
                to={to}
                className="flex items-center justify-between rounded-lg border border-[var(--orbit-border)] px-3 py-2 text-sm hover:bg-[var(--orbit-bg-card-hover)]"
              >
                <span>{label}</span>
                <ArrowRight className="h-4 w-4" />
              </Link>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}
