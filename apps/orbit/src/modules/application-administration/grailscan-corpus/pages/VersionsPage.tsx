import { useEffect, useState } from "react";
import {
  Archive,
  CheckCircle2,
  FileCheck2,
  GitBranch,
  Lock,
  Plus,
  Rocket,
  Trash2,
} from "lucide-react";
import { usePermission } from "../../../../hooks/usePermission";
import {
  useCorpusVersion,
  useCorpusVersions,
  useCreateCorpusVersion,
  useVersionActions,
} from "../api/hooks";
import { ErrorState, LoadingState, Panel, StatusBadge } from "../components/Ui";

export function CorpusVersionsPage() {
  const canManage = usePermission("grailscan.corpus.manage_versions");
  const versions = useCorpusVersions();
  const createVersion = useCreateCorpusVersion();
  const [selectedId, setSelectedId] = useState("");
  const [versionName, setVersionName] = useState("");
  const [parentVersionId, setParentVersionId] = useState("");
  const detail = useCorpusVersion(selectedId);
  const actions = useVersionActions(selectedId);
  useEffect(() => {
    if (!selectedId && versions.data?.versions[0]) setSelectedId(versions.data.versions[0].id);
  }, [selectedId, versions.data]);
  if (versions.isLoading) return <LoadingState label="Loading corpus versions…" />;
  if (versions.error)
    return <ErrorState error={versions.error} retry={() => void versions.refetch()} />;
  const selected = detail.data?.version;
  const pendingError =
    createVersion.error ??
    actions.removeMember.error ??
    actions.validate.error ??
    actions.freeze.error ??
    actions.activate.error;
  const submitCreate = (event: React.FormEvent) => {
    event.preventDefault();
    createVersion.mutate(
      { versionName, parentVersionId: parentVersionId || undefined },
      {
        onSuccess: ({ version }) => {
          setVersionName("");
          setParentVersionId("");
          setSelectedId(version.id);
        },
      },
    );
  };
  return (
    <div className="space-y-4">
      {canManage && (
        <Panel className="p-4">
          <form onSubmit={submitCreate} className="flex flex-wrap items-end gap-3">
            <label className="min-w-52 flex-1 text-xs">
              Semantic version
              <input
                required
                pattern="\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?"
                value={versionName}
                onChange={(event) => setVersionName(event.target.value)}
                placeholder="1.0.0"
                className="mt-1 h-9 w-full rounded-lg border border-[var(--orbit-border)] bg-[var(--orbit-bg-page)] px-3 text-sm"
              />
            </label>
            <label className="min-w-64 flex-1 text-xs">
              Parent release
              <select
                value={parentVersionId}
                onChange={(event) => setParentVersionId(event.target.value)}
                className="mt-1 h-9 w-full rounded-lg border border-[var(--orbit-border)] bg-[var(--orbit-bg-page)] px-3 text-sm"
              >
                <option value="">No parent</option>
                {versions.data?.versions.map((version) => (
                  <option key={version.id} value={version.id}>
                    v{version.versionName} · {version.status}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              disabled={createVersion.isPending}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[var(--orbit-primary)] px-4 text-sm font-medium text-white disabled:opacity-40"
            >
              <Plus className="h-4 w-4" /> {createVersion.isPending ? "Creating…" : "Create draft"}
            </button>
          </form>
        </Panel>
      )}
      <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
        <Panel className="h-fit overflow-hidden">
          <div className="border-b border-[var(--orbit-border)] p-4">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <GitBranch className="h-4 w-4 text-cyan-400" />
              Release lineage
            </h2>
            <p className="mt-1 text-xs text-[var(--orbit-text-muted)]">
              Immutable manifests and active release state
            </p>
          </div>
          <div className="max-h-[72vh] overflow-y-auto p-2">
            {versions.data?.versions.map((version) => (
              <button
                key={version.id}
                type="button"
                onClick={() => setSelectedId(version.id)}
                className={`mb-1 w-full rounded-lg border p-3 text-left ${selectedId === version.id ? "border-cyan-500/50 bg-cyan-500/10" : "border-transparent hover:bg-[var(--orbit-bg-card-hover)]"}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold">v{version.versionName}</span>
                  <StatusBadge value={version.status} />
                </div>
                <p className="mt-1 text-xs text-[var(--orbit-text-muted)]">
                  {version.memberCount} members · revision {version.version}
                </p>
              </button>
            ))}
            {versions.data?.versions.length === 0 && (
              <p className="p-8 text-center text-sm text-[var(--orbit-text-muted)]">
                No corpus versions yet.
              </p>
            )}
          </div>
        </Panel>
        <div>
          {detail.isLoading && <LoadingState label="Loading release snapshot…" />}
          {detail.error && <ErrorState error={detail.error} retry={() => void detail.refetch()} />}
          {selected && detail.data && (
            <div className="space-y-4">
              <Panel className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-lg font-semibold">Corpus v{selected.versionName}</h2>
                      <StatusBadge value={selected.status} />
                    </div>
                    <p className="mt-1 font-mono text-[11px] text-[var(--orbit-text-muted)]">
                      {selected.id}
                    </p>
                    <p className="mt-2 text-xs text-[var(--orbit-text-secondary)]">
                      {selected.parentVersionId
                        ? `Derived from ${selected.parentVersionId}`
                        : "Root corpus release"}
                    </p>
                  </div>
                  {canManage && (
                    <div className="flex flex-wrap gap-2">
                      {selected.status === "draft" && (
                        <>
                          <button
                            type="button"
                            onClick={() => actions.validate.mutate()}
                            disabled={actions.validate.isPending}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-500/40 px-3 py-2 text-xs text-cyan-200"
                          >
                            <FileCheck2 className="h-3.5 w-3.5" /> Validate
                          </button>
                          <button
                            type="button"
                            onClick={() => actions.freeze.mutate()}
                            disabled={
                              actions.freeze.isPending || actions.validate.data?.valid === false
                            }
                            className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200 disabled:opacity-40"
                          >
                            <Lock className="h-3.5 w-3.5" /> Freeze manifest
                          </button>
                        </>
                      )}
                      {selected.status === "frozen" && (
                        <button
                          type="button"
                          onClick={() => actions.activate.mutate()}
                          disabled={actions.activate.isPending}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-medium text-white disabled:opacity-40"
                        >
                          <Rocket className="h-3.5 w-3.5" /> Activate release
                        </button>
                      )}
                    </div>
                  )}
                </div>
                {actions.validate.data && (
                  <div
                    className={`mt-4 rounded-lg border p-3 text-xs ${actions.validate.data.valid ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200" : "border-red-500/30 bg-red-500/10 text-red-200"}`}
                  >
                    <p className="flex items-center gap-1.5 font-semibold">
                      <CheckCircle2 className="h-4 w-4" />
                      {actions.validate.data.valid
                        ? "Snapshot validation passed"
                        : "Snapshot validation failed"}
                    </p>
                    {actions.validate.data.errors.length > 0 && (
                      <ul className="mt-2 list-disc pl-5">
                        {actions.validate.data.errors.map((error) => (
                          <li key={error}>{error}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </Panel>
              <div className="grid gap-3 sm:grid-cols-3">
                <Panel className="p-4">
                  <p className="text-xs text-[var(--orbit-text-muted)]">Members</p>
                  <p className="mt-1 text-2xl font-semibold">{selected.memberCount}</p>
                </Panel>
                <Panel className="p-4">
                  <p className="text-xs text-[var(--orbit-text-muted)]">Manifest</p>
                  <p className="mt-1 truncate font-mono text-xs">
                    {selected.manifestSha256 ?? "Not frozen"}
                  </p>
                </Panel>
                <Panel className="p-4">
                  <p className="text-xs text-[var(--orbit-text-muted)]">Activated</p>
                  <p className="mt-1 text-sm font-medium">
                    {selected.activatedAt
                      ? new Date(selected.activatedAt).toLocaleString()
                      : "Not active"}
                  </p>
                </Panel>
              </div>
              <Panel className="overflow-hidden">
                <div className="flex items-center justify-between border-b border-[var(--orbit-border)] p-4">
                  <div>
                    <h3 className="flex items-center gap-2 text-sm font-semibold">
                      <Archive className="h-4 w-4 text-violet-400" />
                      Immutable member snapshots
                    </h3>
                    <p className="mt-1 text-xs text-[var(--orbit-text-muted)]">
                      Image hash, verified identity version, and rights version are pinned at
                      inclusion.
                    </p>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-[var(--orbit-bg-page)] text-[var(--orbit-text-muted)]">
                      <tr>
                        <th className="px-4 py-2">Image</th>
                        <th className="px-4 py-2">SHA-256</th>
                        <th className="px-4 py-2">Identity</th>
                        <th className="px-4 py-2">Rights</th>
                        <th className="px-4 py-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.data.members.map((member) => (
                        <tr key={member.id} className="border-t border-[var(--orbit-border)]">
                          <td className="px-4 py-3 font-mono">{member.imageId.slice(0, 12)}…</td>
                          <td className="max-w-52 truncate px-4 py-3 font-mono">
                            {member.imageSha256}
                          </td>
                          <td className="px-4 py-3">v{member.identityVersion}</td>
                          <td className="px-4 py-3">v{member.rightsVersion}</td>
                          <td className="px-4 py-3 text-right">
                            {selected.status === "draft" && canManage && (
                              <button
                                type="button"
                                onClick={() => actions.removeMember.mutate(member.imageId)}
                                aria-label="Remove member"
                                className="text-red-300"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {detail.data.members.length === 0 && (
                    <p className="p-10 text-center text-sm text-[var(--orbit-text-muted)]">
                      Add approved images from the Approved Pool.
                    </p>
                  )}
                </div>
              </Panel>
            </div>
          )}
        </div>
      </div>
      {pendingError && <ErrorState error={pendingError} />}
    </div>
  );
}
