import { useEffect, useState } from "react";
import { CheckCircle2, ImageIcon, Layers3, Plus, RefreshCw } from "lucide-react";
import { usePermission } from "../../../../hooks/usePermission";
import {
  useApprovedPool,
  useCorpusVersion,
  useCorpusVersions,
  useGroup,
  useImagePreview,
  useVersionActions,
} from "../api/hooks";
import type { CorpusImage } from "../api/schemas";
import { ErrorState, LoadingState, Panel, StatusBadge } from "../components/Ui";

function ApprovedImage({
  image,
  selectedVersionId,
  included,
  canManage,
}: {
  image: CorpusImage;
  selectedVersionId: string;
  included: boolean;
  canManage: boolean;
}) {
  const preview = useImagePreview(image.id, true);
  const actions = useVersionActions(selectedVersionId);
  return (
    <div className="overflow-hidden rounded-lg border border-[var(--orbit-border)] bg-[var(--orbit-bg-page)]">
      <div className="aspect-[4/3] bg-black/20">
        {preview.data ? (
          <img
            src={preview.data.url}
            alt={`${image.side} approved capture`}
            className="h-full w-full object-contain"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-[var(--orbit-text-muted)]">
            Preview unavailable
          </div>
        )}
      </div>
      <div className="p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-xs font-medium">{image.originalFilename}</p>
            <p className="mt-1 text-[11px] text-[var(--orbit-text-muted)]">
              {image.widthPixels} × {image.heightPixels} · {image.side}
            </p>
          </div>
          {included ? (
            <span className="inline-flex items-center gap-1 text-[11px] text-emerald-300">
              <CheckCircle2 className="h-3.5 w-3.5" /> Included
            </span>
          ) : (
            <button
              type="button"
              disabled={!canManage || !selectedVersionId || actions.addMember.isPending}
              onClick={() => actions.addMember.mutate(image.id)}
              className="inline-flex items-center gap-1 rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-2.5 py-1.5 text-[11px] text-cyan-200 disabled:opacity-40"
            >
              <Plus className="h-3.5 w-3.5" />
              Add
            </button>
          )}
        </div>
        {actions.addMember.error && (
          <div className="mt-2">
            <ErrorState error={actions.addMember.error} />
          </div>
        )}
      </div>
    </div>
  );
}

export function CorpusApprovedPoolPage() {
  const canManageVersions = usePermission("grailscan.corpus.manage_versions");
  const approved = useApprovedPool();
  const versions = useCorpusVersions();
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [selectedVersionId, setSelectedVersionId] = useState("");
  const group = useGroup(selectedGroupId);
  const version = useCorpusVersion(selectedVersionId);
  useEffect(() => {
    if (!selectedGroupId && approved.data?.items[0]) {
      setSelectedGroupId(approved.data.items[0].group.id);
    }
  }, [approved.data, selectedGroupId]);
  useEffect(() => {
    if (!selectedVersionId) {
      const draft = versions.data?.versions.find((item) => item.status === "draft");
      if (draft) setSelectedVersionId(draft.id);
    }
  }, [selectedVersionId, versions.data]);
  if (approved.isLoading || versions.isLoading)
    return <LoadingState label="Loading approved pool…" />;
  if (approved.error || versions.error) {
    return (
      <ErrorState error={approved.error ?? versions.error} retry={() => void approved.refetch()} />
    );
  }
  const includedImageIds = new Set(version.data?.members.map((member) => member.imageId) ?? []);
  const draftVersions = versions.data?.versions.filter((item) => item.status === "draft") ?? [];
  return (
    <div className="space-y-4">
      <Panel className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Layers3 className="h-4 w-4 text-emerald-400" /> Approved asset pool
            </h2>
            <p className="mt-1 text-xs text-[var(--orbit-text-muted)]">
              Review-approved evidence eligible for immutable corpus release snapshots.
            </p>
          </div>
          <label className="text-xs text-[var(--orbit-text-secondary)]">
            Draft release target
            <select
              value={selectedVersionId}
              onChange={(event) => setSelectedVersionId(event.target.value)}
              disabled={!canManageVersions}
              className="ml-2 h-9 min-w-48 rounded-lg border border-[var(--orbit-border)] bg-[var(--orbit-bg-page)] px-3 text-sm"
            >
              <option value="">Select a draft version</option>
              {draftVersions.map((item) => (
                <option key={item.id} value={item.id}>
                  v{item.versionName} · {item.memberCount} members
                </option>
              ))}
            </select>
          </label>
        </div>
      </Panel>
      <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
        <Panel className="h-fit overflow-hidden">
          <div className="flex items-center justify-between border-b border-[var(--orbit-border)] p-4">
            <div>
              <h3 className="text-sm font-semibold">Approved groups</h3>
              <p className="text-xs text-[var(--orbit-text-muted)]">
                {approved.data?.items.length ?? 0} available
              </p>
            </div>
            <button
              type="button"
              onClick={() => void approved.refetch()}
              aria-label="Refresh approved pool"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>
          <div className="max-h-[70vh] overflow-y-auto p-2">
            {approved.data?.items.map(({ group: item, imageCount }) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setSelectedGroupId(item.id)}
                className={`mb-1 w-full rounded-lg border p-3 text-left ${selectedGroupId === item.id ? "border-emerald-500/50 bg-emerald-500/10" : "border-transparent hover:bg-[var(--orbit-bg-card-hover)]"}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium">
                    {item.workingLabel ?? item.id.slice(0, 8)}
                  </span>
                  <StatusBadge value={item.status} />
                </div>
                <p className="mt-1 text-xs text-[var(--orbit-text-muted)]">
                  {imageCount} eligible images
                </p>
              </button>
            ))}
          </div>
        </Panel>
        <div>
          {group.isLoading && <LoadingState label="Loading approved evidence…" />}
          {group.error && <ErrorState error={group.error} retry={() => void group.refetch()} />}
          {group.data && (
            <div className="space-y-4">
              <Panel className="p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="font-semibold">
                      {group.data.group.workingLabel ?? "Approved capture"}
                    </h3>
                    <p className="mt-1 font-mono text-[11px] text-[var(--orbit-text-muted)]">
                      {group.data.group.id}
                    </p>
                  </div>
                  <StatusBadge value={group.data.group.status} />
                </div>
              </Panel>
              <Panel className="p-4">
                <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                  <ImageIcon className="h-4 w-4 text-cyan-400" /> Eligible images
                </h3>
                {!selectedVersionId && (
                  <p className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
                    Create or select a draft corpus version before adding images.
                  </p>
                )}
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {group.data.images.map((image) => (
                    <ApprovedImage
                      key={image.id}
                      image={image}
                      selectedVersionId={selectedVersionId}
                      included={includedImageIds.has(image.id)}
                      canManage={canManageVersions}
                    />
                  ))}
                </div>
              </Panel>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
