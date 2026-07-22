import { useState } from "react";
import { Filter, RefreshCw, ScrollText, ShieldCheck } from "lucide-react";
import { useCorpusAudit } from "../api/hooks";
import { ErrorState, LoadingState, Panel, StatusBadge } from "../components/Ui";

export function CorpusAuditPage() {
  const [draft, setDraft] = useState({ action: "", actorId: "", targetType: "" });
  const [filters, setFilters] = useState({ action: "", actorId: "", targetType: "" });
  const audit = useCorpusAudit({
    action: filters.action || undefined,
    actorId: filters.actorId || undefined,
    targetType: filters.targetType || undefined,
  });
  if (audit.isLoading) return <LoadingState label="Loading sanitized audit trail…" />;
  if (audit.error || !audit.data) {
    return <ErrorState error={audit.error} retry={() => void audit.refetch()} />;
  }
  const apply = (event: React.FormEvent) => {
    event.preventDefault();
    setFilters({
      action: draft.action.trim(),
      actorId: draft.actorId.trim(),
      targetType: draft.targetType.trim(),
    });
  };
  return (
    <div className="space-y-4">
      <Panel className="p-4">
        <form onSubmit={apply} className="grid gap-3 lg:grid-cols-[1fr_1fr_1fr_auto]">
          <label className="text-xs">
            Action
            <input
              value={draft.action}
              onChange={(event) =>
                setDraft((current) => ({ ...current, action: event.target.value }))
              }
              placeholder="corpus_version.activated"
              maxLength={200}
              className="mt-1 h-9 w-full rounded-lg border border-[var(--orbit-border)] bg-[var(--orbit-bg-page)] px-3 text-sm"
            />
          </label>
          <label className="text-xs">
            Actor ID
            <input
              value={draft.actorId}
              onChange={(event) =>
                setDraft((current) => ({ ...current, actorId: event.target.value }))
              }
              placeholder="entra-object-id"
              maxLength={200}
              className="mt-1 h-9 w-full rounded-lg border border-[var(--orbit-border)] bg-[var(--orbit-bg-page)] px-3 text-sm"
            />
          </label>
          <label className="text-xs">
            Target type
            <input
              value={draft.targetType}
              onChange={(event) =>
                setDraft((current) => ({ ...current, targetType: event.target.value }))
              }
              placeholder="corpus_version"
              maxLength={100}
              className="mt-1 h-9 w-full rounded-lg border border-[var(--orbit-border)] bg-[var(--orbit-bg-page)] px-3 text-sm"
            />
          </label>
          <button
            type="submit"
            className="mt-5 inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-4 text-sm text-cyan-200"
          >
            <Filter className="h-4 w-4" />
            Apply
          </button>
        </form>
      </Panel>
      <Panel className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--orbit-border)] p-4">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <ScrollText className="h-4 w-4 text-violet-400" />
              Sanitized audit trail
            </h2>
            <p className="mt-1 text-xs text-[var(--orbit-text-muted)]">
              {audit.data.items.length} events · stable creation order
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1 text-xs text-emerald-300">
              <ShieldCheck className="h-4 w-4" />
              Structured details redacted
            </span>
            <button type="button" onClick={() => void audit.refetch()} aria-label="Refresh audit">
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-[var(--orbit-bg-page)] text-[var(--orbit-text-muted)]">
              <tr>
                <th className="px-4 py-3">Time</th>
                <th className="px-4 py-3">Action</th>
                <th className="px-4 py-3">Actor</th>
                <th className="px-4 py-3">Target</th>
                <th className="px-4 py-3">Correlation</th>
                <th className="px-4 py-3">Details</th>
              </tr>
            </thead>
            <tbody>
              {audit.data.items.map((event) => (
                <tr key={event.id} className="border-t border-[var(--orbit-border)] align-top">
                  <td className="whitespace-nowrap px-4 py-3 text-[var(--orbit-text-secondary)]">
                    {new Date(event.createdAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge value={event.action} />
                  </td>
                  <td className="max-w-40 truncate px-4 py-3 font-mono">{event.actorId}</td>
                  <td className="px-4 py-3">
                    <p>{event.targetType}</p>
                    <p className="mt-1 max-w-40 truncate font-mono text-[var(--orbit-text-muted)]">
                      {event.targetId}
                    </p>
                  </td>
                  <td className="max-w-36 truncate px-4 py-3 font-mono">
                    {event.correlationId ?? event.orbitRequestId}
                  </td>
                  <td className="max-w-80 px-4 py-3">
                    <pre className="max-h-24 overflow-auto whitespace-pre-wrap text-[11px] text-[var(--orbit-text-secondary)]">
                      {event.detailJson ? JSON.stringify(event.detailJson, null, 2) : "—"}
                    </pre>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {audit.data.items.length === 0 && (
            <p className="p-12 text-center text-sm text-[var(--orbit-text-muted)]">
              No events match the active filters.
            </p>
          )}
        </div>
      </Panel>
    </div>
  );
}
