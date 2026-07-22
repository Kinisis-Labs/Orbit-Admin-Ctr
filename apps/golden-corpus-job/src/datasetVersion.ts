import { shortHash } from "./hashing.js";

export function datasetVersion(approvedAt: readonly (string | Date)[], manifestHash: string): string {
  const timestamps = approvedAt
    .map((value) => new Date(value).getTime())
    .filter((value) => Number.isFinite(value));
  const date = timestamps.length === 0 ? new Date(0) : new Date(Math.max(...timestamps));
  const datePart = date.toISOString().slice(0, 10).replaceAll("-", "");
  return `golden-corpus-${datePart}-${shortHash(manifestHash)}`;
}
