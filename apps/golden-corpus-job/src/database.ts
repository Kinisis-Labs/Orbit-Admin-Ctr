import { DefaultAzureCredential } from "@azure/identity";
import pg from "pg";
import type { ExecutionRepository, ExecutionRow, GoldenCorpusRecord } from "./types.js";

const { Pool } = pg;
const POSTGRES_ENTRA_SCOPE = "https://ossrdbms-aad.database.windows.net/.default";

export class PostgresExecutionRepository implements ExecutionRepository {
  private readonly pool: pg.Pool;

  constructor(databaseUrl: string) {
    const endpoint = new URL(databaseUrl);
    if (endpoint.password) throw new Error("golden_corpus_job_database_password_forbidden");
    const credential = new DefaultAzureCredential({
      managedIdentityClientId: process.env.AZURE_CLIENT_ID,
    });
    this.pool = new Pool({
      host: endpoint.hostname,
      port: endpoint.port ? Number(endpoint.port) : 5432,
      database: endpoint.pathname.replace(/^\//, ""),
      user: decodeURIComponent(endpoint.username),
      password: async () => {
        const token = await credential.getToken(POSTGRES_ENTRA_SCOPE);
        if (!token) throw new Error("golden_corpus_job_postgres_entra_token_unavailable");
        return token.token;
      },
      ssl:
        process.env.GB_GOLDEN_CORPUS_DATABASE_SSL === "false"
          ? false
          : { rejectUnauthorized: true },
    });
  }

  async fetchApprovedRecords(maxRecords: number | null): Promise<GoldenCorpusRecord[]> {
    const result = await this.pool.query<GoldenCorpusRecord>(
      `SELECT image.id AS "immutableRecordId", group_row.id AS "captureGroupId", identity_row.category AS category,
              COALESCE(identity_row.attributes_json->>'productType', identity_row.attributes_json->>'product_type') AS "productType",
              identity_row.canonical_key AS "canonicalIdentity", group_row.status AS status,
              group_row.uploaded_by_actor_id AS "uploaderActorId", approval.reviewer_actor_id AS "reviewerActorId",
              approval.created_at AS "approvedAt", image.id AS "frontImageId", image.original_blob_key AS "blobPath",
              image.original_sha256 AS "blobChecksum", image.blob_etag AS "blobEtag", image.processing_state AS "processingState",
              image.duplicate_state AS "duplicateState", image.purge_state AS "purgeState"
         FROM golden_corpus_capture_group group_row
         JOIN golden_corpus_verified_identity identity_row ON identity_row.group_id = group_row.id AND identity_row.is_current = true
         JOIN golden_corpus_image image ON image.group_id = group_row.id AND image.side = 'front'
         LEFT JOIN LATERAL (
           SELECT reviewer_actor_id, created_at FROM golden_corpus_review
            WHERE group_id = group_row.id AND action = 'approved' AND after_status = 'approved'
            ORDER BY created_at DESC, id DESC LIMIT 1
         ) approval ON true
        WHERE group_row.status = 'approved'
        ORDER BY group_row.id, image.id
        LIMIT COALESCE($1, 2147483647)`,
      [maxRecords],
    );
    return result.rows;
  }

  async startExecution(row: ExecutionRow): Promise<void> {
    await this.pool.query(
      `INSERT INTO golden_corpus_job_execution
       (execution_id, dataset_version, manifest_hash, started_at, accepted_count, rejected_count, status, dry_run, artifact_location)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (execution_id) DO NOTHING`,
      [row.executionId, row.datasetVersion, row.manifestHash, row.startedAt, row.acceptedCount, row.rejectedCount, row.status, row.dryRun, row.artifactLocation],
    );
  }

  async finishExecution(input: Parameters<ExecutionRepository["finishExecution"]>[0]): Promise<void> {
    await this.pool.query(
      `UPDATE golden_corpus_job_execution
          SET dataset_version=$2, manifest_hash=$3, completed_at=$4, duration_ms=$5, accepted_count=$6,
              rejected_count=$7, status=$8, artifact_location=$9, safe_error_code=$10
        WHERE execution_id=$1`,
      [input.executionId, input.datasetVersion, input.manifestHash, input.completedAt, input.durationMs, input.acceptedCount, input.rejectedCount, input.status, input.artifactLocation, input.safeErrorCode],
    );
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
