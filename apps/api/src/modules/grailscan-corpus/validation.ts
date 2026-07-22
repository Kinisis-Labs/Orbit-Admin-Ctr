const FORBIDDEN_RESPONSE_KEYS = new Set([
  "certificateEncrypted",
  "certificateComparisonToken",
  "originalBlobKey",
  "derivativeBlobKey",
  "thumbnailBlobKey",
  "previewBlobKey",
  "manifestBlobKey",
  "assignedBlobKey",
  "canonicalManifestBytes",
  "accessToken",
  "refreshToken",
  "idToken",
  "apiKey",
  "api_key",
  "secret",
  "password",
  "signedUrl",
  "signed_url",
  "sas",
]);

const IMAGE_SIDES = new Set(["front", "back", "angle", "slab_label", "other"]);
const CONTENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

function objectBody(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("grailscan_corpus_invalid_request");
  }
  return value as Record<string, unknown>;
}

function assertAllowedKeys(body: Record<string, unknown>, keys: readonly string[]): void {
  if (Object.keys(body).some((key) => !keys.includes(key))) {
    throw new Error("grailscan_corpus_invalid_request");
  }
}

function requiredString(value: unknown, maximum: number): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.trim().length > maximum) {
    throw new Error("grailscan_corpus_invalid_request");
  }
  return value.trim();
}

function optionalString(value: unknown, maximum: number): string | undefined {
  return value === undefined ? undefined : requiredString(value, maximum);
}

function uuidString(value: unknown): string {
  const parsed = requiredString(value, 36);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(parsed)) {
    throw new Error("grailscan_corpus_invalid_request");
  }
  return parsed;
}

function imageSides(value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > 10 ||
    value.some((side) => typeof side !== "string" || !IMAGE_SIDES.has(side))
  ) {
    throw new Error("grailscan_corpus_invalid_request");
  }
  return value as string[];
}

