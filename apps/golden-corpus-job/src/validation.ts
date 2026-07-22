import type { AcceptedRecord, GoldenCorpusRecord, RejectedRecord, ValidationResult } from "./types.js";

function required(value: string | null, code: string, reasons: string[]): value is string {
  if (!value?.trim()) {
    reasons.push(code);
    return false;
  }
  return true;
}

function accepted(record: GoldenCorpusRecord): AcceptedRecord {
  return {
    immutableRecordId: record.immutableRecordId!,
    captureGroupId: record.captureGroupId!,
    category: record.category!,
    productType: record.productType!,
    canonicalIdentity: record.canonicalIdentity!,
    blobPath: record.blobPath!,
    blobChecksum: record.blobChecksum!,
    blobEtag: record.blobEtag!,
  };
}

export function compareAcceptedRecords(left: AcceptedRecord, right: AcceptedRecord): number {
  return (
    left.category.localeCompare(right.category) ||
    left.productType.localeCompare(right.productType) ||
    left.canonicalIdentity.localeCompare(right.canonicalIdentity) ||
    left.immutableRecordId.localeCompare(right.immutableRecordId)
  );
}

export function validateRecords(records: readonly GoldenCorpusRecord[]): ValidationResult {
  const immutableIdCounts = new Map<string, number>();
  const checksumIdentities = new Map<string, Set<string>>();
  for (const record of records) {
    if (record.immutableRecordId) {
      immutableIdCounts.set(
        record.immutableRecordId,
        (immutableIdCounts.get(record.immutableRecordId) ?? 0) + 1,
      );
    }
    if (record.blobChecksum && record.canonicalIdentity) {
      const identities = checksumIdentities.get(record.blobChecksum) ?? new Set<string>();
      identities.add(record.canonicalIdentity);
      checksumIdentities.set(record.blobChecksum, identities);
    }
  }

  const acceptedRecords: AcceptedRecord[] = [];
  const rejected: RejectedRecord[] = [];
  for (const record of records) {
    const reasons: string[] = [];
    required(record.immutableRecordId, "immutable_record_id_required", reasons);
    required(record.captureGroupId, "capture_group_id_required", reasons);
    required(record.category, "category_required", reasons);
    required(record.productType, "product_type_required", reasons);
    required(record.canonicalIdentity, "canonical_identity_required", reasons);
    required(record.reviewerActorId, "reviewer_required", reasons);
    if (!record.approvedAt || Number.isNaN(new Date(record.approvedAt).getTime())) {
      reasons.push("approval_timestamp_required");
    }
    required(record.frontImageId, "front_image_required", reasons);
    required(record.blobPath, "blob_reference_required", reasons);
    required(record.blobChecksum, "blob_checksum_required", reasons);
    required(record.blobEtag, "blob_etag_required", reasons);
    if (record.status !== "approved") reasons.push("record_not_approved");
    if (record.processingState !== "completed") reasons.push("image_not_processed");
    if (record.duplicateState === "exact_duplicate") reasons.push("duplicate_image");
    if (record.purgeState && record.purgeState !== "not_requested") {
      reasons.push("record_deleted_or_purged");
    }
    if (
      record.uploaderActorId &&
      record.reviewerActorId &&
      record.uploaderActorId === record.reviewerActorId
    ) {
      reasons.push("self_approval_forbidden");
    }
    if (
      record.immutableRecordId &&
      (immutableIdCounts.get(record.immutableRecordId) ?? 0) > 1
    ) {
      reasons.push("duplicate_immutable_record_id");
    }
    if (
      record.blobChecksum &&
      (checksumIdentities.get(record.blobChecksum)?.size ?? 0) > 1
    ) {
      reasons.push("checksum_identity_conflict");
    }
    if (reasons.length > 0) {
      rejected.push({
        immutableRecordId: record.immutableRecordId,
        captureGroupId: record.captureGroupId,
        reasons: [...new Set(reasons)].sort(),
      });
    } else {
      acceptedRecords.push(accepted(record));
    }
  }

  const ordered = acceptedRecords.sort(compareAcceptedRecords);
  const categoryCounts = ordered.reduce<Record<string, number>>((counts, record) => {
    counts[record.category] = (counts[record.category] ?? 0) + 1;
    return counts;
  }, {});
  return {
    accepted: ordered,
    rejected: rejected.sort((a, b) =>
      (a.immutableRecordId ?? "").localeCompare(b.immutableRecordId ?? ""),
    ),
    categoryCounts,
  };
}
