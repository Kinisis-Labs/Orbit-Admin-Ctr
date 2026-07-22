import { readConfig } from "./config.js";
import { PostgresExecutionRepository } from "./database.js";
import { executeDatasetBuild } from "./execution.js";
import { createLogger } from "./logger.js";
import { AzureBlobArtifactWriter } from "./storage.js";

function safeErrorCode(error: unknown): string {
  if (error instanceof Error && /^golden_corpus_job_[a-z_]+$/.test(error.message)) {
    return error.message;
  }
  const postgresCode =
    typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
      ? error.code
      : null;
  if (postgresCode === "28P01") return "postgres_authentication_failed";
  if (postgresCode === "42501") return "postgres_permission_denied";
  if (postgresCode === "42P01") return "postgres_relation_missing";
  if (["08000", "08001", "08003", "08004", "08006"].includes(postgresCode ?? "")) {
    return "postgres_connection_failed";
  }
  return "golden_corpus_job_failed";
}

async function main(): Promise<void> {
  const config = readConfig();
  const logger = createLogger(config.logLevel);
  const repository = new PostgresExecutionRepository(config.databaseUrl);
  try {
    await executeDatasetBuild({
      config,
      repository,
      storage: new AzureBlobArtifactWriter(config.storageAccount, config.container),
      logger,
    });
  } finally {
    await repository.close();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${JSON.stringify({
      level: "error",
      event: "golden_corpus_job_exit",
      safeErrorCode: safeErrorCode(error),
    })}\n`,
  );
  process.exitCode = 1;
});
