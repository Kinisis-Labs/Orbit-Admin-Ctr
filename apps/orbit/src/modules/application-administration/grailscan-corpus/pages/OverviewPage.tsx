import { Link } from "react-router-dom";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Cloud,
  Database,
  Images,
  Network,
  ScanSearch,
  Upload,
} from "lucide-react";
import { useCorpusOverview } from "../api/hooks";
import { DatasetDevelopmentStatus } from "../components/DatasetDevelopmentStatus";
import { LoadingState, Panel, StatusBadge } from "../components/Ui";
import { datasetAdminConfiguration } from "../configuration";

export function CorpusOverviewPage() {
  const query = useCorpusOverview();
  if (query.isLoading && !datasetAdminConfiguration.developerMode) return <LoadingState />;
  const metrics = query.data?.metrics;
  const cards = [
    ["Provider", "Card Hedge", "Reference provider", Network],
    [
      "User evidence",
      metrics?.totalSubmissions ?? 0,
      `${metrics?.incompleteSubmissions ?? 0} incomplete`,
      Upload,
    ],
    [
      "Approved evidence",
      metrics?.approvedPoolSize ?? 0,
      `${metrics?.targetProgressPercent.toFixed(1) ?? "0.0"}% of target`,
      Images,
    ],
    [
      "Synchronization",
      metrics?.processingQueueDepth ?? 0,
      `${metrics?.failedProcessingStages ?? 0} failed stages`,
      Activity,
    ],
    [
      "Dataset versions",
      query.data?.activeVersion?.versionName ?? "No published version",
      "Current published dataset",
      Database,
    ],
    ["Coverage", "Not yet calculated", "Categories, sets, cards, and images", ScanSearch],
    ["Publication", "Ready", "Draft and immutable publication lifecycle", Cloud],
    [
      "Regression",
      query.data?.latestRegression?.status ?? "Not yet configured",
      "Recorded evidence regression suite",
      Activity,
    ],
  ] as const;
  return (
    <div className="space-y-5">
      <DatasetDevelopmentStatus unavailable={Boolean(query.error || !query.data)} />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map(([label, value, detail, Icon]) => (
          <Panel key={label} className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs uppercase tracking-wider text-[var(--orbit-text-muted)]">
                  {label}
                </p>
                <p className="mt-2 text-3xl font-semibold">{String(value)}</p>
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
              Updated{" "}
              {query.data
                ? new Date(query.data.generatedAt).toLocaleTimeString()
                : "Awaiting metrics"}
            </span>
          </div>
          <div className="mt-4 space-y-2">
            {!query.data ? (
              <p className="py-8 text-center text-sm text-[var(--orbit-text-muted)]">
                Backend metrics are unavailable. Configuration and provider diagnostics remain
                visible in development mode.
              </p>
            ) : query.data.alerts.length === 0 ? (
              <p className="py-8 text-center text-sm text-[var(--orbit-text-muted)]">
                No active Dataset Administration alerts.
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
              ["Provider datasets", "/admin/applications/grailscan-corpus/reference-datasets"],
              ["User submissions", "/admin/applications/grailscan-corpus/submissions"],
              ["Dataset versions", "/admin/applications/grailscan-corpus/versions"],
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
