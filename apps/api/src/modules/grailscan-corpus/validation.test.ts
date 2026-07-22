import assert from "node:assert/strict";
import test from "node:test";
import {
  assertBrowserSafeCorpusResponse,
  assertExpectedCorpusResponse,
  validateCorpusProxyBody,
} from "./validation.js";

test("rejects private storage and certificate fields", () => {
  assert.throws(
    () => assertBrowserSafeCorpusResponse({ image: { originalBlobKey: "private/key" } }),
    /grailscan_corpus_forbidden_upstream_field/,
  );
  assert.throws(
    () => assertBrowserSafeCorpusResponse({ identity: { certificateEncrypted: "secret" } }),
    /grailscan_corpus_forbidden_upstream_field/,
  );
});

test("validates and trims submission mutation bodies", () => {
  assert.deepEqual(
    validateCorpusProxyBody("POST", "/submissions", {
      sourceType: " founder_capture ",
      notes: " capture day ",
    }),
    {
      sourceType: "founder_capture",
      sourceOrgId: undefined,
      sourceOrgNameSnapshot: undefined,
      sourceOrgReferenceType: undefined,
      notes: "capture day",
    },
  );
  assert.throws(
    () => validateCorpusProxyBody("POST", "/submissions", { sourceType: "x", secret: "no" }),
    /grailscan_corpus_invalid_request/,
  );
});

test("rejects unsupported upload media and invalid optimistic versions", () => {
  assert.throws(
    () =>
      validateCorpusProxyBody("POST", "/groups/id/images/upload-authorizations", {
        side: "front",
        fileName: "card.gif",
        contentType: "image/gif",
      }),
    /grailscan_corpus_invalid_request/,
  );
  assert.throws(
    () => validateCorpusProxyBody("PATCH", "/groups/id", { version: 0, workingLabel: "x" }),
    /grailscan_corpus_invalid_request/,
  );
});

test("permits short-lived upload URL and assigned key only for upload authorization", () => {
  assertExpectedCorpusResponse("/groups/id/images/upload-authorizations", {
    authorization: { uploadUrl: "https://example.invalid/sas", blobKey: "submissions/key" },
  });
  assert.throws(
    () => assertExpectedCorpusResponse("/images/id", { image: { uploadUrl: "secret" } }),
    /grailscan_corpus_forbidden_upstream_field/,
  );
});

test("validates complete rights evidence and rejects partial or unknown rights fields", () => {
  const input = {
    ownerName: " Collector ",
    basis: "owner_consent",
    consentVersion: "1.0",
    consentedAt: "2026-07-21T20:00:00.000Z",
    retentionAllowed: true,
    internalEvaluationAllowed: true,
    regressionAllowed: true,
    productImprovementAllowed: true,
    modelTrainingAllowed: false,
    documentationAllowed: false,
    revocable: true,
  };
  assert.deepEqual(validateCorpusProxyBody("PUT", "/groups/id/rights", input), {
    ...input,
    ownerName: "Collector",
    reference: undefined,
  });
  assert.throws(
    () => validateCorpusProxyBody("PUT", "/groups/id/rights", { ...input, revocable: undefined }),
    /grailscan_corpus_invalid_request/,
  );
  assert.throws(
    () => validateCorpusProxyBody("PUT", "/groups/id/rights", { ...input, secret: "no" }),
    /grailscan_corpus_invalid_request/,
  );
});

test("validates approval identity and enforces graded-card evidence", () => {
  const identity = {
    canonicalKey: "pokemon:base:4",
    category: "tcg",
    franchise: "Pokemon",
    collectibleName: "Charizard",
    setName: "Base Set",
    language: "en",
    conditionState: "raw",
  };
  assert.deepEqual(
    validateCorpusProxyBody("POST", "/groups/id/approve", {
      identity,
      reasonCode: "human_verified",
    }),
    {
      identity: {
        canonicalCardId: undefined,
        canonicalCollectibleId: undefined,
        ...identity,
        setCode: undefined,
        collectorNumber: undefined,
        variant: undefined,
        edition: undefined,
        gradingCompany: undefined,
        grade: undefined,
        certificateNumber: undefined,
      },
      reasonCode: "human_verified",
      notes: undefined,
    },
  );
  assert.throws(
    () =>
      validateCorpusProxyBody("POST", "/groups/id/approve", {
        identity: { ...identity, conditionState: "graded" },
        reasonCode: "human_verified",
      }),
    /grailscan_corpus_invalid_request/,
  );
});

test("restricts rejection reasons and duplicate targets", () => {
  assert.deepEqual(
    validateCorpusProxyBody("POST", "/groups/id/reject", {
      reasonCode: " poor_quality ",
      notes: " blurred ",
    }),
    { reasonCode: "poor_quality", notes: "blurred" },
  );
  assert.throws(
    () => validateCorpusProxyBody("POST", "/groups/id/reject", { reasonCode: "arbitrary" }),
    /grailscan_corpus_invalid_request/,
  );
  assert.deepEqual(
    validateCorpusProxyBody("POST", "/groups/id/mark-duplicate", {
      duplicateOfGroupId: "11111111-1111-4111-8111-111111111111",
    }),
    {
      duplicateOfGroupId: "11111111-1111-4111-8111-111111111111",
      reasonCode: "exact_duplicate",
    },
  );
});

