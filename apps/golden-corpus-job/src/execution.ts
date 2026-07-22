import { datasetArtifactPaths } from "./blobPaths.js";
import { datasetVersion } from "./datasetVersion.js";
import { deterministicCreatedTimestamp, deterministicExecutionId, buildManifest } from "./manifest.js";
import { canonicalJson } from "./hashing.js";
import { ArtifactAlreadyExistsError } from "./storage.js";
import { validateRecords } from "./validation.js";
import type { JobConfig } from "./config.js";
import type { Logger } from "./logger.js";
import type { BlobArtifactWriter, ExecutionRepository, ExecutionStatus } from "./types.js";

export async function executeDatasetBuild(input: {
  config: JobConfig;
  repository: ExecutionRepository;
  storage: BlobArtifactWriter;
  logger: Logger;
  now?: () => Date;
}): Promise<{ status: ExecutionStatus; datasetVersion: string | null; manifestHash: string }> {
  const startedAt = (input.now ?? (() => new Date()))();
  const records = await input.repository.fetchApprovedRecords(input.config.maxRecords);
  const validation = validateRecords(records);
  const executionId = deterministicExecutionId(validation);
  const createdTimestamp = deterministicCreatedTimestamp(records);
  const preliminary = buildManifest({ datasetName: input.config.datasetName, approvedCount: records.length, executionId, createdTimestamp, datasetVersion: null, validation });
  const version = datasetVersion(records.map((record) => record.approvedAt).filter((value): value is string | Date => Boolean(value)), preliminary.manifest.manifestHash);
  const built = buildManifest({ datasetName: input.config.datasetName, approvedCount: records.length, executionId, createdTimestamp, datasetVersion: version, validation });
  const elapsed = () => (input.now ?? (() => new Date()))().getTime() - startedAt.getTime();
  const paths = datasetArtifactPaths(input.config.artifactPrefix, version);
  const base = { executionId, datasetVersion: version, manifestHash: built.manifest.manifestHash, acceptedCount: validation.accepted.length, rejectedCount: validation.rejected.length };
  await input.repository.startExecution({ ...base, startedAt, completedAt: null, durationMs: null, status: "RUNNING", dryRun: input.config.dryRun, artifactLocation: input.config.dryRun ? null : paths.root, safeErrorCode: null });

  try {
    if (input.config.dryRun) {
      await input.repository.finishExecution({ ...base, completedAt: (input.now ?? (() => new Date()))(), durationMs: elapsed(), status: "DRY_RUN", artifactLocation: null, safeErrorCode: null });
      input.logger.info("golden_corpus_job_completed", { ...base, status: "DRY_RUN", dryRun: true, manifestHashPrefix: built.manifest.manifestHash.slice(0, 8), durationMs: elapsed() });
      return { status: "DRY_RUN", datasetVersion: null, manifestHash: built.manifest.manifestHash };
    }
    const existing = await input.storage.readManifest(paths.manifest);
    if (existing) {
      if (existing.manifestHash !== built.manifest.manifestHash) throw new Error("golden_corpus_job_dataset_version_collision");
      await input.repository.finishExecution({ ...base, completedAt: (input.now ?? (() => new Date()))(), durationMs: elapsed(), status: "ALREADY_BUILT", artifactLocation: paths.root, safeErrorCode: null });
      return { status: "ALREADY_BUILT", datasetVersion: version, manifestHash: built.manifest.manifestHash };
    }
    await input.storage.writeImmutable(paths.validationReport, canonicalJson(built.validationReport), "application/json");
    await input.storage.writeImmutable(paths.checksums, canonicalJson(built.checksums), "application/json");
    try {
      await input.storage.writeImmutable(paths.manifest, canonicalJson(built.manifest), "application/json");
    } catch (error) {
      if (!(error instanceof ArtifactAlreadyExistsError)) throw error;
      const raced = await input.storage.readManifest(paths.manifest);
      if (!raced || raced.manifestHash !== built.manifest.manifestHash) throw new Error("golden_corpus_job_dataset_version_collision");
    }
    await input.storage.writeImmutable(paths.success, `${built.manifest.manifestHash}\n`, "text/plain");
    await input.repository.finishExecution({ ...base, completedAt: (input.now ?? (() => new Date()))(), durationMs: elapsed(), status: "SUCCEEDED", artifactLocation: paths.root, safeErrorCode: null });
    input.logger.info("golden_corpus_job_completed", { ...base, status: "SUCCEEDED", dryRun: false, manifestHashPrefix: built.manifest.manifestHash.slice(0, 8), durationMs: elapsed() });
    return { status: "SUCCEEDED", datasetVersion: version, manifestHash: built.manifest.manifestHash };
  } catch (error) {
    const safeErrorCode = error instanceof Error && /^golden_corpus_job_[a-z_]+$/.test(error.message) ? error.message : "golden_corpus_job_failed";
    await input.repository.finishExecution({ ...base, completedAt: (input.now ?? (() => new Date()))(), durationMs: elapsed(), status: "FAILED", artifactLocation: input.config.dryRun ? null : paths.root, safeErrorCode });
    input.logger.error("golden_corpus_job_failed", { ...base, status: "FAILED", safeErrorCode, manifestHashPrefix: built.manifest.manifestHash.slice(0, 8), durationMs: elapsed() });
    throw error;
  }
}
