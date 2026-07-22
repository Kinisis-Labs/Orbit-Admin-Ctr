import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Plus, Search } from "lucide-react";
import { usePermission } from "../../../../hooks/usePermission";
import { useCreateSubmission, useSubmissions } from "../api/hooks";
import { ErrorState, LoadingState, Panel, StatusBadge } from "../components/Ui";

export function CorpusSubmissionsPage() {
  const canUpload = usePermission("grailscan.corpus.upload");
  const [searchParams, setSearchParams] = useSearchParams();
  const status = searchParams.get("status") ?? "";
  const query = useSubmissions(status || undefined);
  const create = useCreateSubmission();
  const navigate = useNavigate();
  const [showCreate, setShowCreate] = useState(searchParams.get("create") === "1");
  const [displayName, setDisplayName] = useState("");
  const [sourceType, setSourceType] = useState("founder_capture");
  const [sourceOrgNameSnapshot, setSourceOrgNameSnapshot] = useState("");
  const [notes, setNotes] = useState("");
  useEffect(() => setShowCreate(searchParams.get("create") === "1"), [searchParams]);
  if (query.isLoading) return <LoadingState />;
  if (query.error || !query.data)
    return <ErrorState error={query.error} retry={() => void query.refetch()} />;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-[var(--orbit-text-muted)]" />
          <select
            aria-label="Filter by status"
            value={status}
            onChange={(event) =>
              setSearchParams(event.target.value ? { status: event.target.value } : {})
            }
            className="h-9 w-full rounded-lg border border-[var(--orbit-border)] bg-[var(--orbit-bg-card)] pl-9 pr-3 text-sm"
          >
            <option value="">All statuses</option>
            {[
              "draft",
              "uploading",
              "processing",
              "ready_for_review",
              "completed",
              "failed",
              "retired",
            ].map((value) => (
              <option key={value} value={value}>
                {value.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </div>
        {canUpload && (
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="flex h-9 items-center gap-1.5 rounded-lg bg-[var(--orbit-primary)] px-3 text-sm font-medium text-white"
          >
            <Plus className="h-4 w-4" />
            New submission
          </button>
        )}
      </div>
      {showCreate && canUpload && (
        <Panel className="p-5">
          <form
            className="grid gap-4 md:grid-cols-2"
            onSubmit={(event) => {
              event.preventDefault();
              create.mutate(
                {
                  displayName,
                  sourceType,
                  sourceOrgNameSnapshot: sourceOrgNameSnapshot || undefined,
                  notes: notes || undefined,
                },
                {
                  onSuccess: ({ submission }) =>
                    navigate(`/admin/applications/grailscan-corpus/submissions/${submission.id}`),
                },
              );
            }}
          >
            <div>
              <label htmlFor="submission-name" className="mb-1 block text-xs font-medium">
                Submission name
              </label>
              <input
                id="submission-name"
                required
                maxLength={200}
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder="e.g. 2026 National Show - Modern TCG"
                className="h-9 w-full rounded-lg border border-[var(--orbit-border)] bg-[var(--orbit-bg-page)] px-3 text-sm"
              />
            </div>
            <div>
              <label htmlFor="source-type" className="mb-1 block text-xs font-medium">
                Source type
              </label>
              <input
                id="source-type"
                required
                maxLength={64}
                value={sourceType}
                onChange={(event) => setSourceType(event.target.value)}
                className="h-9 w-full rounded-lg border border-[var(--orbit-border)] bg-[var(--orbit-bg-page)] px-3 text-sm"
              />
            </div>
            <div>
              <label htmlFor="source-org" className="mb-1 block text-xs font-medium">
                Contributing organization (provenance only)
              </label>
              <input
                id="source-org"
                maxLength={200}
                value={sourceOrgNameSnapshot}
                onChange={(event) => setSourceOrgNameSnapshot(event.target.value)}
                className="h-9 w-full rounded-lg border border-[var(--orbit-border)] bg-[var(--orbit-bg-page)] px-3 text-sm"
              />
            </div>
            <div className="md:col-span-2">
              <label htmlFor="submission-notes" className="mb-1 block text-xs font-medium">
                Notes
              </label>
              <textarea
                id="submission-notes"
                maxLength={4000}
                rows={3}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                className="w-full rounded-lg border border-[var(--orbit-border)] bg-[var(--orbit-bg-page)] px-3 py-2 text-sm"
              />
            </div>
            <div className="flex gap-2 md:col-span-2">
              <button
                type="submit"
                disabled={create.isPending}
                className="rounded-lg bg-[var(--orbit-primary)] px-4 py-2 text-sm text-white disabled:opacity-50"
              >
                {create.isPending ? "Creating…" : "Create submission"}
              </button>
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="rounded-lg border border-[var(--orbit-border)] px-4 py-2 text-sm"
              >
                Cancel
              </button>
            </div>
            {create.error && (
              <div className="md:col-span-2">
                <ErrorState error={create.error} />
              </div>
            )}
          </form>
        </Panel>
      )}
      <Panel className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="border-b border-[var(--orbit-border)] text-xs uppercase tracking-wider text-[var(--orbit-text-muted)]">
              <tr>
                <th className="px-4 py-3">Submission</th>
                <th className="px-4 py-3">Source</th>
                <th className="px-4 py-3">Contributor</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Created</th>
              </tr>
            </thead>
            <tbody>
              {query.data.items.map((submission) => (
                <tr
                  key={submission.id}
                  className="border-b border-[var(--orbit-border)]/70 hover:bg-[var(--orbit-bg-card-hover)]"
                >
                  <td className="px-4 py-3">
                    <Link
                      className="text-sm font-medium text-cyan-300 hover:underline"
                      to={`${submission.id}`}
                    >
                      {submission.displayName}
                    </Link>
                  </td>
                  <td className="px-4 py-3">{submission.sourceType}</td>
                  <td className="px-4 py-3">{submission.sourceOrgNameSnapshot ?? "Internal"}</td>
                  <td className="px-4 py-3">
                    <StatusBadge value={submission.status} />
                  </td>
                  <td className="px-4 py-3 text-[var(--orbit-text-secondary)]">
                    {new Date(submission.createdAt).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {query.data.items.length === 0 && (
          <p className="py-12 text-center text-sm text-[var(--orbit-text-muted)]">
            No submissions match this filter.
          </p>
        )}
      </Panel>
    </div>
  );
}
