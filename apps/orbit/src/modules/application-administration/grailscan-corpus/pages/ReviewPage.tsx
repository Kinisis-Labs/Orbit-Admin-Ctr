import { useEffect, useState } from "react";
import {
  CheckCircle2,
  Clock3,
  Eye,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { usePermission } from "../../../../hooks/usePermission";
import { useAuth } from "../../../auth/AuthProvider";
import {
  useGroup,
  useImagePreview,
  useReviewActions,
  useReviewHistory,
  useReviewQueue,
} from "../api/hooks";
import type { CorpusImage, IdentityInput, RightsInput } from "../api/schemas";
import { ErrorState, LoadingState, Panel, StatusBadge } from "../components/Ui";

const REJECTION_REASONS = [
  "wrong_subject",
  "poor_quality",
  "duplicate",
  "rights_missing",
  "identity_unverifiable",
  "unsupported",
  "other",
];

function ImagePreview({ image }: { image: CorpusImage }) {
  const preview = useImagePreview(image.id, true);
  return (
    <div className="overflow-hidden rounded-lg border border-[var(--orbit-border)] bg-[var(--orbit-bg-page)]">
      <div className="aspect-[4/3] bg-black/20">
        {preview.data ? (
          <img
            src={preview.data.url}
            alt={`${image.side} capture`}
            className="h-full w-full object-contain"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-[var(--orbit-text-muted)]">
            {preview.isLoading ? "Signing preview…" : "Preview unavailable"}
          </div>
        )}
      </div>
      <div className="flex items-center justify-between gap-2 p-2 text-xs">
        <span className="truncate">{image.originalFilename}</span>
        <StatusBadge value={image.side} />
      </div>
    </div>
  );
}

function ReviewWorkspace({ groupId }: { groupId: string }) {
  const { user } = useAuth();
  const canApprove = usePermission("grailscan.corpus.approve");
  const canManageRights = usePermission("grailscan.corpus.manage_rights");
  const detail = useGroup(groupId);
  const history = useReviewHistory(groupId);
  const actions = useReviewActions(groupId);
  const [rightsSaved, setRightsSaved] = useState(false);
  const [ownerName, setOwnerName] = useState("");
  const [basis, setBasis] = useState("owner_consent");
  const [reference, setReference] = useState("");
  const [consentVersion, setConsentVersion] = useState("1.0");
  const [identity, setIdentity] = useState<IdentityInput>({
    canonicalKey: "",
    category: "tcg",
    franchise: "",
    collectibleName: "",
    setName: "",
    language: "en",
    conditionState: "raw",
  });
  const [reasonCode, setReasonCode] = useState("human_verified");
  const [notes, setNotes] = useState("");
  const [rejectReason, setRejectReason] = useState("wrong_subject");
  const [duplicateOfGroupId, setDuplicateOfGroupId] = useState("");
  useEffect(() => setRightsSaved(false), [groupId]);
  if (detail.isLoading) return <LoadingState label="Loading review evidence…" />;
  if (detail.error || !detail.data) {
    return <ErrorState error={detail.error} retry={() => void detail.refetch()} />;
  }
  const group = detail.data.group;
  const claimActive =
    group.reviewClaimedByActorId === user.id &&
    Boolean(group.reviewClaimExpiresAt) &&
    new Date(group.reviewClaimExpiresAt ?? 0).getTime() > Date.now();
  const claimedByAnother =
    Boolean(group.reviewClaimedByActorId) &&
    group.reviewClaimedByActorId !== user.id &&
    new Date(group.reviewClaimExpiresAt ?? 0).getTime() > Date.now();
  const selfReview = group.uploadedByActorId === user.id;
  const pendingError =
    actions.claim.error ??
    actions.release.error ??
    actions.rights.error ??
    actions.approve.error ??
    actions.reject.error ??
    actions.duplicate.error;
  const updateIdentity = (key: keyof IdentityInput, value: string) =>
    setIdentity((current) => ({ ...current, [key]: value || undefined }));
  const saveRights = () => {
    const rights: RightsInput = {
      ownerName,
      basis,
      reference: reference || undefined,
      consentVersion,
      consentedAt: new Date().toISOString(),
      retentionAllowed: true,
      internalEvaluationAllowed: true,
      regressionAllowed: true,
      productImprovementAllowed: true,
      modelTrainingAllowed: false,
      documentationAllowed: false,
      revocable: true,
    };
    actions.rights.mutate(rights, { onSuccess: () => setRightsSaved(true) });
  };
  return (
    <div className="space-y-4">
      <Panel className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-semibold">
                {group.workingLabel ?? `Capture ${group.id.slice(0, 8)}`}
              </h2>
              <StatusBadge value={group.status} />
            </div>
            <p className="mt-1 font-mono text-[11px] text-[var(--orbit-text-muted)]">{group.id}</p>
          </div>
          <div className="flex gap-2">
            {claimActive ? (
              <button
                type="button"
                onClick={() => actions.release.mutate()}
                disabled={actions.release.isPending}
                className="rounded-lg border border-[var(--orbit-border)] px-3 py-2 text-xs"
              >
                Release claim
              </button>
            ) : (
              <button
                type="button"
                onClick={() => actions.claim.mutate()}
                disabled={actions.claim.isPending || claimedByAnother || selfReview}
                className="rounded-lg bg-[var(--orbit-primary)] px-3 py-2 text-xs font-medium text-white disabled:opacity-40"
              >
                {actions.claim.isPending ? "Claiming…" : "Claim review"}
              </button>
            )}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          {claimActive && (
            <span className="inline-flex items-center gap-1 text-emerald-300">
              <LockKeyhole className="h-3.5 w-3.5" />
              Claimed by you until {new Date(group.reviewClaimExpiresAt ?? "").toLocaleTimeString()}
            </span>
          )}
          {claimedByAnother && (
            <span className="inline-flex items-center gap-1 text-amber-300">
              <Clock3 className="h-3.5 w-3.5" />
              Claimed by another reviewer
            </span>
          )}
          {selfReview && (
            <span className="text-amber-300">
              Separation of duties: you uploaded this capture and cannot review it.
            </span>
          )}
        </div>
      </Panel>

      <Panel className="p-4">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <Eye className="h-4 w-4 text-cyan-400" />
          Capture evidence
        </h3>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {detail.data.images.map((image) => (
            <ImagePreview key={image.id} image={image} />
          ))}
        </div>
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          <div className="rounded-lg border border-[var(--orbit-border)] p-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--orbit-text-muted)]">
              Quality evidence
            </p>
            <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap text-[11px] text-[var(--orbit-text-secondary)]">
              {JSON.stringify(detail.data.quality, null, 2)}
            </pre>
          </div>
          <div className="rounded-lg border border-[var(--orbit-border)] p-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--orbit-text-muted)]">
              Candidate matches
            </p>
            <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap text-[11px] text-[var(--orbit-text-secondary)]">
              {JSON.stringify(detail.data.candidates, null, 2)}
            </pre>
          </div>
        </div>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel className="p-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <ShieldCheck className="h-4 w-4 text-emerald-400" />
            Rights evidence
          </h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="text-xs">
              Owner name
              <input
                value={ownerName}
                onChange={(event) => setOwnerName(event.target.value)}
                className="mt-1 h-9 w-full rounded-lg border border-[var(--orbit-border)] bg-[var(--orbit-bg-page)] px-3 text-sm"
              />
            </label>
            <label className="text-xs">
              Basis
              <input
                value={basis}
                onChange={(event) => setBasis(event.target.value)}
                className="mt-1 h-9 w-full rounded-lg border border-[var(--orbit-border)] bg-[var(--orbit-bg-page)] px-3 text-sm"
              />
            </label>
            <label className="text-xs">
              Consent version
              <input
                value={consentVersion}
                onChange={(event) => setConsentVersion(event.target.value)}
                className="mt-1 h-9 w-full rounded-lg border border-[var(--orbit-border)] bg-[var(--orbit-bg-page)] px-3 text-sm"
              />
            </label>
            <label className="text-xs">
              Reference
              <input
                value={reference}
                onChange={(event) => setReference(event.target.value)}
                className="mt-1 h-9 w-full rounded-lg border border-[var(--orbit-border)] bg-[var(--orbit-bg-page)] px-3 text-sm"
              />
            </label>
          </div>
          <button
            type="button"
            onClick={saveRights}
            disabled={!claimActive || !canManageRights || !ownerName || actions.rights.isPending}
            className="mt-3 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200 disabled:opacity-40"
          >
            {rightsSaved
              ? "Rights recorded"
              : actions.rights.isPending
                ? "Recording…"
                : "Record approval rights"}
          </button>
        </Panel>

        <Panel className="p-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <CheckCircle2 className="h-4 w-4 text-cyan-400" />
            Verified identity
          </h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {[
              ["Canonical key", "canonicalKey"],
              ["Collectible name", "collectibleName"],
              ["Franchise", "franchise"],
              ["Set name", "setName"],
              ["Set code", "setCode"],
              ["Collector number", "collectorNumber"],
              ["Language", "language"],
              ["Variant", "variant"],
            ].map(([label, key]) => (
              <label key={key} className="text-xs">
                {label}
                <input
                  value={String(identity[key as keyof IdentityInput] ?? "")}
                  onChange={(event) =>
                    updateIdentity(key as keyof IdentityInput, event.target.value)
                  }
                  className="mt-1 h-9 w-full rounded-lg border border-[var(--orbit-border)] bg-[var(--orbit-bg-page)] px-3 text-sm"
                />
              </label>
            ))}
            <label className="text-xs">
              Category
              <select
                value={identity.category}
                onChange={(event) => updateIdentity("category", event.target.value)}
                className="mt-1 h-9 w-full rounded-lg border border-[var(--orbit-border)] bg-[var(--orbit-bg-page)] px-3 text-sm"
              >
                <option value="tcg">TCG</option>
                <option value="sports">Sports</option>
                <option value="collectible">Collectible</option>
              </select>
            </label>
            <label className="text-xs">
              Condition
              <select
                value={identity.conditionState}
                onChange={(event) => updateIdentity("conditionState", event.target.value)}
                className="mt-1 h-9 w-full rounded-lg border border-[var(--orbit-border)] bg-[var(--orbit-bg-page)] px-3 text-sm"
              >
                <option value="raw">Raw</option>
                <option value="graded">Graded</option>
              </select>
            </label>
            {identity.conditionState === "graded" && (
              <>
                <label className="text-xs">
                  Grading company
                  <input
                    value={identity.gradingCompany ?? ""}
                    onChange={(event) => updateIdentity("gradingCompany", event.target.value)}
                    className="mt-1 h-9 w-full rounded-lg border border-[var(--orbit-border)] bg-[var(--orbit-bg-page)] px-3 text-sm"
                  />
                </label>
                <label className="text-xs">
                  Grade
                  <input
                    value={identity.grade ?? ""}
                    onChange={(event) => updateIdentity("grade", event.target.value)}
                    className="mt-1 h-9 w-full rounded-lg border border-[var(--orbit-border)] bg-[var(--orbit-bg-page)] px-3 text-sm"
                  />
                </label>
                <label className="text-xs sm:col-span-2">
                  Certificate number
                  <input
                    value={identity.certificateNumber ?? ""}
                    onChange={(event) => updateIdentity("certificateNumber", event.target.value)}
                    className="mt-1 h-9 w-full rounded-lg border border-[var(--orbit-border)] bg-[var(--orbit-bg-page)] px-3 text-sm"
                  />
                </label>
              </>
            )}
          </div>
          <label className="mt-3 block text-xs">
            Decision notes
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={3}
              className="mt-1 w-full rounded-lg border border-[var(--orbit-border)] bg-[var(--orbit-bg-page)] px-3 py-2 text-sm"
            />
          </label>
          <button
            type="button"
            disabled={
              !claimActive ||
              !canApprove ||
              !rightsSaved ||
              !identity.canonicalKey ||
              !identity.collectibleName ||
              !identity.franchise ||
              !identity.setName ||
              actions.approve.isPending
            }
            onClick={() =>
              actions.approve.mutate({ identity, reasonCode, notes: notes || undefined })
            }
            className="mt-3 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
          >
            {actions.approve.isPending ? "Approving…" : "Approve verified capture"}
          </button>
          <input
            aria-label="Approval reason"
            value={reasonCode}
            onChange={(event) => setReasonCode(event.target.value)}
            className="ml-2 h-9 rounded-lg border border-[var(--orbit-border)] bg-[var(--orbit-bg-page)] px-3 text-xs"
          />
        </Panel>
      </div>

      <Panel className="p-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <XCircle className="h-4 w-4 text-red-400" />
          Alternative decisions
        </h3>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <div className="flex gap-2">
            <select
              aria-label="Rejection reason"
              value={rejectReason}
              onChange={(event) => setRejectReason(event.target.value)}
              className="h-9 flex-1 rounded-lg border border-[var(--orbit-border)] bg-[var(--orbit-bg-page)] px-3 text-sm"
            >
              {REJECTION_REASONS.map((value) => (
                <option key={value} value={value}>
                  {value.replaceAll("_", " ")}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={!claimActive || actions.reject.isPending}
              onClick={() =>
                actions.reject.mutate({ reasonCode: rejectReason, notes: notes || undefined })
              }
              className="rounded-lg border border-red-500/40 px-3 text-xs text-red-300 disabled:opacity-40"
            >
              Reject
            </button>
          </div>
          <div className="flex gap-2">
            <input
              aria-label="Approved duplicate group ID"
              value={duplicateOfGroupId}
              onChange={(event) => setDuplicateOfGroupId(event.target.value)}
              placeholder="Approved canonical group UUID"
              className="h-9 flex-1 rounded-lg border border-[var(--orbit-border)] bg-[var(--orbit-bg-page)] px-3 text-sm"
            />
            <button
              type="button"
              disabled={!claimActive || !duplicateOfGroupId || actions.duplicate.isPending}
              onClick={() =>
                actions.duplicate.mutate({ duplicateOfGroupId, reasonCode: "exact_duplicate" })
              }
              className="rounded-lg border border-amber-500/40 px-3 text-xs text-amber-200 disabled:opacity-40"
            >
              Mark duplicate
            </button>
          </div>
        </div>
      </Panel>
      {pendingError && <ErrorState error={pendingError} />}
      <Panel className="p-4">
        <h3 className="text-sm font-semibold">Review history</h3>
        {history.isLoading ? (
          <LoadingState label="Loading history…" />
        ) : (
          <pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap text-xs text-[var(--orbit-text-secondary)]">
            {JSON.stringify(history.data?.history ?? [], null, 2)}
          </pre>
        )}
      </Panel>
    </div>
  );
}

export function CorpusReviewPage() {
  const queue = useReviewQueue();
  const [selectedId, setSelectedId] = useState("");
  useEffect(() => {
    if (!selectedId && queue.data?.items[0]) setSelectedId(queue.data.items[0].group.id);
  }, [queue.data, selectedId]);
  if (queue.isLoading) return <LoadingState label="Loading review queue…" />;
  if (queue.error || !queue.data)
    return <ErrorState error={queue.error} retry={() => void queue.refetch()} />;
  return (
    <div className="grid gap-4 xl:grid-cols-[300px_minmax(0,1fr)]">
      <Panel className="h-fit overflow-hidden">
        <div className="flex items-center justify-between border-b border-[var(--orbit-border)] p-4">
          <div>
            <h2 className="text-sm font-semibold">Ready for review</h2>
            <p className="text-xs text-[var(--orbit-text-muted)]">
              {queue.data.items.length} capture groups
            </p>
          </div>
          <button
            type="button"
            onClick={() => void queue.refetch()}
            aria-label="Refresh review queue"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
        <div className="max-h-[72vh] overflow-y-auto p-2">
          {queue.data.items.map(({ group, imageCount }) => (
            <button
              key={group.id}
              type="button"
              onClick={() => setSelectedId(group.id)}
              className={`mb-1 w-full rounded-lg border p-3 text-left ${selectedId === group.id ? "border-cyan-500/50 bg-cyan-500/10" : "border-transparent hover:bg-[var(--orbit-bg-card-hover)]"}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium">
                  {group.workingLabel ?? group.id.slice(0, 8)}
                </span>
                <StatusBadge value={group.reviewClaimedByActorId ? "claimed" : "open"} />
              </div>
              <p className="mt-1 text-xs text-[var(--orbit-text-muted)]">
                {imageCount} images · {new Date(group.createdAt).toLocaleDateString()}
              </p>
            </button>
          ))}
          {queue.data.items.length === 0 && (
            <p className="p-6 text-center text-sm text-[var(--orbit-text-muted)]">
              The review queue is clear.
            </p>
          )}
        </div>
      </Panel>
      {selectedId ? (
        <ReviewWorkspace groupId={selectedId} />
      ) : (
        <Panel className="p-12 text-center text-sm text-[var(--orbit-text-muted)]">
          Select a capture group to begin verification.
        </Panel>
      )}
    </div>
  );
}