export function validateCorpusProxyBody(method: string, path: string, value: unknown): unknown {
  const body = objectBody(value);
  if (method === "POST" && path === "/submissions") {
    assertAllowedKeys(body, [
      "displayName",
      "sourceType",
      "sourceOrgId",
      "sourceOrgNameSnapshot",
      "sourceOrgReferenceType",
      "notes",
      "clientContext",
    ]);
    return {
      displayName: requiredString(body.displayName, 200),
      sourceType: requiredString(body.sourceType, 64),
      sourceOrgId: optionalString(body.sourceOrgId, 200),
      sourceOrgNameSnapshot: optionalString(body.sourceOrgNameSnapshot, 200),
      sourceOrgReferenceType: optionalString(body.sourceOrgReferenceType, 64),
      notes: optionalString(body.notes, 4000),
      ...(body.clientContext === undefined
        ? {}
        : { clientContext: objectBody(body.clientContext) }),
    };
  }
  if (method === "POST" && /\/submissions\/[^/]+\/groups$/.test(path)) {
    assertAllowedKeys(body, ["expectedSides", "workingLabel"]);
    return {
      expectedSides: imageSides(body.expectedSides ?? ["front"]),
      workingLabel: optionalString(body.workingLabel, 200),
    };
  }
  if (method === "PATCH" && /\/groups\/[^/]+$/.test(path)) {
    assertAllowedKeys(body, ["version", "workingLabel", "expectedSides"]);
    if (!Number.isInteger(body.version) || Number(body.version) < 1) {
      throw new Error("grailscan_corpus_invalid_request");
    }
    if (body.workingLabel === undefined && body.expectedSides === undefined) {
      throw new Error("grailscan_corpus_invalid_request");
    }
    return {
      version: body.version,
      ...(body.workingLabel === undefined
        ? {}
        : {
            workingLabel:
              body.workingLabel === null ? null : requiredString(body.workingLabel, 200),
          }),
      ...(body.expectedSides === undefined
        ? {}
        : { expectedSides: imageSides(body.expectedSides) }),
    };
  }
  if (method === "POST" && path.endsWith("/images/upload-authorizations")) {
    assertAllowedKeys(body, ["side", "fileName", "contentType", "maximumByteSize"]);
    if (typeof body.side !== "string" || !IMAGE_SIDES.has(body.side)) {
      throw new Error("grailscan_corpus_invalid_request");
    }
    if (typeof body.contentType !== "string" || !CONTENT_TYPES.has(body.contentType)) {
      throw new Error("grailscan_corpus_invalid_request");
    }
    if (
      body.maximumByteSize !== undefined &&
      (!Number.isInteger(body.maximumByteSize) || Number(body.maximumByteSize) < 1)
    ) {
      throw new Error("grailscan_corpus_invalid_request");
    }
    return {
      side: body.side,
      fileName: requiredString(body.fileName, 255),
      contentType: body.contentType,
      ...(body.maximumByteSize === undefined ? {} : { maximumByteSize: body.maximumByteSize }),
    };
  }
  if (method === "POST" && /\/images\/[^/]+\/complete$/.test(path)) {
    assertAllowedKeys(body, ["authorizationId", "etag"]);
    return {
      authorizationId: requiredString(body.authorizationId, 36),
      etag: optionalString(body.etag, 256),
    };
  }
  if (method === "PUT" && /\/groups\/[^/]+\/rights$/.test(path)) {
    const keys = [
      "ownerName",
      "basis",
      "reference",
      "consentVersion",
      "consentedAt",
      "retentionAllowed",
      "internalEvaluationAllowed",
      "regressionAllowed",
      "productImprovementAllowed",
      "modelTrainingAllowed",
      "documentationAllowed",
      "revocable",
    ];
    assertAllowedKeys(body, keys);
    const booleanKeys = keys.slice(5);
    if (booleanKeys.some((key) => typeof body[key] !== "boolean")) {
      throw new Error("grailscan_corpus_invalid_request");
    }
    const consentedAt = requiredString(body.consentedAt, 40);
    if (Number.isNaN(Date.parse(consentedAt))) throw new Error("grailscan_corpus_invalid_request");
    return {
      ownerName: requiredString(body.ownerName, 200),
      basis: requiredString(body.basis, 100),
      reference: optionalString(body.reference, 500),
      consentVersion: requiredString(body.consentVersion, 50),
      consentedAt,
      retentionAllowed: body.retentionAllowed,
      internalEvaluationAllowed: body.internalEvaluationAllowed,
      regressionAllowed: body.regressionAllowed,
      productImprovementAllowed: body.productImprovementAllowed,
      modelTrainingAllowed: body.modelTrainingAllowed,
      documentationAllowed: body.documentationAllowed,
      revocable: body.revocable,
    };
  }
  if (method === "POST" && /\/groups\/[^/]+\/(approve|correct-and-approve)$/.test(path)) {
    assertAllowedKeys(body, ["identity", "reasonCode", "notes"]);
    const identity = objectBody(body.identity);
    assertAllowedKeys(identity, [
      "canonicalCardId",
      "canonicalCollectibleId",
      "canonicalKey",
      "category",
      "franchise",
      "collectibleName",
      "setCode",
      "setName",
      "collectorNumber",
      "language",
      "variant",
      "edition",
      "conditionState",
      "gradingCompany",
      "grade",
      "certificateNumber",
      "attributes",
    ]);
    const conditionState = requiredString(identity.conditionState, 20);
    if (!new Set(["raw", "graded"]).has(conditionState)) {
      throw new Error("grailscan_corpus_invalid_request");
    }
    if (conditionState === "graded" && (!identity.gradingCompany || !identity.grade)) {
      throw new Error("grailscan_corpus_invalid_request");
    }
    return {
      identity: {
        canonicalCardId: optionalString(identity.canonicalCardId, 36),
        canonicalCollectibleId: optionalString(identity.canonicalCollectibleId, 36),
        canonicalKey: requiredString(identity.canonicalKey, 1000),
        category: requiredString(identity.category, 64),
        franchise: requiredString(identity.franchise, 200),
        collectibleName: requiredString(identity.collectibleName, 300),
        setCode: optionalString(identity.setCode, 100),
        setName: requiredString(identity.setName, 300),
        collectorNumber: optionalString(identity.collectorNumber, 100),
        language: requiredString(identity.language, 20),
        variant: optionalString(identity.variant, 200),
        edition: optionalString(identity.edition, 200),
        conditionState,
        gradingCompany: optionalString(identity.gradingCompany, 100),
        grade: optionalString(identity.grade, 50),
        certificateNumber: optionalString(identity.certificateNumber, 200),
        ...(identity.attributes === undefined
          ? {}
          : { attributes: objectBody(identity.attributes) }),
      },
      reasonCode: requiredString(body.reasonCode, 100),
      notes: optionalString(body.notes, 4000),
    };
  }
  if (method === "POST" && /\/groups\/[^/]+\/reject$/.test(path)) {
    assertAllowedKeys(body, ["reasonCode", "notes"]);
    const reasonCode = requiredString(body.reasonCode, 100);
    if (
      !new Set([
        "wrong_subject",
        "poor_quality",
        "duplicate",
        "rights_missing",
        "identity_unverifiable",
        "unsupported",
        "other",
      ]).has(reasonCode)
    ) {
      throw new Error("grailscan_corpus_invalid_request");
    }
    return { reasonCode, notes: optionalString(body.notes, 4000) };
  }
  if (method === "POST" && /\/groups\/[^/]+\/mark-duplicate$/.test(path)) {
    assertAllowedKeys(body, ["duplicateOfGroupId", "reasonCode"]);
    return {
      duplicateOfGroupId: uuidString(body.duplicateOfGroupId),
      reasonCode: requiredString(body.reasonCode ?? "exact_duplicate", 100),
    };
  }
  if (method === "POST" && path === "/versions") {
    assertAllowedKeys(body, ["versionName", "parentVersionId"]);
    const versionName = requiredString(body.versionName, 100);
    if (!/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/i.test(versionName)) {
      throw new Error("grailscan_corpus_invalid_request");
    }
    return {
      versionName,
      ...(body.parentVersionId === undefined
        ? {}
        : { parentVersionId: uuidString(body.parentVersionId) }),
    };
  }
  if (method === "POST" && /\/versions\/[^/]+\/members$/.test(path)) {
    assertAllowedKeys(body, ["imageId"]);
    return { imageId: uuidString(body.imageId) };
  }
  if (method === "POST" && path === "/regression-runs") {
    assertAllowedKeys(body, ["versionId", "priorRunId", "evidenceMode"]);
    if (body.evidenceMode !== undefined && body.evidenceMode !== "recorded") {
      throw new Error("grailscan_corpus_invalid_request");
    }
    return {
      versionId: uuidString(body.versionId),
      ...(body.priorRunId === undefined ? {} : { priorRunId: uuidString(body.priorRunId) }),
      evidenceMode: "recorded",
    };
  }
  assertAllowedKeys(body, []);
  return {};
}

