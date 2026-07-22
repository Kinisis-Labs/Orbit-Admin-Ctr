# Golden Corpus Dataset Builder Job

## Purpose

`@workspace/golden-corpus-job` is a one-shot Node.js job for Azure Container Apps Jobs. It builds a deterministic, immutable Golden Corpus dataset from approved GrailBabe capture groups. It does not expose HTTP endpoints and does not train models.

## Architecture

The job reads approved capture groups, their current verified identity, the approval review, and the front image from the GrailBabe PostgreSQL schema. It validates records, orders accepted records by category, product type, canonical identity, and immutable image ID, creates a canonical JSON manifest, hashes that canonical payload with SHA-256, and writes immutable Blob artifacts.

The implementation treats one eligible `front` image as one dataset record. `golden_corpus_image.id` is the immutable record ID and `golden_corpus_capture_group.id` is retained as `captureGroupId`.

`productType` is read from the current verified identity's `attributes_json.productType`, falling back to `attributes_json.product_type`. Records lacking either value are rejected. Dataset inputs must populate one of those keys before a production run.

The source schema is GrailBabe's `golden_corpus_*` schema, not Orbit's operational database schema. Apply `migrations/0001_golden_corpus_job_execution.sql` to the database named by `GB_GOLDEN_CORPUS_DATABASE_URL` before the first non-dry run. The job never executes DDL.

## Environment Variables

| Variable | Required | Default |
| --- | --- | --- |
| `GB_GOLDEN_CORPUS_JOB_NAME` | No | `golden-corpus-build` |
| `GB_GOLDEN_CORPUS_DATASET_NAME` | No | `grailscan-golden-corpus` |
| `GB_GOLDEN_CORPUS_STORAGE_ACCOUNT` | Yes | None |
| `GB_GOLDEN_CORPUS_CONTAINER` | No | `grailscan-golden-corpus` |
| `GB_GOLDEN_CORPUS_ARTIFACT_PREFIX` | No | `golden-corpus/datasets` |
| `GB_GOLDEN_CORPUS_DATABASE_URL` | Yes | None |
| `GB_GOLDEN_CORPUS_LOG_LEVEL` | No | `info` |
| `GB_GOLDEN_CORPUS_DRY_RUN` | No | `true` |
| `GB_GOLDEN_CORPUS_MAX_RECORDS` | No | None |
| `GB_GOLDEN_CORPUS_DATABASE_SSL` | No | `true` |

All secret-backed environment variables use the `GB_` prefix. Required Key Vault secret names are `gb-golden-corpus-database-url`; no storage credential secret is permitted. `GB_GOLDEN_CORPUS_STORAGE_ACCOUNT` is configuration, not a secret.

## Dry Run

`GB_GOLDEN_CORPUS_DRY_RUN=true` reads and validates records, computes the deterministic manifest and SHA-256, and writes an execution row with `DRY_RUN`. It does not write Blob artifacts, generate a persisted dataset version, or create `_SUCCESS`.

## Blob Layout

```text
grailscan-golden-corpus/
  golden-corpus/datasets/
    golden-corpus-YYYYMMDD-<hash-prefix>/
      manifest.json
      validation-report.json
      checksums.json
      _SUCCESS
```

Artifacts use Azure conditional creation (`If-None-Match: *`). Existing matching manifests result in `ALREADY_BUILT`; an existing version with a different hash fails. No artifact contains SAS URLs, keys, tokens, or secrets.

## Local Execution

```bash
source "$HOME/.nvm/nvm.sh" && nvm use 22.23.1
pnpm install
GB_GOLDEN_CORPUS_STORAGE_ACCOUNT=<account> \
GB_GOLDEN_CORPUS_DATABASE_URL=<postgres-url> \
GB_GOLDEN_CORPUS_DRY_RUN=true \
pnpm --filter @workspace/golden-corpus-job build && \
pnpm --filter @workspace/golden-corpus-job start
```

Use an Azure developer identity locally. Production authentication is managed identity only through `DefaultAzureCredential`.

## Docker

Use the repository root as build context:

```bash
az acr build \
  --registry acrsharedplatformprod \
  --image orbit/golden-corpus-job:<tag> \
  --file apps/golden-corpus-job/Dockerfile \
  .
```

Local image execution requires Azure identity and database configuration:

```bash
docker build -f apps/golden-corpus-job/Dockerfile -t golden-corpus-job .
docker run --rm \
  -e GB_GOLDEN_CORPUS_STORAGE_ACCOUNT=<account> \
  -e GB_GOLDEN_CORPUS_DATABASE_URL=<postgres-url> \
  -e GB_GOLDEN_CORPUS_DRY_RUN=true \
  golden-corpus-job
```

## Azure Container Apps Job

Expected resource names are `job-orbit-golden-corpus-prod`, `acrsharedplatformprod`, `cae-sharedplatform-prod`, `id-platformshared-prod`, and `kv-kinisislabs-prod`. This repository does not create or deploy them.

The job must use `id-platformshared-prod`, no ingress, and Key Vault references for `GB_GOLDEN_CORPUS_DATABASE_URL`. The production job definition must set `GB_GOLDEN_CORPUS_DRY_RUN=false` only after a successful dry run review.

## Required RBAC

For `id-platformshared-prod`:

- `AcrPull` on `acrsharedplatformprod`.
- `Storage Blob Data Contributor` on the Golden Corpus storage account or scoped container.
- `Key Vault Secrets User` on `kv-kinisislabs-prod`.
- PostgreSQL database access through a dedicated least-privilege database role with `SELECT` on the source Golden Corpus tables and `INSERT`/`UPDATE` on `golden_corpus_job_execution`.

Azure Machine Learning permissions are not required for this builder. AML should receive read-only access to frozen artifacts through its separate identity when training is added.

## Rollback Guidance

The job never overwrites or deletes an existing dataset artifact. To roll back consumption, point downstream AML configuration at a prior dataset version. Do not delete a published dataset folder. For a failed build, review the safe error code and validation report, correct source records, then rerun; a hash-changing corrected dataset receives a new immutable version.

## Validation Rules

The job rejects missing IDs, category, product type, identity, reviewer, approval time, front image, blob reference, checksum, or ETag. It also rejects self approvals, non-approved state, incomplete processing, exact duplicates, purge/deletion state, duplicate immutable IDs, and checksum-to-identity conflicts.
