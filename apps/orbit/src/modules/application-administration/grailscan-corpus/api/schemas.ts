import { z } from "zod";

export const SubmissionStatusSchema = z.enum([
  "draft",
  "uploading",
  "processing",
  "ready_for_review",
  "completed",
  "failed",
  "retired",
]);

export const GroupStatusSchema = z.enum([
  "draft",
  "uploading",
  "processing",
  "ready_for_review",
  "approved",
  "rejected",
  "duplicate",
  "retired",
  "rights_revoked",
]);

export const ImageSideSchema = z.enum(["front", "back", "angle", "slab_label", "other"]);

export const SubmissionSchema = z.object({
  id: z.string().uuid(),
  displayName: z.string(),
  sourceType: z.string(),
  sourceOrgId: z.string().nullable(),
  sourceOrgNameSnapshot: z.string().nullable(),
  sourceOrgReferenceType: z.string().nullable(),
  submittedByActorId: z.string(),
  status: SubmissionStatusSchema,
  notes: z.string().nullable(),
  clientContextJson: z.record(z.string(), z.unknown()).nullable(),
  clientContextSchemaVersion: z.string().nullable(),
  clientContextSizeBytes: z.number().int().nullable(),
  version: z.number().int(),
  completedAt: z.string().datetime().nullable(),
  completedByActorId: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const CaptureGroupSchema = z.object({
  id: z.string().uuid(),
  submissionId: z.string().uuid(),
  status: GroupStatusSchema,
  workingLabel: z.string().nullable(),
  uploadedByActorId: z.string(),
  expectedSidesJson: z.array(ImageSideSchema).nullable(),
  reviewClaimedByActorId: z.string().nullable(),
  reviewClaimExpiresAt: z.string().datetime().nullable(),
  rejectionReason: z.string().nullable(),
  duplicateOfGroupId: z.string().uuid().nullable(),
  version: z.number().int(),
  completedAt: z.string().datetime().nullable(),
  completedByActorId: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const ImageSchema = z.object({
  id: z.string().uuid(),
  groupId: z.string().uuid(),
  side: ImageSideSchema,
  originalFilename: z.string(),
  declaredContentType: z.string(),
  detectedContentType: z.string().nullable(),
  sizeBytes: z.number().int().nullable(),
  widthPixels: z.number().int().nullable(),
  heightPixels: z.number().int().nullable(),
  originalSha256: z.string().nullable(),
  dHash: z.string().nullable(),
  dHashVersion: z.string().nullable(),
  uploadState: z.string(),
  processingState: z.string(),
  qualityState: z.string(),
  duplicateState: z.string(),
  duplicateOfImageId: z.string().uuid().nullable(),
  purgeState: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const OverviewSchema = z.object({
  metrics: z.object({
    totalSubmissions: z.number().int(),
    incompleteSubmissions: z.number().int(),
    processingSubmissions: z.number().int(),
    reviewReadyGroups: z.number().int(),
    claimedReviews: z.number().int(),
    approvedGroups: z.number().int(),
    rejectedGroups: z.number().int(),
    duplicateGroups: z.number().int(),
    totalImages: z.number().int(),
    approvedPoolSize: z.number().int(),
    targetImages: z.number().int(),
    targetProgressPercent: z.number(),
    processingQueueDepth: z.number().int(),
    failedProcessingStages: z.number().int(),
  }),
  activeVersion: z
    .object({ id: z.string().uuid(), versionName: z.string(), memberCount: z.number().int() })
    .nullable(),
  latestRegression: z.record(z.string(), z.unknown()).nullable(),
  oldestPending: z.object({ id: z.string().uuid(), createdAt: z.string().datetime() }).nullable(),
  alerts: z.array(
    z.object({
      code: z.string(),
      severity: z.enum(["info", "warning", "danger"]),
      count: z.number().int(),
      targetType: z.string(),
      targetId: z.string().nullable(),
    }),
  ),
  generatedAt: z.string().datetime(),
});

export const SubmissionPageSchema = z.object({
  items: z.array(SubmissionSchema),
  nextCursor: z.string().nullable(),
});

export const SubmissionDetailSchema = z.object({
  submission: SubmissionSchema,
  groups: z.array(CaptureGroupSchema),
});

export const GroupDetailSchema = z.object({
  group: CaptureGroupSchema,
  images: z.array(ImageSchema),
  stages: z.array(z.record(z.string(), z.unknown())),
  quality: z.array(z.record(z.string(), z.unknown())),
  analyses: z.array(z.record(z.string(), z.unknown())),
  candidates: z.array(z.record(z.string(), z.unknown())),
});

export const ReviewQueuePageSchema = z.object({
  items: z.array(
    z.object({
      group: CaptureGroupSchema,
      imageCount: z.number().int(),
    }),
  ),
  nextCursor: z.string().nullable(),
});

export const ReviewClaimSchema = z.object({
  groupId: z.string().uuid(),
  claimedByActorId: z.string(),
  expiresAt: z.string().datetime(),
});

export const PreviewUrlSchema = z.object({
  url: z.string().url(),
  expiresInSeconds: z.number().int().positive(),
});

export const ReviewHistorySchema = z.object({
  history: z.array(z.record(z.string(), z.unknown())),
});

export const GroupStatusResultSchema = z.object({
  groupId: z.string().uuid(),
  status: z.string(),
});

export const VersionStatusSchema = z.enum([
  "draft",
  "validating",
  "manifest_pending",
  "manifest_written",
  "frozen",
  "active",
  "retired",
  "invalidated",
]);

export const CorpusVersionSchema = z.object({
  id: z.string().uuid(),
  versionName: z.string(),
  status: VersionStatusSchema,
  parentVersionId: z.string().uuid().nullable(),
  createdByActorId: z.string(),
  validationSummaryJson: z.record(z.string(), z.unknown()).nullable(),
  validationSchemaVersion: z.string().nullable(),
  manifestSha256: z.string().nullable(),
  manifestSchemaVersion: z.string().nullable(),
  memberCount: z.number().int().nonnegative(),
  version: z.number().int().positive(),
  frozenAt: z.string().datetime().nullable(),
  activatedAt: z.string().datetime().nullable(),
  invalidatedAt: z.string().datetime().nullable(),
  invalidationReason: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const VersionMemberSchema = z.object({
  id: z.string().uuid(),
  versionId: z.string().uuid(),
  imageId: z.string().uuid(),
  verifiedIdentityId: z.string().uuid(),
  rightsRecordId: z.string().uuid(),
  imageSha256: z.string().regex(/^[a-f0-9]{64}$/),
  identityVersion: z.number().int().positive(),
  rightsVersion: z.number().int().positive(),
  addedByActorId: z.string(),
  createdAt: z.string().datetime(),
});

export const VersionListSchema = z.object({ versions: z.array(CorpusVersionSchema) });
export const VersionDetailSchema = z.object({
  version: CorpusVersionSchema,
  members: z.array(VersionMemberSchema),
});
export const VersionValidationSchema = z.object({
  valid: z.boolean(),
  errors: z.array(z.string()),
  memberCount: z.number().int().nonnegative(),
});

export const CoverageSummarySchema = z.object({
  targetImages: z.number().int().positive(),
  approved: z.number().int().nonnegative(),
  remaining: z.number().int().nonnegative(),
  byStatus: z.record(z.string(), z.number().int().nonnegative()),
  byCategory: z.record(z.string(), z.number().int().nonnegative()),
});

export const RegressionStatusSchema = z.enum(["queued", "running", "completed", "failed"]);
export const RegressionRunSchema = z.object({
  id: z.string().uuid(),
  versionId: z.string().uuid(),
  priorRunId: z.string().uuid().nullable(),
  evidenceMode: z.literal("recorded"),
  status: RegressionStatusSchema,
  initiatedByActorId: z.string(),
  configurationJson: z.record(z.string(), z.unknown()),
  configurationSchemaVersion: z.string(),
  configurationSizeBytes: z.number().int().nonnegative(),
  summaryJson: z.record(z.string(), z.unknown()).nullable(),
  summarySchemaVersion: z.string().nullable(),
  summarySizeBytes: z.number().int().nonnegative().nullable(),
  totalCount: z.number().int().nonnegative(),
  completedCount: z.number().int().nonnegative(),
  providerCostUsd: z.string(),
  startedAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});

export const RegressionResultSchema = z.object({
  id: z.string().uuid(),
  runId: z.string().uuid(),
  versionMemberId: z.string().uuid(),
  expectedJson: z.record(z.string(), z.unknown()),
  predictedJson: z.record(z.string(), z.unknown()).nullable(),
  resultSchemaVersion: z.string(),
  resultSizeBytes: z.number().int().nonnegative(),
  matched: z.boolean(),
  confidence: z.string().nullable(),
  latencyMs: z.number().int().nonnegative(),
  failureCategory: z.string().nullable(),
  createdAt: z.string().datetime(),
});

export const RegressionRunsSchema = z.object({ runs: z.array(RegressionRunSchema) });
export const RegressionResultsSchema = z.object({ results: z.array(RegressionResultSchema) });

export const HealthStatusSchema = z.enum(["Healthy", "Degraded", "Disabled", "Unknown"]);
export const CorpusHealthSchema = z.object({
  status: HealthStatusSchema,
  components: z.object({
    api: HealthStatusSchema,
    database: HealthStatusSchema,
    blob: HealthStatusSchema,
    upload: HealthStatusSchema,
    processing: HealthStatusSchema,
    review: HealthStatusSchema,
    freeze: HealthStatusSchema,
    regression: HealthStatusSchema,
    purge: HealthStatusSchema,
    audit: HealthStatusSchema,
    cleanup: HealthStatusSchema,
  }),
  capabilities: z.object({
    base: z.boolean(),
    upload: z.boolean(),
    processing: z.boolean(),
    regression: z.boolean(),
  }),
  counts: z.object({
    processing: z.record(z.string(), z.number().int().nonnegative()),
    readyForReview: z.number().int().nonnegative(),
    pendingFreezeOperations: z.number().int().nonnegative(),
    purges: z.record(z.string(), z.number().int().nonnegative()),
    regressions: z.record(z.string(), z.number().int().nonnegative()),
  }),
  generatedAt: z.string().datetime(),
});

export const StorageMetricsSchema = z.object({
  status: HealthStatusSchema,
  container: z.literal("private"),
  images: z.array(
    z.object({
      purgeState: z.string(),
      objectCount: z.number().int().nonnegative(),
      knownBytes: z.number().int().nonnegative(),
    }),
  ),
  recordedBundles: z.object({
    objectCount: z.number().int().nonnegative(),
    knownPlaintextBytes: z.number().int().nonnegative(),
  }),
  manifests: z.object({
    objectCount: z.number().int().nonnegative(),
    memberCount: z.number().int().nonnegative(),
  }),
  generatedAt: z.string().datetime(),
});

export const AuditEventSchema = z.object({
  id: z.string().uuid(),
  actorId: z.string(),
  sourceOrgId: z.string().nullable(),
  action: z.string(),
  targetType: z.string(),
  targetId: z.string(),
  correlationId: z.string().nullable(),
  orbitRequestId: z.string(),
  detailJson: z.record(z.string(), z.unknown()).nullable(),
  detailSchemaVersion: z.string().nullable(),
  detailSizeBytes: z.number().int().nonnegative().nullable(),
  createdAt: z.string().datetime(),
});
export const AuditPageSchema = z.object({
  items: z.array(AuditEventSchema),
  nextCursor: z.string().nullable(),
});

export const UploadAuthorizationSchema = z.object({
  authorization: z.object({
    authorizationId: z.string().uuid(),
    imageId: z.string().uuid(),
    blobKey: z.string(),
    contentType: z.string(),
    uploadUrl: z.string().url(),
    expiresAt: z.string().datetime(),
    maximumByteSize: z.number().int(),
  }),
});

export const CorpusErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    correlationId: z.string().nullable().optional(),
    details: z.unknown().optional(),
  }),
});

export type Submission = z.infer<typeof SubmissionSchema>;
export type CaptureGroup = z.infer<typeof CaptureGroupSchema>;
export type CorpusImage = z.infer<typeof ImageSchema>;
export type ImageSide = z.infer<typeof ImageSideSchema>;
export type ReviewQueueItem = z.infer<typeof ReviewQueuePageSchema>["items"][number];
export type CorpusVersion = z.infer<typeof CorpusVersionSchema>;
export type VersionMember = z.infer<typeof VersionMemberSchema>;
export type RegressionRun = z.infer<typeof RegressionRunSchema>;
export type RegressionResult = z.infer<typeof RegressionResultSchema>;
export type CorpusHealth = z.infer<typeof CorpusHealthSchema>;
export type StorageMetrics = z.infer<typeof StorageMetricsSchema>;
export type AuditEvent = z.infer<typeof AuditEventSchema>;

export interface RightsInput {
  ownerName: string;
  basis: string;
  reference?: string;
  consentVersion: string;
  consentedAt: string;
  retentionAllowed: boolean;
  internalEvaluationAllowed: boolean;
  regressionAllowed: boolean;
  productImprovementAllowed: boolean;
  modelTrainingAllowed: boolean;
  documentationAllowed: boolean;
  revocable: boolean;
}

export interface IdentityInput {
  canonicalKey: string;
  category: string;
  franchise: string;
  collectibleName: string;
  setCode?: string;
  setName: string;
  collectorNumber?: string;
  language: string;
  variant?: string;
  edition?: string;
  conditionState: "raw" | "graded";
  gradingCompany?: string;
  grade?: string;
  certificateNumber?: string;
}
