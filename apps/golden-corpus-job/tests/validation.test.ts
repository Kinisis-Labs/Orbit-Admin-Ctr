import assert from "node:assert/strict";
import test from "node:test";
import { buildManifest } from "../src/manifest.js";
import type { GoldenCorpusRecord } from "../src/types.js";
import { validateRecords } from "../src/validation.js";

function record(overrides: Partial<GoldenCorpusRecord> = {}): GoldenCorpusRecord {
  return {
    immutableRecordId: "00000000-0000-4000-8000-000000000001",
    captureGroupId: "10000000-0000-4000-8000-000000000001",
    category: "tcg",
    productType: "trading_card",
    canonicalIdentity: "pokemon:base:4",
    status: "approved",
    uploaderActorId: "uploader",
    reviewerActorId: "reviewer",
    approvedAt: "2026-07-22T12:00:00.000Z",
    frontImageId: "00000000-0000-4000-8000-000000000001",
    blobPath: "submissions/record.jpg",
    blobChecksum: "a".repeat(64),
    blobEtag: "etag",
    processingState: "completed",
    duplicateState: "cleared",
    purgeState: "not_requested",
    ...overrides,
  };
}

function manifest(records: GoldenCorpusRecord[]) {
  const validation = validateRecords(records);
  return buildManifest({
    datasetName: "grailscan-golden-corpus",
    approvedCount: records.length,
    executionId: "build-test",
    createdTimestamp: "2026-07-22T12:00:00.000Z",
    datasetVersion: "golden-corpus-20260722-deadbeef",
    validation,
  });
}

test("sorts accepted records deterministically without SQL ordering", () => {
  const unordered = [
    record({ immutableRecordId: "3", category: "z", productType: "p", canonicalIdentity: "z" }),
    record({ immutableRecordId: "2", category: "a", productType: "z", canonicalIdentity: "z", blobChecksum: "b".repeat(64) }),
    record({ immutableRecordId: "1", category: "a", productType: "a", canonicalIdentity: "z", blobChecksum: "c".repeat(64) }),
  ];
  assert.deepEqual(
    validateRecords(unordered).accepted.map((item) => item.immutableRecordId),
    ["1", "2", "3"],
  );
});

test("produces a stable manifest hash for equivalent input", () => {
  const left = manifest([record(), record({ immutableRecordId: "2", blobChecksum: "b".repeat(64) })]);
  const right = manifest([record({ immutableRecordId: "2", blobChecksum: "b".repeat(64) }), record()]);
  assert.equal(left.manifest.manifestHash, right.manifest.manifestHash);
  assert.deepEqual(left.manifest.acceptedRecords, right.manifest.acceptedRecords);
});

test("rejects every duplicate immutable record ID", () => {
  const result = validateRecords([record(), record({ captureGroupId: "2" })]);
  assert.equal(result.accepted.length, 0);
  assert.ok(result.rejected.every((item) => item.reasons.includes("duplicate_immutable_record_id")));
});

test("rejects conflicting identities that share a checksum", () => {
  const result = validateRecords([
    record(),
    record({ immutableRecordId: "2", captureGroupId: "2", canonicalIdentity: "different" }),
  ]);
  assert.equal(result.accepted.length, 0);
  assert.ok(result.rejected.every((item) => item.reasons.includes("checksum_identity_conflict")));
});

test("rejects missing front image and incomplete metadata", () => {
  const result = validateRecords([
    record({ frontImageId: null }),
    record({ immutableRecordId: "2", captureGroupId: "2", category: null, productType: null, blobChecksum: "b".repeat(64) }),
  ]);
  assert.ok(result.rejected[0]!.reasons.includes("front_image_required"));
  assert.ok(result.rejected[1]!.reasons.includes("category_required"));
  assert.ok(result.rejected[1]!.reasons.includes("product_type_required"));
});

test("rejects uploader self-approval and non-approved lifecycle states", () => {
  const result = validateRecords([
    record({ uploaderActorId: "reviewer" }),
    record({ immutableRecordId: "2", captureGroupId: "2", status: "pending", blobChecksum: "b".repeat(64) }),
    record({ immutableRecordId: "3", captureGroupId: "3", status: "rejected", blobChecksum: "c".repeat(64) }),
  ]);
  assert.ok(result.rejected[0]!.reasons.includes("self_approval_forbidden"));
  assert.ok(result.rejected[1]!.reasons.includes("record_not_approved"));
  assert.ok(result.rejected[2]!.reasons.includes("record_not_approved"));
});
