import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { corpusApi, createIdempotencyKey } from "./client";
import {
  CaptureGroupSchema,
  GroupDetailSchema,
  ImageSideSchema,
  OverviewSchema,
  PreviewUrlSchema,
  ReviewClaimSchema,
  ReviewHistorySchema,
  ReviewQueuePageSchema,
  GroupStatusResultSchema,
  SubmissionDetailSchema,
  SubmissionPageSchema,
  SubmissionSchema,
  UploadAuthorizationSchema,
  CorpusVersionSchema,
  CorpusHealthSchema,
  CoverageSummarySchema,
  AuditPageSchema,
  RegressionResultsSchema,
  RegressionRunSchema,
  RegressionRunsSchema,
  StorageMetricsSchema,
  VersionDetailSchema,
  VersionListSchema,
  VersionMemberSchema,
  VersionValidationSchema,
  type IdentityInput,
  type ImageSide,
  type RightsInput,
} from "./schemas";

const envelope = <T extends z.ZodTypeAny>(name: string, schema: T) => z.object({ [name]: schema });

export function useCorpusOverview() {
  return useQuery({
    queryKey: ["grailscan-corpus", "overview"],
    queryFn: () => corpusApi("/overview", OverviewSchema),
    refetchInterval: 30_000,
  });
}

export function useSubmissions(status?: string) {
  return useQuery({
    queryKey: ["grailscan-corpus", "submissions", status ?? "all"],
    queryFn: () =>
      corpusApi(
        `/submissions?limit=100${status ? `&status=${encodeURIComponent(status)}` : ""}`,
        SubmissionPageSchema,
      ),
  });
}

export function useSubmission(submissionId: string) {
  return useQuery({
    queryKey: ["grailscan-corpus", "submission", submissionId],
    queryFn: () => corpusApi(`/submissions/${submissionId}`, SubmissionDetailSchema),
    enabled: Boolean(submissionId),
    refetchInterval: (query) =>
      query.state.data?.groups.some((group) => group.status === "processing") ? 5_000 : false,
  });
}

export function useGroup(groupId: string) {
  return useQuery({
    queryKey: ["grailscan-corpus", "group", groupId],
    queryFn: () => corpusApi(`/groups/${groupId}`, GroupDetailSchema),
    enabled: Boolean(groupId),
    refetchInterval: (query) =>
      query.state.data?.images.some((image) =>
        ["pending", "inspecting", "hashing", "analyzing"].includes(image.processingState),
      )
        ? 4_000
        : false,
  });
}

export function useCreateSubmission() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      sourceType: string;
      sourceOrgId?: string;
      sourceOrgNameSnapshot?: string;
      notes?: string;
    }) =>
      corpusApi("/submissions", envelope("submission", SubmissionSchema), {
        method: "POST",
        headers: { "idempotency-key": createIdempotencyKey("submission") },
        body: JSON.stringify(input),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["grailscan-corpus"] }),
  });
}

export function useCreateGroup(submissionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { workingLabel?: string; expectedSides: ImageSide[] }) =>
      corpusApi(`/submissions/${submissionId}/groups`, envelope("group", CaptureGroupSchema), {
        method: "POST",
        headers: { "idempotency-key": createIdempotencyKey("group") },
        body: JSON.stringify(input),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["grailscan-corpus"] }),
  });
}

export async function uploadCorpusImage(input: {
  groupId: string;
  side: ImageSide;
  file: File;
  onProgress: (percent: number) => void;
}): Promise<string> {
  ImageSideSchema.parse(input.side);
  const authorized = await corpusApi(
    `/groups/${input.groupId}/images/upload-authorizations`,
    UploadAuthorizationSchema,
    {
      method: "POST",
      headers: { "idempotency-key": createIdempotencyKey("upload-authorize") },
      body: JSON.stringify({
        side: input.side,
        fileName: input.file.name,
        contentType: input.file.type,
        maximumByteSize: input.file.size,
      }),
    },
  );
  const etag = await new Promise<string>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", authorized.authorization.uploadUrl);
    request.setRequestHeader("x-ms-blob-type", "BlockBlob");
    request.setRequestHeader("Content-Type", input.file.type);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) input.onProgress(Math.round((event.loaded / event.total) * 100));
    };
    request.onerror = () => reject(new Error("Direct Blob upload failed"));
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        resolve(request.getResponseHeader("etag") ?? "");
      } else {
        reject(new Error(`Direct Blob upload failed (${request.status})`));
      }
    };
    request.send(input.file);
  });
  await corpusApi(
    `/images/${authorized.authorization.imageId}/complete`,
    z.object({
      imageId: z.string().uuid(),
      status: z.literal("uploaded"),
      etag: z.string().nullable(),
    }),
    {
      method: "POST",
      headers: { "idempotency-key": createIdempotencyKey("upload-complete") },
      body: JSON.stringify({
        authorizationId: authorized.authorization.authorizationId,
        ...(etag ? { etag } : {}),
      }),
    },
  );
  return authorized.authorization.imageId;
}

