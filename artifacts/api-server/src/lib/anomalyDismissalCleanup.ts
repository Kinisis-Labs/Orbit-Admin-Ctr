/**
 * Background cleanup for stale anomaly dismissals.
 *
 * Session cookies expire after 8 hours and anomaly detections only look back
 * 7 days, so any dismissal row older than ~8 days is permanently unreachable.
 * This scheduler deletes rows older than 30 days (a conservative margin) once
 * per day so the `anomaly_dismissals` table stays bounded.
 *
 * Runs unconditionally — no env-var gate needed, safe in dev and prod.
 *
 * Env tuning (optional):
 *   ANOMALY_DISMISSAL_RETENTION_DAYS   — retention window in days (default 30)
 *   ANOMALY_DISMISSAL_CLEANUP_HOURS    — cleanup cadence in hours (default 24)
 */

import { lt, sql } from "drizzle-orm";
import { db, anomalyDismissalsTable } from "@workspace/db";
import { logger } from "./logger.js";

const DEFAULT_RETENTION_DAYS = 30;
const DEFAULT_INTERVAL_HOURS = 24;

function getRetentionDays(): number {
  const raw = process.env.ANOMALY_DISMISSAL_RETENTION_DAYS;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_RETENTION_DAYS;
}

function getIntervalMs(): number {
  const raw = process.env.ANOMALY_DISMISSAL_CLEANUP_HOURS;
  const parsed = raw ? Number(raw) : NaN;
  const hours = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_INTERVAL_HOURS;
  return hours * 60 * 60 * 1000;
}

async function deleteStaleRows(): Promise<void> {
  const retentionDays = getRetentionDays();
  const cutoff = sql`NOW() - INTERVAL '${sql.raw(String(retentionDays))} days'`;

  const result = await db
    .delete(anomalyDismissalsTable)
    .where(lt(anomalyDismissalsTable.dismissedAt, cutoff));

  const deleted = result.rowCount ?? 0;
  if (deleted > 0) {
    logger.info({ deleted, retentionDays }, "Pruned stale anomaly dismissal rows");
  } else {
    logger.debug({ retentionDays }, "Anomaly dismissal cleanup: nothing to prune");
  }
}

export function startAnomalyDismissalCleanup(): void {
  const intervalMs = getIntervalMs();
  const retentionDays = getRetentionDays();

  logger.info(
    { retentionDays, intervalHours: intervalMs / 3_600_000 },
    "Starting anomaly dismissal cleanup scheduler",
  );

  deleteStaleRows().catch((err) => {
    logger.warn({ err }, "Anomaly dismissal initial cleanup failed (non-fatal)");
  });

  setInterval(() => {
    deleteStaleRows().catch((err) => {
      logger.warn({ err }, "Anomaly dismissal cleanup failed (non-fatal)");
    });
  }, intervalMs);
}
