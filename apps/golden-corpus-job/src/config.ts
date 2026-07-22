export interface JobConfig {
  jobName: string;
  datasetName: string;
  storageAccount: string;
  container: string;
  artifactPrefix: string;
  databaseUrl: string;
  logLevel: "debug" | "info" | "warn" | "error";
  dryRun: boolean;
  maxRecords: number | null;
}

function bool(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined || value.trim() === "") return defaultValue;
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  throw new Error("golden_corpus_job_invalid_boolean_config");
}

function positiveInt(value: string | undefined): number | null {
  if (value === undefined || value.trim() === "") return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error("golden_corpus_job_invalid_max_records");
  return parsed;
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): JobConfig {
  const databaseUrl = env.GB_GOLDEN_CORPUS_DATABASE_URL?.trim();
  const storageAccount = env.GB_GOLDEN_CORPUS_STORAGE_ACCOUNT?.trim();
  if (!databaseUrl) throw new Error("golden_corpus_job_database_url_required");
  if (!storageAccount) throw new Error("golden_corpus_job_storage_account_required");
  const logLevel = (env.GB_GOLDEN_CORPUS_LOG_LEVEL?.trim() || "info") as JobConfig["logLevel"];
  if (!["debug", "info", "warn", "error"].includes(logLevel)) throw new Error("golden_corpus_job_invalid_log_level");
  return {
    jobName: env.GB_GOLDEN_CORPUS_JOB_NAME?.trim() || "golden-corpus-build",
    datasetName: env.GB_GOLDEN_CORPUS_DATASET_NAME?.trim() || "grailscan-golden-corpus",
    storageAccount,
    container: env.GB_GOLDEN_CORPUS_CONTAINER?.trim() || "grailscan-golden-corpus",
    artifactPrefix: (env.GB_GOLDEN_CORPUS_ARTIFACT_PREFIX?.trim() || "golden-corpus/datasets").replace(/^\/+|\/+$/g, ""),
    databaseUrl,
    logLevel,
    dryRun: bool(env.GB_GOLDEN_CORPUS_DRY_RUN, true),
    maxRecords: positiveInt(env.GB_GOLDEN_CORPUS_MAX_RECORDS),
  };
}