export function useCompleteSubmission(submissionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      corpusApi(`/submissions/${submissionId}/complete`, envelope("submission", SubmissionSchema), {
        method: "POST",
        headers: { "idempotency-key": createIdempotencyKey("submission-complete") },
        body: JSON.stringify({}),
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ["grailscan-corpus", "submission", submissionId],
      }),
  });
}

export function useApprovedPool() {
  return useQuery({
    queryKey: ["grailscan-corpus", "approved-pool"],
    queryFn: () => corpusApi("/approved-pool?limit=100", ReviewQueuePageSchema),
  });
}

export function useReviewQueue(status = "ready_for_review") {
  return useQuery({
    queryKey: ["grailscan-corpus", "review-queue", status],
    queryFn: () =>
      corpusApi(
        `/review-queue?limit=100&status=${encodeURIComponent(status)}`,
        ReviewQueuePageSchema,
      ),
    refetchInterval: 15_000,
  });
}

export function useImagePreview(imageId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["grailscan-corpus", "preview", imageId],
    queryFn: () => corpusApi(`/images/${imageId}/preview`, PreviewUrlSchema),
    enabled: Boolean(imageId) && enabled,
    staleTime: 45_000,
  });
}

export function useReviewHistory(groupId: string) {
  return useQuery({
    queryKey: ["grailscan-corpus", "review-history", groupId],
    queryFn: () => corpusApi(`/groups/${groupId}/review-history`, ReviewHistorySchema),
    enabled: Boolean(groupId),
  });
}

export function useReviewActions(groupId: string) {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["grailscan-corpus"] });
  const claim = useMutation({
    mutationFn: () =>
      corpusApi(`/groups/${groupId}/claim`, ReviewClaimSchema, {
        method: "POST",
        headers: { "idempotency-key": createIdempotencyKey("review-claim") },
        body: JSON.stringify({}),
      }),
    onSuccess: invalidate,
  });
  const release = useMutation({
    mutationFn: () =>
      corpusApi(
        `/groups/${groupId}/release`,
        z.object({ groupId: z.string().uuid(), released: z.boolean() }),
        {
          method: "POST",
          headers: { "idempotency-key": createIdempotencyKey("review-release") },
          body: JSON.stringify({}),
        },
      ),
    onSuccess: invalidate,
  });
  const rights = useMutation({
    mutationFn: (body: RightsInput) =>
      corpusApi(
        `/groups/${groupId}/rights`,
        z.object({ rights: z.record(z.string(), z.unknown()) }),
        {
          method: "PUT",
          headers: { "idempotency-key": createIdempotencyKey("review-rights") },
          body: JSON.stringify(body),
        },
      ),
    onSuccess: invalidate,
  });
  const approve = useMutation({
    mutationFn: (body: ReviewDecisionInput) =>
      corpusApi(
        `/groups/${groupId}/approve`,
        z.object({ identity: z.record(z.string(), z.unknown()) }),
        {
          method: "POST",
          headers: { "idempotency-key": createIdempotencyKey("review-approve") },
          body: JSON.stringify(body),
        },
      ),
    onSuccess: invalidate,
  });
  const reject = useMutation({
    mutationFn: (body: { reasonCode: string; notes?: string }) =>
      corpusApi(`/groups/${groupId}/reject`, GroupStatusResultSchema, {
        method: "POST",
        headers: { "idempotency-key": createIdempotencyKey("review-reject") },
        body: JSON.stringify(body),
      }),
    onSuccess: invalidate,
  });
  const duplicate = useMutation({
    mutationFn: (body: { duplicateOfGroupId: string; reasonCode: string }) =>
      corpusApi(`/groups/${groupId}/mark-duplicate`, GroupStatusResultSchema, {
        method: "POST",
        headers: { "idempotency-key": createIdempotencyKey("review-duplicate") },
        body: JSON.stringify(body),
      }),
    onSuccess: invalidate,
  });
  return { claim, release, rights, approve, reject, duplicate };
}

export type ReviewDecisionInput = {
  identity: IdentityInput;
  reasonCode: string;
  notes?: string;
};
export type { RightsInput };

export function useCorpusVersions() {
  return useQuery({
    queryKey: ["grailscan-corpus", "versions"],
    queryFn: () => corpusApi("/versions", VersionListSchema),
  });
}

export function useCorpusVersion(versionId: string) {
  return useQuery({
    queryKey: ["grailscan-corpus", "version", versionId],
    queryFn: () => corpusApi(`/versions/${versionId}`, VersionDetailSchema),
    enabled: Boolean(versionId),
  });
}

export function useCreateCorpusVersion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { versionName: string; parentVersionId?: string }) =>
      corpusApi("/versions", envelope("version", CorpusVersionSchema), {
        method: "POST",
        headers: { "idempotency-key": createIdempotencyKey("version-create") },
        body: JSON.stringify(input),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["grailscan-corpus", "versions"] }),
  });
}

