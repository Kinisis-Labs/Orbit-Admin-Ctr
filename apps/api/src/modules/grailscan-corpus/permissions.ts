export const ORBIT_CORPUS_PERMISSIONS = [
  "grailscan.corpus.view",
  "grailscan.corpus.upload",
  "grailscan.corpus.review",
  "grailscan.corpus.approve",
  "grailscan.corpus.manage_rights",
  "grailscan.corpus.manage_versions",
  "grailscan.corpus.run_regression",
  "grailscan.corpus.view_health",
  "grailscan.corpus.view_storage",
  "grailscan.corpus.purge",
  "grailscan.corpus.reference.view",
  "grailscan.corpus.reference.manage",
  "grailscan.corpus.reference.publish",
  "grailscan.corpus.reference.retry",
  "grailscan.corpus.admin",
] as const;

export type OrbitCorpusPermission = (typeof ORBIT_CORPUS_PERMISSIONS)[number];
export type GrailBabeCorpusPermission =
  | "grailscan.corpus.read"
  | "grailscan.corpus.upload"
  | "grailscan.corpus.review"
  | "grailscan.corpus.approve"
  | "grailscan.corpus.version"
  | "grailscan.corpus.regression"
  | "grailscan.corpus.audit"
  | "grailscan.corpus.admin"
  | "grailscan.corpus.certificate.read"
  | "grailscan.corpus.purge"
  | "grailscan.corpus.reference.read"
  | "grailscan.corpus.reference.manage"
  | "grailscan.corpus.reference.publish"
  | "grailscan.corpus.reference.retry";

const MAPPING: Record<OrbitCorpusPermission, readonly GrailBabeCorpusPermission[]> = {
  "grailscan.corpus.view": ["grailscan.corpus.read"],
  "grailscan.corpus.upload": ["grailscan.corpus.upload"],
  "grailscan.corpus.review": ["grailscan.corpus.review"],
  "grailscan.corpus.approve": ["grailscan.corpus.approve"],
  "grailscan.corpus.manage_rights": ["grailscan.corpus.review"],
  "grailscan.corpus.manage_versions": ["grailscan.corpus.version"],
  "grailscan.corpus.run_regression": ["grailscan.corpus.regression"],
  "grailscan.corpus.view_health": ["grailscan.corpus.audit"],
  "grailscan.corpus.view_storage": ["grailscan.corpus.audit"],
  "grailscan.corpus.purge": ["grailscan.corpus.purge"],
  "grailscan.corpus.reference.view": ["grailscan.corpus.reference.read"],
  "grailscan.corpus.reference.manage": ["grailscan.corpus.reference.manage"],
  "grailscan.corpus.reference.publish": ["grailscan.corpus.reference.publish"],
  "grailscan.corpus.reference.retry": ["grailscan.corpus.reference.retry"],
  "grailscan.corpus.admin": [
    "grailscan.corpus.read",
    "grailscan.corpus.upload",
    "grailscan.corpus.review",
    "grailscan.corpus.approve",
    "grailscan.corpus.version",
    "grailscan.corpus.regression",
    "grailscan.corpus.audit",
    "grailscan.corpus.admin",
    "grailscan.corpus.certificate.read",
    "grailscan.corpus.purge",
    "grailscan.corpus.reference.read",
    "grailscan.corpus.reference.manage",
    "grailscan.corpus.reference.publish",
    "grailscan.corpus.reference.retry",
  ],
};

export function mapOrbitCorpusPermissions(
  permissions: readonly string[],
): GrailBabeCorpusPermission[] {
  const mapped = new Set<GrailBabeCorpusPermission>();
  for (const permission of ORBIT_CORPUS_PERMISSIONS) {
    if (!permissions.includes(permission)) continue;
    for (const backendPermission of MAPPING[permission]) mapped.add(backendPermission);
  }
  return [...mapped].sort();
}
