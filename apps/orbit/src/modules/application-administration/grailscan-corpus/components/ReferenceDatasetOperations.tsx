import { Pause, Play, RotateCcw, Send, X } from "lucide-react";
import { Panel, StatusBadge } from "./Ui";

export interface ReferenceRevision {
  id: string;
  revisionNumber: number;
  status: string;
  cardCount: number;
  assetCount: number;
  failureCount: number;
  manifestSha256: string | null;
  createdAt: string;
}

export interface ReferenceRun {
  id: string;
  status: string;
  scopeSetId: string | null;
  scopeCardId: string | null;
  safeErrorCode: string | null;
  createdAt: string;
  heartbeatAt: string | null;
}

export interface ReferenceCheckpoint {
  runId: string;
  phase: string;
  cursorJson: Record<string, unknown>;
  countersJson: Record<string, unknown>;
  updatedAt: string;
}

export interface ReferenceCommand {
  id: string;
  runId: string;
  command: string;
  acknowledgedAt: string | null;
  resultCode: string | null;
  createdAt: string;
}

export interface ReferenceDatasetDetail {
  revisions: ReferenceRevision[];
  runs: ReferenceRun[];
  checkpoints: ReferenceCheckpoint[];
  commands: ReferenceCommand[];
}

export function ReferenceDatasetOperations({
  detail,
  canManage,
  canPublish,
  busy,
  command,
  publish,
}: {
  detail: ReferenceDatasetDetail;
  canManage: boolean;
  canPublish: boolean;
  busy: string | null;
  command: (runId: string, action: "pause" | "resume" | "cancel" | "retry") => void;
  publish: (revisionId: string) => void;
}) {
  const checkpoints = new Map(
    detail.checkpoints.map((checkpoint) => [checkpoint.runId, checkpoint]),
  );
  return (
    <div className="space-y-4">
      <Panel className="overflow-hidden">
        <div className="border-b border-[var(--orbit-border)] px-5 py-4">
          <h3 className="font-semibold">Synchronization runs</h3>
        </div>
        <div className="divide-y divide-[var(--orbit-border)]">
          {detail.runs.map((run) => {
            const checkpoint = checkpoints.get(run.id);
            return (
              <div key={run.id} className="space-y-3 px-5 py-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-mono text-xs text-[var(--orbit-text-muted)]">{run.id}</p>
                    <p className="mt-1 text-sm">
                      {run.scopeSetId ?? "All categories"}
                      {run.scopeCardId ? ` · ${run.scopeCardId}` : ""}
                    </p>
                  </div>
                  <StatusBadge value={run.status} />
                </div>
                {checkpoint && (
                  <p className="text-xs text-[var(--orbit-text-secondary)]">
                    Checkpoint: {checkpoint.phase} · {JSON.stringify(checkpoint.countersJson)}
                  </p>
                )}
                {run.safeErrorCode && <p className="text-xs text-red-300">{run.safeErrorCode}</p>}
                {canManage && ["queued", "running", "paused", "failed"].includes(run.status) && (
                  <div className="flex flex-wrap gap-2">
                    {run.status === "running" && (
                      <ActionButton
                        busy={busy === run.id}
                        icon={Pause}
                        label="Pause"
                        onClick={() => command(run.id, "pause")}
                      />
                    )}
                    {run.status === "paused" && (
                      <ActionButton
                        busy={busy === run.id}
                        icon={Play}
                        label="Resume"
                        onClick={() => command(run.id, "resume")}
                      />
                    )}
                    {run.status === "failed" && (
                      <ActionButton
                        busy={busy === run.id}
                        icon={RotateCcw}
                        label="Retry"
                        onClick={() => command(run.id, "retry")}
                      />
                    )}
                    <ActionButton
                      busy={busy === run.id}
                      icon={X}
                      label="Cancel"
                      danger
                      onClick={() => command(run.id, "cancel")}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Panel>
      <Panel className="overflow-hidden">
        <div className="border-b border-[var(--orbit-border)] px-5 py-4">
          <h3 className="font-semibold">Dataset revisions</h3>
        </div>
        <div className="divide-y divide-[var(--orbit-border)]">
          {detail.revisions.map((revision) => (
            <div
              key={revision.id}
              className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"
            >
              <div>
                <p className="text-sm font-medium">Revision {revision.revisionNumber}</p>
                <p className="mt-1 text-xs text-[var(--orbit-text-secondary)]">
                  {revision.cardCount} cards · {revision.assetCount} assets ·{" "}
                  {revision.failureCount} failures
                </p>
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge value={revision.status} />
                {canPublish && revision.status === "ready_to_publish" && (
                  <ActionButton
                    busy={busy === revision.id}
                    icon={Send}
                    label="Publish"
                    onClick={() => publish(revision.id)}
                  />
                )}
              </div>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

function ActionButton({
  busy,
  icon: Icon,
  label,
  danger = false,
  onClick,
}: {
  busy: boolean;
  icon: typeof Play;
  label: string;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={busy}
      onClick={onClick}
      className={`flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs disabled:opacity-50 ${danger ? "border-red-400/50 text-red-300" : "border-[var(--orbit-border)]"}`}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}