export function assertBrowserSafeCorpusResponse(value: unknown, allowUploadSecrets = false): void {
  const visit = (candidate: unknown): void => {
    if (Array.isArray(candidate)) {
      for (const item of candidate) visit(item);
      return;
    }
    if (!candidate || typeof candidate !== "object") return;
    for (const [key, child] of Object.entries(candidate as Record<string, unknown>)) {
      if (FORBIDDEN_RESPONSE_KEYS.has(key)) {
        throw new Error("grailscan_corpus_forbidden_upstream_field");
      }
      if (!allowUploadSecrets && (key === "uploadUrl" || key === "blobKey")) {
        throw new Error("grailscan_corpus_forbidden_upstream_field");
      }
      visit(child);
    }
  };
  visit(value);
}

export function assertExpectedCorpusResponse(path: string, value: unknown): void {
  if (!value || typeof value !== "object") {
    throw new Error("grailscan_corpus_invalid_upstream_response");
  }
  const body = value as Record<string, unknown>;
  const allowUploadSecrets = path.endsWith("/images/upload-authorizations");
  assertBrowserSafeCorpusResponse(value, allowUploadSecrets);
  if (path === "/overview" && !("metrics" in body && "alerts" in body)) {
    throw new Error("grailscan_corpus_invalid_upstream_response");
  }
  if (path === "/submissions" && !("items" in body || "submission" in body)) {
    throw new Error("grailscan_corpus_invalid_upstream_response");
  }
  if (path.includes("/upload-authorizations") && !("authorization" in body)) {
    throw new Error("grailscan_corpus_invalid_upstream_response");
  }
  if (path === "/versions" && !("versions" in body || "version" in body)) {
    throw new Error("grailscan_corpus_invalid_upstream_response");
  }
  if (/^\/versions\/[^/]+$/.test(path) && !("version" in body && "members" in body)) {
    throw new Error("grailscan_corpus_invalid_upstream_response");
  }
  if (path === "/coverage" && !("targetImages" in body && "byCategory" in body)) {
    throw new Error("grailscan_corpus_invalid_upstream_response");
  }
  if (path === "/regression-runs" && !("runs" in body || "run" in body)) {
    throw new Error("grailscan_corpus_invalid_upstream_response");
  }
  if (/^\/regression-runs\/[^/]+$/.test(path) && !("run" in body)) {
    throw new Error("grailscan_corpus_invalid_upstream_response");
  }
  if (/^\/regression-runs\/[^/]+\/(results|failures)$/.test(path) && !("results" in body)) {
    throw new Error("grailscan_corpus_invalid_upstream_response");
  }
  if (path === "/health" && !("status" in body && "components" in body && "counts" in body)) {
    throw new Error("grailscan_corpus_invalid_upstream_response");
  }
  if (
    path === "/storage" &&
    !("images" in body && "recordedBundles" in body && "manifests" in body)
  ) {
    throw new Error("grailscan_corpus_invalid_upstream_response");
  }
  if (path === "/audit" && !("items" in body && "nextCursor" in body)) {
    throw new Error("grailscan_corpus_invalid_upstream_response");
  }
}