export function useVersionActions(versionId: string) {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["grailscan-corpus"] });
  const addMember = useMutation({
    mutationFn: (imageId: string) =>
      corpusApi(`/versions/${versionId}/members`, envelope("member", VersionMemberSchema), {
        method: "POST",
        headers: { "idempotency-key": createIdempotencyKey("version-member-add") },
        body: JSON.stringify({ imageId }),
      }),
    onSuccess: invalidate,
  });
  const removeMember = useMutation({
    mutationFn: (imageId: string) =>
      corpusApi(
        `/versions/${versionId}/members/${imageId}`,
        z.object({ removed: z.literal(true) }),
        {
          method: "DELETE",
          headers: { "idempotency-key": createIdempotencyKey("version-member-remove") },
          body: JSON.stringify({}),
        },
      ),
    onSuccess: invalidate,
  });
  const validate = useMutation({
    mutationFn: () =>
      corpusApi(`/versions/${versionId}/validate`, VersionValidationSchema, { method: "POST" }),
  });
  const freeze = useMutation({
    mutationFn: () =>
      corpusApi(`/versions/${versionId}/freeze`, envelope("version", CorpusVersionSchema), {
        method: "POST",
        headers: { "idempotency-key": createIdempotencyKey("version-freeze") },
        body: JSON.stringify({}),
      }),
    onSuccess: invalidate,
  });
  const activate = useMutation({
    mutationFn: () =>
      corpusApi(`/versions/${versionId}/activate`, envelope("version", CorpusVersionSchema), {
        method: "POST",
        headers: { "idempotency-key": createIdempotencyKey("version-activate") },
        body: JSON.stringify({}),
      }),
    onSuccess: invalidate,
  });
  return { addMember, removeMember, validate, freeze, activate };
}

export function useCoverageSummary() {
  return useQuery({
    queryKey: ["grailscan-corpus", "coverage"],
    queryFn: () => corpusApi("/coverage", CoverageSummarySchema),
  });
}

export function useRegressionRuns() {
  return useQuery({
    queryKey: ["grailscan-corpus", "regression-runs"],
    queryFn: () => corpusApi("/regression-runs", RegressionRunsSchema),
    refetchInterval: (query) =>
      query.state.data?.runs.some((run) => run.status === "queued" || run.status === "running")
        ? 5_000
        : false,
  });
}

export function useRegressionRun(runId: string) {
  return useQuery({
    queryKey: ["grailscan-corpus", "regression-run", runId],
    queryFn: () => corpusApi(`/regression-runs/${runId}`, envelope("run", RegressionRunSchema)),
    enabled: Boolean(runId),
    refetchInterval: (query) =>
      query.state.data?.run.status === "queued" || query.state.data?.run.status === "running"
        ? 3_000
        : false,
  });
}

export function useRegressionResults(runId: string, failuresOnly = false) {
  return useQuery({
    queryKey: ["grailscan-corpus", "regression-results", runId, failuresOnly],
    queryFn: () =>
      corpusApi(
        `/regression-runs/${runId}/${failuresOnly ? "failures" : "results"}`,
        RegressionResultsSchema,
      ),
    enabled: Boolean(runId),
  });
}

export function useCreateRegressionRun() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { versionId: string; priorRunId?: string }) =>
      corpusApi("/regression-runs", envelope("run", RegressionRunSchema), {
        method: "POST",
        headers: { "idempotency-key": createIdempotencyKey("regression-create") },
        body: JSON.stringify({ ...input, evidenceMode: "recorded" }),
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["grailscan-corpus", "regression-runs"] }),
  });
}

export function parseRegressionAccuracy(summary: Record<string, unknown> | null): number | null {
  return summary && typeof summary.accuracy === "number" ? summary.accuracy : null;
}

export function useCorpusHealth() {
  return useQuery({
    queryKey: ["grailscan-corpus", "health"],
    queryFn: () => corpusApi("/health", CorpusHealthSchema),
    refetchInterval: 30_000,
  });
}

export function useStorageMetrics() {
  return useQuery({
    queryKey: ["grailscan-corpus", "storage"],
    queryFn: () => corpusApi("/storage", StorageMetricsSchema),
    refetchInterval: 60_000,
  });
}

export function useCorpusAudit(filters: {
  action?: string;
  actorId?: string;
  targetType?: string;
}) {
  const query = new URLSearchParams({ limit: "100" });
  if (filters.action) query.set("action", filters.action);
  if (filters.actorId) query.set("actorId", filters.actorId);
  if (filters.targetType) query.set("targetType", filters.targetType);
  return useQuery({
    queryKey: ["grailscan-corpus", "audit", filters],
    queryFn: () => corpusApi(`/audit?${query.toString()}`, AuditPageSchema),
  });
}

export function useCompleteGroup(submissionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (groupId: string) =>
      corpusApi(`/groups/${groupId}/complete`, envelope("group", CaptureGroupSchema), {
        method: "POST",
        headers: { "idempotency-key": createIdempotencyKey("group-complete") },
        body: JSON.stringify({}),
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["grailscan-corpus", "submission", submissionId] }),
  });
}
