CREATE TABLE IF NOT EXISTS golden_corpus_job_execution (
  execution_id text PRIMARY KEY,
  dataset_version text,
  manifest_hash text,
  started_at timestamptz NOT NULL,
  completed_at timestamptz,
  duration_ms integer,
  accepted_count integer NOT NULL DEFAULT 0,
  rejected_count integer NOT NULL DEFAULT 0,
  status text NOT NULL,
  dry_run boolean NOT NULL,
  artifact_location text,
  safe_error_code text,
  CONSTRAINT golden_corpus_job_execution_status_check
    CHECK (status IN ('RUNNING', 'SUCCEEDED', 'FAILED', 'DRY_RUN', 'ALREADY_BUILT'))
);

CREATE INDEX IF NOT EXISTS golden_corpus_job_execution_started_at_idx
  ON golden_corpus_job_execution (started_at DESC);

CREATE INDEX IF NOT EXISTS golden_corpus_job_execution_dataset_version_idx
  ON golden_corpus_job_execution (dataset_version);
