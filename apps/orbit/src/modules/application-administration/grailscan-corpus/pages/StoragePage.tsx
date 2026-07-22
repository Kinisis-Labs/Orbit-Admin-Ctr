import { Database, FileArchive, HardDrive, LockKeyhole, RefreshCw } from "lucide-react";
import { useStorageMetrics } from "../api/hooks";
import { ErrorState, LoadingState, Panel, StatusBadge } from "../components/Ui";

function bytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${(value / 1024 ** 3).toFixed(2)} GB`;
}

export function CorpusStoragePage() {
  const storage = useStorageMetrics();
  if (storage.isLoading) return <LoadingState label="Loading storage inventory…" />;
  if (storage.error || !storage.data) {
    return <ErrorState error={storage.error} retry={() => void storage.refetch()} />;
  }
  const data = storage.data;
  const imageCount = data.images.reduce((sum, row) => sum + row.objectCount, 0);
  const imageBytes = data.images.reduce((sum, row) => sum + row.knownBytes, 0);
  return (
    <div className="space-y-4">
      <Panel className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <LockKeyhole className="h-5 w-5 text-emerald-400" />
              <h2 className="text-lg font-semibold">Private storage inventory</h2>
              <StatusBadge value={data.status} />
            </div>
            <p className="mt-2 text-xs text-[var(--orbit-text-secondary)]">
              Database-derived object counts only. Blob keys, container identifiers, and signed URLs
              are never exposed.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void storage.refetch()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--orbit-border)] px-3 py-2 text-xs"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </button>
        </div>
      </Panel>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Panel className="p-4">
          <p className="flex items-center gap-2 text-xs text-[var(--orbit-text-muted)]">
            <HardDrive className="h-4 w-4 text-cyan-400" />
            Images
          </p>
          <p className="mt-2 text-2xl font-semibold">{imageCount}</p>
          <p className="mt-1 text-xs text-[var(--orbit-text-secondary)]">
            {bytes(imageBytes)} known bytes
          </p>
        </Panel>
        <Panel className="p-4">
          <p className="flex items-center gap-2 text-xs text-[var(--orbit-text-muted)]">
            <Database className="h-4 w-4 text-violet-400" />
            Recorded bundles
          </p>
          <p className="mt-2 text-2xl font-semibold">{data.recordedBundles.objectCount}</p>
          <p className="mt-1 text-xs text-[var(--orbit-text-secondary)]">
            {bytes(data.recordedBundles.knownPlaintextBytes)} plaintext
          </p>
        </Panel>
        <Panel className="p-4">
          <p className="flex items-center gap-2 text-xs text-[var(--orbit-text-muted)]">
            <FileArchive className="h-4 w-4 text-amber-400" />
            Manifests
          </p>
          <p className="mt-2 text-2xl font-semibold">{data.manifests.objectCount}</p>
          <p className="mt-1 text-xs text-[var(--orbit-text-secondary)]">
            frozen or historical releases
          </p>
        </Panel>
        <Panel className="p-4">
          <p className="text-xs text-[var(--orbit-text-muted)]">Manifest members</p>
          <p className="mt-2 text-2xl font-semibold">{data.manifests.memberCount}</p>
          <p className="mt-1 text-xs text-[var(--orbit-text-secondary)]">
            immutable snapshot references
          </p>
        </Panel>
      </div>
      <Panel className="overflow-hidden">
        <div className="border-b border-[var(--orbit-border)] p-4">
          <h2 className="text-sm font-semibold">Image inventory by purge state</h2>
          <p className="mt-1 text-xs text-[var(--orbit-text-muted)]">
            Known source-image bytes grouped by lifecycle disposition.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-[var(--orbit-bg-page)] text-xs text-[var(--orbit-text-muted)]">
              <tr>
                <th className="px-4 py-3">Purge state</th>
                <th className="px-4 py-3">Objects</th>
                <th className="px-4 py-3">Known bytes</th>
                <th className="px-4 py-3">Share</th>
              </tr>
            </thead>
            <tbody>
              {data.images.map((row) => (
                <tr key={row.purgeState} className="border-t border-[var(--orbit-border)]">
                  <td className="px-4 py-3">
                    <StatusBadge value={row.purgeState} />
                  </td>
                  <td className="px-4 py-3 font-mono">{row.objectCount}</td>
                  <td className="px-4 py-3 font-mono">{bytes(row.knownBytes)}</td>
                  <td className="px-4 py-3">
                    <div className="h-2 max-w-xs overflow-hidden rounded-full bg-[var(--orbit-bg-page)]">
                      <div
                        className="h-full rounded-full bg-cyan-500"
                        style={{
                          width: `${imageCount ? (row.objectCount / imageCount) * 100 : 0}%`,
                        }}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <p className="text-right text-[11px] text-[var(--orbit-text-muted)]">
        Generated {new Date(data.generatedAt).toLocaleString()}
      </p>
    </div>
  );
}
