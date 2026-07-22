import assert from "node:assert/strict";
import test from "node:test";
import { executeDatasetBuild } from "../src/execution.js";
import type { JobConfig } from "../src/config.js";
import type {
  BlobArtifactWriter,
  DatasetManifest,
  ExecutionRepository,
  ExecutionRow,
  GoldenCorpusRecord,
} from "../src/types.js";

const config: JobConfig = {
  jobName: "golden-corpus-build",
  datasetName: "grailscan-golden-corpus",
  storageAccount: "account",
  container: "container",
  artifactPrefix: "golden-corpus/datasets",
  databaseUrl: "postgres://example",
  logLevel: "error",
  dryRun: false,
  maxRecords: null,
};

const records: GoldenCorpusRecord[] = [
  {
    immutableRecordId: "1",
    captureGroupId: "group-1",
    category: "tcg",
    productType: "trading_card",
    canonicalIdentity: "pokemon:base:4",
    status: "approved",
    uploaderActorId: "uploader",
    reviewerActorId: "reviewer",
    approvedAt: "2026-07-22T12:00:00.000Z",
    frontImageId: "1",
    blobPath: "images/1.jpg",
    blobChecksum: "a".repeat(64),
    blobEtag: "etag",
    processingState: "completed",
    duplicateState: "cleared",
    purgeState: "not_requested",
  },
];

class FakeRepository implements ExecutionRepository {
  readonly started: ExecutionRow[] = [];
  readonly finished: Parameters<ExecutionRepository["finishExecution"]>[0][] = [];
  constructor(private readonly source = records, private readonly failStart = false) {}
  async fetchApprovedRecords(): Promise<GoldenCorpusRecord[]> { return this.source; }
  async startExecution(row: ExecutionRow): Promise<void> { if (this.failStart) throw new Error("database unavailable"); this.started.push(row); }
  async finishExecution(input: Parameters<ExecutionRepository["finishExecution"]>[0]): Promise<void> { this.finished.push(input); }
  async close(): Promise<void> {}
}

class FakeStorage implements BlobArtifactWriter {
  readonly writes = new Map<string, string>();
  existing: DatasetManifest | null = null;
  failWrites = false;
  async readManifest(): Promise<DatasetManifest | null> { return this.existing; }
  async writeImmutable(path: string, contents: string): Promise<void> { if (this.failWrites) throw new Error("storage unavailable"); this.writes.set(path, contents); }
}

const logger = { debug() {}, info() {}, warn() {}, error() {} };

test("dry run records a manifest result without Blob writes or dataset version", async () => {
  const repository = new FakeRepository();
  const storage = new FakeStorage();
  const result = await executeDatasetBuild({ config: { ...config, dryRun: true }, repository, storage, logger });
  assert.equal(result.status, "DRY_RUN");
  assert.equal(result.datasetVersion, null);
  assert.equal(storage.writes.size, 0);
  assert.equal(repository.finished[0]!.status, "DRY_RUN");
});

test("successful execution writes immutable artifacts and success marker", async () => {
  const repository = new FakeRepository();
  const storage = new FakeStorage();
  const result = await executeDatasetBuild({ config, repository, storage, logger });
  assert.equal(result.status, "SUCCEEDED");
  assert.equal(storage.writes.size, 4);
  assert.ok([...storage.writes.keys()].some((path) => path.endsWith("/_SUCCESS")));
  assert.equal(repository.finished[0]!.status, "SUCCEEDED");
});

test("identical existing manifest is treated as already built", async () => {
  const firstRepository = new FakeRepository();
  const firstStorage = new FakeStorage();
  await executeDatasetBuild({ config, repository: firstRepository, storage: firstStorage, logger });
  const existing = JSON.parse([...firstStorage.writes.entries()].find(([path]) => path.endsWith("manifest.json"))![1]) as DatasetManifest;
  const repository = new FakeRepository();
  const storage = new FakeStorage();
  storage.existing = existing;
  const result = await executeDatasetBuild({ config, repository, storage, logger });
  assert.equal(result.status, "ALREADY_BUILT");
  assert.equal(storage.writes.size, 0);
});

test("different existing manifest fails dataset-version collision", async () => {
  const repository = new FakeRepository();
  const storage = new FakeStorage();
  storage.existing = { manifestHash: "different" } as DatasetManifest;
  await assert.rejects(() => executeDatasetBuild({ config, repository, storage, logger }), /dataset_version_collision/);
  assert.equal(repository.finished[0]!.status, "FAILED");
});

test("storage and database failures record or surface safe failure", async () => {
  const storageRepository = new FakeRepository();
  const storage = new FakeStorage();
  storage.failWrites = true;
  await assert.rejects(() => executeDatasetBuild({ config, repository: storageRepository, storage, logger }));
  assert.equal(storageRepository.finished[0]!.status, "FAILED");
  await assert.rejects(() => executeDatasetBuild({ config, repository: new FakeRepository(records, true), storage: new FakeStorage(), logger }));
});
