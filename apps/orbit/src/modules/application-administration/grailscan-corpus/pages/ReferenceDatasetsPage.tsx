import { useEffect, useState } from "react";
import { Play, RefreshCw } from "lucide-react";
import { usePermission } from "../../../../hooks/usePermission";
import { ErrorState, LoadingState, Panel, StatusBadge } from "../components/Ui";
import {
  ReferenceDatasetOperations,
  type ReferenceDatasetDetail,
} from "../components/ReferenceDatasetOperations";

interface Dataset {
  id: string;
  datasetKey: string;
  displayName: string;
  providerKey: string;
  termsVersion: string | null;
  imagePersistenceApproved: boolean;
  currentPublishedRevisionId: string | null;
  updatedAt: string;
}

interface DatasetResponse {
  datasets: Dataset[];
}

function key(operation: string): string {
  return `${operation}:${crypto.randomUUID()}`;
}

async function referenceApi<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/reference-datasets${path}`, {
    ...init,
    credentials: "same-origin",
    headers: {
      accept: "application/json",
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      typeof body === "object" && body !== null && "error" in body
        ? String((body as { error?: { message?: unknown } }).error?.message ?? "Request failed")
        : "Request failed";
    throw new Error(message);
  }
  return body as T;
}

export function ReferenceDatasetsPage() {
  const canManage = usePermission("grailscan.corpus.reference.manage");
  const canPublish = usePermission("grailscan.corpus.reference.publish");
  const [data, setData] = useState<DatasetResponse | null>(null);
  const [details, setDetails] = useState<Record<string, ReferenceDatasetDetail>>({});
  const [selectedDatasetKey, setSelectedDatasetKey] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await referenceApi<DatasetResponse>("/datasets"));
    } catch (requestError) {
      setError(requestError);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const loadDetail = async (datasetKey: string) => {
    setSelectedDatasetKey(datasetKey);
    setError(null);
    try {
      const detail = await referenceApi<ReferenceDatasetDetail>(`/datasets/${datasetKey}`);
      setDetails((current) => ({ ...current, [datasetKey]: detail }));
    } catch (requestError) {
      setError(requestError);
    }
  };

  const commandRun = async (
    datasetKey: string,
    runId: string,
    command: "pause" | "resume" | "cancel" | "retry",
  ) => {
    setStarting(runId);
    try {
      await referenceApi(`/runs/${runId}/commands`, {
        method: "POST",
        headers: { "idempotency-key": key(`reference-sync-${command}`) },
        body: JSON.stringify({ command }),
      });
      await loadDetail(datasetKey);
    } catch (requestError) {
      setError(requestError);
    } finally {
      setStarting(null);
    }
  };

  const publishRevision = async (datasetKey: string, revisionId: string) => {
    setStarting(revisionId);
    try {
      if (!window.confirm("Publish this immutable reference dataset revision?")) return;
      await referenceApi(`/revisions/${revisionId}/publish`, {
        method: "POST",
        headers: { "idempotency-key": key("reference-sync-publish") },
        body: JSON.stringify({}),
      });
      await Promise.all([load(), loadDetail(datasetKey)]);
    } catch (requestError) {
      setError(requestError);
    } finally {
      setStarting(null);
    }
  };

  const startDryRun = async (dataset: Dataset) => {
    setStarting(dataset.id);
    setError(null);
    try {
      await referenceApi(`/datasets/${dataset.datasetKey}/runs`, {
        method: "POST",
        headers: { "idempotency-key": key("reference-sync-start") },
        body: JSON.stringify({ dryRun: true }),
      });
      await load();
    } catch (requestError) {
      setError(requestError);
    } finally {
      setStarting(null);
    }
  };

  if (loading) return <LoadingState label="Loading reference datasets…" />;
  if (error && !data) return <ErrorState error={error} retry={() => void load()} />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Reference Datasets</h2>
          <p className="mt-1 text-sm text-[var(--orbit-text-secondary)]">
            Provider-owned reference assets remain isolated from user Golden Corpus captures.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="flex items-center gap-1.5 rounded-lg border border-[var(--orbit-border)] px-3 py-2 text-sm"
        >
          <RefreshCw className="h-4 w-4" />
          Refresh
        </button>
      </div>
      {Boolean(error) && <ErrorState error={error} retry={() => void load()} />}
      <div className="grid gap-4 lg:grid-cols-2">
        {data?.datasets.map((dataset) => (
          <Panel key={dataset.id} className="p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-semibold">{dataset.displayName}</h3>
                <p className="mt-1 font-mono text-xs text-[var(--orbit-text-muted)]">
                  {dataset.providerKey} · {dataset.datasetKey}
                </p>
              </div>
              <StatusBadge
                value={dataset.currentPublishedRevisionId ? "published" : "unpublished"}
              />
            </div>
            <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs text-[var(--orbit-text-muted)]">Image terms</dt>
                <dd>{dataset.termsVersion ?? "Not approved"}</dd>
              </div>
              <div>
                <dt className="text-xs text-[var(--orbit-text-muted)]">Image persistence</dt>
                <dd>{dataset.imagePersistenceApproved ? "Approved" : "Metadata only"}</dd>
              </div>
            </dl>
            <div className="mt-5 flex justify-between gap-2">
              <button
                type="button"
                onClick={() => void loadDetail(dataset.datasetKey)}
                className="rounded-lg border border-[var(--orbit-border)] px-3 py-2 text-sm"
              >
                {selectedDatasetKey === dataset.datasetKey
                  ? "Refresh operations"
                  : "View operations"}
              </button>
              {canManage && (
                <button
                  type="button"
                  disabled={starting === dataset.id}
                  onClick={() => void startDryRun(dataset)}
                  className="flex items-center gap-1.5 rounded-lg bg-[var(--orbit-primary)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  <Play className="h-4 w-4" />
                  {starting === dataset.id ? "Starting…" : "Start dry run"}
                </button>
              )}
            </div>
          </Panel>
        ))}
      </div>
      {selectedDatasetKey && details[selectedDatasetKey] && (
        <ReferenceDatasetOperations
          detail={details[selectedDatasetKey]}
          canManage={canManage}
          canPublish={canPublish}
          busy={starting}
          command={(runId, command) => void commandRun(selectedDatasetKey, runId, command)}
          publish={(revisionId) => void publishRevision(selectedDatasetKey, revisionId)}
        />
      )}
      {data?.datasets.length === 0 && (
        <Panel className="p-12 text-center text-sm text-[var(--orbit-text-muted)]">
          No reference datasets are configured.
        </Panel>
      )}
    </div>
  );
}
