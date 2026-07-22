import { canonicalJson, sha256, shortHash } from "./hashing.js";
import type { DatasetManifest, ValidationReport, ValidationResult } from "./types.js";

export interface ManifestBuild {
  manifest: DatasetManifest;
  validationReport: ValidationReport;
  checksums: Record<string, string>;
}

export function buildManifest(input: {
  datasetName: string;
  approvedCount: number;
  executionId: string;
  createdTimestamp: string;
  datasetVersion: string | null;
  validation: ValidationResult;
}): ManifestBuild {
  const withoutHash = {
    schemaVersion: "1.0" as const,
    datasetName: input.datasetName,
    datasetVersion: input.datasetVersion,
    executionId: input.executionId,
    createdTimestamp: input.createdTimestamp,
    approvedCount: input.approvedCount,
    acceptedCount: input.validation.accepted.length,
    rejectedCount: input.validation.rejected.length,
    categoryCounts: input.validation.categoryCounts,
    acceptedRecords: input.validation.accepted,
    rejectedRecords: input.validation.rejected,
  };
  const manifestHash = sha256(canonicalJson(withoutHash));
  const manifest: DatasetManifest = { ...withoutHash, manifestHash };
  const validationReport: ValidationReport = {
    schemaVersion: "1.0",
    executionId: input.executionId,
    approvedCount: input.approvedCount,
    acceptedCount: input.validation.accepted.length,
    rejectedCount: input.validation.rejected.length,
    rejectedRecords: input.validation.rejected,
  };
  const checksums = Object.fromEntries(input.validation.accepted.map((record) => [record.immutableRecordId, record.blobChecksum]));
  return { manifest, validationReport, checksums };
}

export function deterministicExecutionId(validation: ValidationResult): string {
  return `build-${shortHash(sha256(canonicalJson(validation)), 24)}`;
}

export function deterministicCreatedTimestamp(records: readonly { approvedAt: string | Date | null }[]): string {
  const dates = records
    .map((record) => (record.approvedAt ? new Date(record.approvedAt).getTime() : Number.NaN))
    .filter((value) => Number.isFinite(value));
  return new Date(dates.length === 0 ? 0 : Math.max(...dates)).toISOString();
}
