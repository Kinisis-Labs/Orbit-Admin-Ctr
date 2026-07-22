export interface DatasetArtifactPaths {
  root: string;
  manifest: string;
  validationReport: string;
  checksums: string;
  success: string;
}

export function datasetArtifactPaths(prefix: string, version: string): DatasetArtifactPaths {
  const root = `${prefix.replace(/\/+$/g, "")}/${version}`;
  return {
    root,
    manifest: `${root}/manifest.json`,
    validationReport: `${root}/validation-report.json`,
    checksums: `${root}/checksums.json`,
    success: `${root}/_SUCCESS`,
  };
}
