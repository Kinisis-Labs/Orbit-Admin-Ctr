const developerMode =
  import.meta.env.DEV || import.meta.env.VITE_GB_DATASET_ADMIN_DEVELOPER_MODE === "true";

export const datasetAdminConfiguration = {
  developerMode,
  enabled: developerMode || import.meta.env.VITE_GB_DATASET_ADMIN_ENABLED !== "false",
  referenceDatasets: developerMode || import.meta.env.VITE_GB_REFERENCE_DATASET_ENABLED !== "false",
  goldenCorpus: developerMode || import.meta.env.VITE_GB_GOLDEN_CORPUS_ENABLED !== "false",
  providerCardHedge:
    developerMode || import.meta.env.VITE_GB_CARDHEDGE_PROVIDER_ENABLED !== "false",
  publication: developerMode || import.meta.env.VITE_GB_DATASET_PUBLICATION_ENABLED !== "false",
  registry: developerMode || import.meta.env.VITE_GB_DATASET_REGISTRY_ENABLED !== "false",
  versioning: developerMode || import.meta.env.VITE_GB_DATASET_VERSIONING_ENABLED !== "false",
  referenceImageStorage:
    developerMode || import.meta.env.VITE_GB_REFERENCE_IMAGE_STORAGE_ENABLED !== "false",
  referenceImageDownload:
    developerMode || import.meta.env.VITE_GB_REFERENCE_IMAGE_DOWNLOAD_ENABLED !== "false",
  provenance: developerMode || import.meta.env.VITE_GB_REFERENCE_PROVENANCE_ENABLED !== "false",
  synchronization: developerMode || import.meta.env.VITE_GB_REFERENCE_SYNC_ENABLED !== "false",
  synchronizationScheduler:
    developerMode || import.meta.env.VITE_GB_REFERENCE_SYNC_SCHEDULER_ENABLED !== "false",
  synchronizationWorker:
    developerMode || import.meta.env.VITE_GB_REFERENCE_SYNC_WORKER_ENABLED !== "false",
  regression: developerMode || import.meta.env.VITE_GB_REGRESSION_ENABLED !== "false",
  regressionDatasets:
    developerMode || import.meta.env.VITE_GB_REGRESSION_DATASETS_ENABLED !== "false",
  coverage: developerMode || import.meta.env.VITE_GB_COVERAGE_ENABLED !== "false",
  reviewQueue: developerMode || import.meta.env.VITE_GB_REVIEW_QUEUE_ENABLED !== "false",
  approvedPool: developerMode || import.meta.env.VITE_GB_APPROVED_POOL_ENABLED !== "false",
  health: developerMode || import.meta.env.VITE_GB_HEALTH_MONITORING_ENABLED !== "false",
  audit: developerMode || import.meta.env.VITE_GB_AUDIT_ENABLED !== "false",
  submissions: developerMode || import.meta.env.VITE_GB_SUBMISSIONS_ENABLED !== "false",
} as const;
