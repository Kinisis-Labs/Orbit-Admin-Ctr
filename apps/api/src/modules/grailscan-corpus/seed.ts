import { permissionsTable } from "@workspace/db";
import { db } from "../../lib/db.js";
import { ORBIT_CORPUS_PERMISSIONS } from "./permissions.js";

const LABELS: Record<(typeof ORBIT_CORPUS_PERMISSIONS)[number], string> = {
  "grailscan.corpus.view": "View Golden Corpus",
  "grailscan.corpus.upload": "Upload Golden Corpus Assets",
  "grailscan.corpus.review": "Review Golden Corpus Captures",
  "grailscan.corpus.approve": "Approve Golden Corpus Captures",
  "grailscan.corpus.manage_rights": "Manage Golden Corpus Rights",
  "grailscan.corpus.manage_versions": "Manage Golden Corpus Versions",
  "grailscan.corpus.run_regression": "Run Golden Corpus Regression",
  "grailscan.corpus.view_health": "View Golden Corpus Health",
  "grailscan.corpus.view_storage": "View Golden Corpus Storage",
  "grailscan.corpus.purge": "Manage Golden Corpus Purges",
  "grailscan.corpus.reference.view": "View Reference Datasets",
  "grailscan.corpus.reference.manage": "Manage Reference Dataset Sync",
  "grailscan.corpus.reference.publish": "Publish Reference Dataset Versions",
  "grailscan.corpus.reference.retry": "Retry Reference Dataset Failures",
  "grailscan.corpus.admin": "Administer Golden Corpus",
};

export async function ensureGrailScanCorpusPermissions(): Promise<void> {
  for (const name of ORBIT_CORPUS_PERMISSIONS) {
    const action = name.slice("grailscan.corpus.".length);
    await db
      .insert(permissionsTable)
      .values({
        name,
        displayName: LABELS[name],
        description: `Controls ${LABELS[name].toLowerCase()} in Orbit.`,
        application: "grailscan",
        module: "corpus",
        action,
        enabled: true,
        createdBy: "system:grailscan-corpus",
      })
      .onConflictDoNothing({ target: permissionsTable.name });
  }
}
