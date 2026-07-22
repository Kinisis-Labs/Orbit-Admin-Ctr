import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Camera, ChevronLeft, FileImage, Plus, UploadCloud } from "lucide-react";
import { usePermission } from "../../../../hooks/usePermission";
import {
  uploadCorpusImage,
  useCompleteGroup,
  useCompleteSubmission,
  useCreateGroup,
  useGroup,
  useSubmission,
} from "../api/hooks";
import type { CaptureGroup, ImageSide } from "../api/schemas";
import { ErrorState, LoadingState, Panel, StatusBadge } from "../components/Ui";

interface UploadItem {
  id: string;
  file: File;
  side: ImageSide;
  progress: number;
  status: "ready" | "uploading" | "completed" | "failed";
  error?: string;
}

function GroupWorkspace({ group, submissionId }: { group: CaptureGroup; submissionId: string }) {
  const canUpload = usePermission("grailscan.corpus.upload");
  const query = useGroup(group.id);
  const complete = useCompleteGroup(submissionId);
  const [items, setItems] = useState<UploadItem[]>([]);
  const [side, setSide] = useState<ImageSide>("front");
  const mutable = ["draft", "uploading"].includes(group.status);
  const addFiles = (files: FileList | null) => {
    if (!files) return;
    setItems((current) => [
      ...current,
      ...Array.from(files).map((file) => ({
        id: crypto.randomUUID(),
        file,
        side,
        progress: 0,
        status: "ready" as const,
      })),
    ]);
  };
  const uploadItem = async (item: UploadItem) => {
    setItems((current) =>
      current.map((value) =>
        value.id === item.id ? { ...value, status: "uploading", error: undefined } : value,
      ),
    );
    try {
      await uploadCorpusImage({
        groupId: group.id,
        side: item.side,
        file: item.file,
        onProgress: (progress) =>
          setItems((current) =>
            current.map((value) => (value.id === item.id ? { ...value, progress } : value)),
          ),
      });
      setItems((current) =>
        current.map((value) =>
          value.id === item.id ? { ...value, progress: 100, status: "completed" } : value,
        ),
      );
      await query.refetch();
    } catch (error) {
      setItems((current) =>
        current.map((value) =>
          value.id === item.id
            ? {
                ...value,
                status: "failed",
                error: error instanceof Error ? error.message : "Upload failed",
              }
            : value,
        ),
      );
    }
  };
  return (
    <Panel className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-medium">{group.workingLabel ?? `Capture ${group.id.slice(0, 8)}`}</h3>
          <p className="mt-1 font-mono text-[11px] text-[var(--orbit-text-muted)]">{group.id}</p>
        </div>
        <StatusBadge value={group.status} />
      </div>
      {query.isLoading ? (
        <LoadingState label="Loading capture images…" />
      ) : query.error || !query.data ? (
        <div className="mt-4">
          <ErrorState error={query.error} retry={() => void query.refetch()} />
        </div>
      ) : (
        <>
          <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {query.data.images.map((image) => (
              <div key={image.id} className="rounded-lg border border-[var(--orbit-border)] p-3">
                <div className="flex items-center gap-2">
                  <FileImage className="h-4 w-4 text-cyan-400" />
                  <span className="truncate text-sm">{image.originalFilename}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <StatusBadge value={image.side} />
                  <StatusBadge value={image.processingState} />
                  <StatusBadge value={image.qualityState} />
                </div>
                <p className="mt-2 text-xs text-[var(--orbit-text-muted)]">
                  {image.widthPixels && image.heightPixels
                    ? `${image.widthPixels} × ${image.heightPixels}`
                    : "Dimensions pending"}
                  {image.sizeBytes ? ` · ${(image.sizeBytes / 1024 / 1024).toFixed(2)} MB` : ""}
                </p>
              </div>
            ))}
            {query.data.images.length === 0 && (
              <p className="col-span-full py-6 text-center text-sm text-[var(--orbit-text-muted)]">
                No images uploaded yet.
              </p>
            )}
          </div>
          {canUpload && mutable && (
            <div className="mt-4 rounded-lg border border-dashed border-cyan-500/30 bg-cyan-500/5 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <select
                  aria-label="Image side"
                  value={side}
                  onChange={(event) => setSide(event.target.value as ImageSide)}
                  className="h-9 rounded-lg border border-[var(--orbit-border)] bg-[var(--orbit-bg-page)] px-3 text-sm"
                >
                  {["front", "back", "angle", "slab_label", "other"].map((value) => (
                    <option key={value} value={value}>
                      {value.replaceAll("_", " ")}
                    </option>
                  ))}
                </select>
                <label className="flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-[var(--orbit-border)] px-3 text-sm">
                  <UploadCloud className="h-4 w-4" />
                  Choose files
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                    multiple
                    className="sr-only"
                    onChange={(event) => addFiles(event.target.files)}
                  />
                </label>
                <label className="flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-[var(--orbit-border)] px-3 text-sm sm:hidden">
                  <Camera className="h-4 w-4" />
                  Camera
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="sr-only"
                    onChange={(event) => addFiles(event.target.files)}
                  />
                </label>
              </div>
              <div className="mt-3 space-y-2">
                {items.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center gap-3 rounded-lg bg-[var(--orbit-bg-page)] p-2.5"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex justify-between gap-2 text-xs">
                        <span className="truncate">
                          {item.file.name} · {item.side}
                        </span>
                        <span>{item.progress}%</span>
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded bg-[var(--orbit-border)]">
                        <div
                          className="h-full bg-cyan-400 transition-all"
                          style={{ width: `${item.progress}%` }}
                        />
                      </div>
                      {item.error && <p className="mt-1 text-xs text-red-300">{item.error}</p>}
                    </div>
                    {item.status !== "completed" && (
                      <button
                        type="button"
                        disabled={item.status === "uploading"}
                        onClick={() => void uploadItem(item)}
                        className="rounded-md bg-[var(--orbit-primary)] px-2.5 py-1.5 text-xs text-white disabled:opacity-50"
                      >
                        {item.status === "failed"
                          ? "Retry"
                          : item.status === "uploading"
                            ? "Uploading"
                            : "Upload"}
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <div className="mt-4 flex justify-end">
                <button
                  type="button"
                  disabled={
                    complete.isPending ||
                    query.data.images.length === 0 ||
                    items.some((item) => item.status !== "completed")
                  }
                  onClick={() => complete.mutate(group.id)}
                  className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-40"
                >
                  {complete.isPending ? "Completing…" : "Complete capture group"}
                </button>
              </div>
              {complete.error && (
                <div className="mt-3">
                  <ErrorState error={complete.error} />
                </div>
              )}
            </div>
          )}
        </>
      )}
    </Panel>
  );
}

export function CorpusSubmissionDetailPage() {
  const { submissionId = "" } = useParams();
  const query = useSubmission(submissionId);
  const canUpload = usePermission("grailscan.corpus.upload");
  const createGroup = useCreateGroup(submissionId);
  const completeSubmission = useCompleteSubmission(submissionId);
  const [showCreate, setShowCreate] = useState(false);
  const [workingLabel, setWorkingLabel] = useState("");
  const [expectedSides, setExpectedSides] = useState<ImageSide[]>(["front", "back", "angle"]);
  if (query.isLoading) return <LoadingState />;
  if (query.error || !query.data)
    return <ErrorState error={query.error} retry={() => void query.refetch()} />;
  return (
    <div className="space-y-4">
      <Link
        to="../submissions"
        className="inline-flex items-center gap-1 text-xs text-cyan-300 hover:underline"
      >
        <ChevronLeft className="h-3.5 w-3.5" />
        Submissions
      </Link>
      <Panel className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">
              Submission {query.data.submission.id.slice(0, 8)}
            </h2>
            <p className="mt-1 text-sm text-[var(--orbit-text-secondary)]">
              {query.data.submission.sourceType} ·{" "}
              {query.data.submission.sourceOrgNameSnapshot ?? "Internal provenance"}
            </p>
          </div>
          <StatusBadge value={query.data.submission.status} />
        </div>
        {query.data.submission.notes && (
          <p className="mt-4 text-sm">{query.data.submission.notes}</p>
        )}
      </Panel>
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Capture groups</h2>
        {canUpload && ["draft", "uploading"].includes(query.data.submission.status) && (
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1 rounded-lg bg-[var(--orbit-primary)] px-3 py-2 text-sm text-white"
          >
            <Plus className="h-4 w-4" />
            Add capture group
          </button>
        )}
      </div>
      {showCreate && (
        <Panel className="p-4">
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              createGroup.mutate(
                { workingLabel: workingLabel || undefined, expectedSides },
                {
                  onSuccess: () => {
                    setShowCreate(false);
                    setWorkingLabel("");
                    void query.refetch();
                  },
                },
              );
            }}
          >
            <div>
              <label htmlFor="group-label" className="mb-1 block text-xs font-medium">
                Working label
              </label>
              <input
                id="group-label"
                value={workingLabel}
                maxLength={200}
                onChange={(event) => setWorkingLabel(event.target.value)}
                placeholder="e.g. Charizard base set"
                className="h-9 w-full rounded-lg border border-[var(--orbit-border)] bg-[var(--orbit-bg-page)] px-3 text-sm"
              />
            </div>
            <fieldset>
              <legend className="mb-1 text-xs font-medium">Expected image sides</legend>
              <div className="flex flex-wrap gap-3">
                {["front", "back", "angle", "slab_label", "other"].map((value) => (
                  <label key={value} className="flex items-center gap-1.5 text-sm">
                    <input
                      type="checkbox"
                      checked={expectedSides.includes(value as ImageSide)}
                      onChange={(event) =>
                        setExpectedSides((current) =>
                          event.target.checked
                            ? [...current, value as ImageSide]
                            : current.filter((side) => side !== value),
                        )
                      }
                    />
                    {value.replaceAll("_", " ")}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={expectedSides.length === 0 || createGroup.isPending}
                className="rounded-lg bg-[var(--orbit-primary)] px-3 py-2 text-sm text-white disabled:opacity-40"
              >
                Create group
              </button>
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="rounded-lg border border-[var(--orbit-border)] px-3 py-2 text-sm"
              >
                Cancel
              </button>
            </div>
            {createGroup.error && <ErrorState error={createGroup.error} />}
          </form>
        </Panel>
      )}
      <div className="space-y-3">
        {query.data.groups.map((group) => (
          <GroupWorkspace key={group.id} group={group} submissionId={submissionId} />
        ))}
        {query.data.groups.length === 0 && (
          <Panel className="p-10 text-center text-sm text-[var(--orbit-text-muted)]">
            Create the first capture group to begin uploading.
          </Panel>
        )}
      </div>
      {canUpload &&
        !query.data.submission.completedAt &&
        query.data.groups.length > 0 &&
        query.data.groups.every(
          (group) => !["draft", "uploading", "processing"].includes(group.status),
        ) && (
          <div className="flex justify-end">
            <button
              type="button"
              disabled={completeSubmission.isPending}
              onClick={() => completeSubmission.mutate()}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
            >
              {completeSubmission.isPending ? "Completing…" : "Complete submission"}
            </button>
          </div>
        )}
      {completeSubmission.error && <ErrorState error={completeSubmission.error} />}
    </div>
  );
}