test("validates semantic corpus versions and immutable member additions", () => {
  assert.deepEqual(
    validateCorpusProxyBody("POST", "/versions", {
      versionName: " 1.2.0-rc.1 ",
      parentVersionId: "11111111-1111-4111-8111-111111111111",
    }),
    {
      versionName: "1.2.0-rc.1",
      parentVersionId: "11111111-1111-4111-8111-111111111111",
    },
  );
  assert.deepEqual(
    validateCorpusProxyBody("POST", "/versions/id/members", {
      imageId: "22222222-2222-4222-8222-222222222222",
    }),
    { imageId: "22222222-2222-4222-8222-222222222222" },
  );
  assert.throws(
    () => validateCorpusProxyBody("POST", "/versions", { versionName: "release-next" }),
    /grailscan_corpus_invalid_request/,
  );
  assert.throws(
    () =>
      validateCorpusProxyBody("POST", "/versions/id/members", {
        imageId: "not-a-uuid",
        privateField: true,
      }),
    /grailscan_corpus_invalid_request/,
  );
});

test("accepts safe version envelopes and rejects manifest storage references", () => {
  assertExpectedCorpusResponse("/versions", { versions: [] });
  assertExpectedCorpusResponse("/versions/11111111-1111-4111-8111-111111111111", {
    version: { id: "11111111-1111-4111-8111-111111111111" },
    members: [],
  });
  assert.throws(
    () =>
      assertExpectedCorpusResponse("/versions", {
        versions: [{ manifestBlobKey: "manifests/private.json" }],
      }),
    /grailscan_corpus_forbidden_upstream_field/,
  );
});

test("enforces recorded-only regression requests", () => {
  assert.deepEqual(
    validateCorpusProxyBody("POST", "/regression-runs", {
      versionId: "11111111-1111-4111-8111-111111111111",
      priorRunId: "22222222-2222-4222-8222-222222222222",
    }),
    {
      versionId: "11111111-1111-4111-8111-111111111111",
      priorRunId: "22222222-2222-4222-8222-222222222222",
      evidenceMode: "recorded",
    },
  );
  assert.throws(
    () =>
      validateCorpusProxyBody("POST", "/regression-runs", {
        versionId: "11111111-1111-4111-8111-111111111111",
        evidenceMode: "live",
      }),
    /grailscan_corpus_invalid_request/,
  );
});

test("validates coverage and regression response envelopes", () => {
  assertExpectedCorpusResponse("/coverage", { targetImages: 500, byCategory: {} });
  assertExpectedCorpusResponse("/regression-runs", { runs: [] });
  assertExpectedCorpusResponse("/regression-runs/11111111-1111-4111-8111-111111111111", {
    run: {},
  });
  assertExpectedCorpusResponse("/regression-runs/11111111-1111-4111-8111-111111111111/failures", {
    results: [],
  });
  assert.throws(
    () => assertExpectedCorpusResponse("/coverage", { approved: 10 }),
    /grailscan_corpus_invalid_upstream_response/,
  );
});

test("validates operational envelopes and blocks storage or audit secrets", () => {
  assertExpectedCorpusResponse("/health", { status: "Healthy", components: {}, counts: {} });
  assertExpectedCorpusResponse("/storage", {
    images: [],
    recordedBundles: {},
    manifests: {},
  });
  assertExpectedCorpusResponse("/audit", { items: [], nextCursor: null });
  assert.throws(
    () =>
      assertExpectedCorpusResponse("/storage", {
        images: [],
        recordedBundles: {},
        manifests: { manifestBlobKey: "private/key" },
      }),
    /grailscan_corpus_forbidden_upstream_field/,
  );
  assert.throws(
    () =>
      assertExpectedCorpusResponse("/audit", { items: [{ apiKey: "secret" }], nextCursor: null }),
    /grailscan_corpus_invalid_upstream_response|grailscan_corpus_forbidden_upstream_field/,
  );
});

test("accepts browser-safe review detail and history envelopes", () => {
  assertExpectedCorpusResponse("/groups/id", {
    group: { id: "group" },
    images: [],
    stages: [],
    quality: [],
    analyses: [],
    candidates: [],
  });
  assertExpectedCorpusResponse("/groups/id/review-history", { history: [] });
  assert.throws(
    () =>
      assertExpectedCorpusResponse("/groups/id", {
        group: { id: "group" },
        images: [{ previewBlobKey: "private" }],
      }),
    /grailscan_corpus_forbidden_upstream_field/,
  );
});
