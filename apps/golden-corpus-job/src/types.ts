export type ExecutionStatus = "RUNNING" | "SUCCEEDED" | "FAILED" | "DRY_RUN" | "ALREADY_BUILT";

export interface GoldenCorpusRecord {
  immutableRecordId: string | null;
  captureGroupId: string | null;
  category: string | null;
  productType: string | null;
  canonicalIdentity: string | null;
  status: string | null;
  uploaderActorId: string | null;
  reviewerActorId: string | null;
  approvedAt: string | Date | null;
  frontImageId: string | null;
  blobPath: string | null;
  blobChecksum: string | null;
  blobEtag: string | null;
  processingState: string | null;
  duplicateState: string | null;
  purgeState: string | null;
}

export interface AcceptedRecord {
  immutableRecordId: string;
  captureGroupId: string;
  category: string;
  productType: string;
  canonicalIdentity: string;
  blobPath: string;
  blobChecksum: string;
  blobEtag: string;
}

export interface RejectedRecord {
  immutableRecordId: string | null;
  captureGroupId: string | null;
  reasons: string[];
}

export interface ValidationResult {
  accepted: AcceptedRecord[];
  rejected: RejectedRecord[];
  categoryCounts: Record<string, number>;
}

export interface DatasetManifest {
  schemaVersion: "1.0";
  datasetName: string;
  datasetVersion: string | null;
  executionId: string;
  createdTimestamp: string;
  manifestHash: string;
  approvedCount: number;
  acceptedCount: number;
  rejectedCount: number;
  categoryCounts: Record<string, number>;
  acceptedRecords: AcceptedRecord[];
  rejectedRecords: RejectedRecord[];
}

export interface ValidationReport {
  schemaVersion: "1.0";
  executionId: string;
  approvedCount: number;
  acceptedCount: number;
  rejectedCount: number;
  rejectedRecords: RejectedRecord[];
}

export interface ExecutionRow {
  executionId: string;
  datasetVersion: string | null;
  manifestHash: string | null;
  startedAt: Date;
  completedAt: Date | null;
  durationMs: number | null;
  acceptedCount: number;
  rejectedCount: number;
  status: ExecutionStatus;
  dryRun: boolean;
  artifactLocation: string | null;
  safeErrorCode: string | null;
}

export interface BlobArtifactWriter {
  readManifest(path: string): Promise<DatasetManifest | null>;
  writeImmutable(path: string, contents: string, contentType: string): Promise<void>;
}

export interface ExecutionRepository {
  fetchApprovedRecords(maxRecords: number | null): Promise<GoldenCorpusRecord[]>;
  startExecution(row: ExecutionRow): Promise<void>;
  finishExecution(input: Pick<ExecutionRow, "executionId" | "datasetVersion" | "manifestHash" | "completedAt" | "durationMs" | "acceptedCount" | "rejectedCount" | "status" | "artifactLocation" | "safeErrorCode">): Promise<void>;
  close(): Promise<void>;
}
