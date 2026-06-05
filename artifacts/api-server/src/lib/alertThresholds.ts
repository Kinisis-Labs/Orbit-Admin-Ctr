/**
 * DB-aware infra alert threshold helpers.
 *
 * Priority order for each per-app value:
 *   1. Row in alert_threshold_config (set by operators via the Orbit UI)
 *   2. Per-app env var (e.g. ALERT_CPU_THRESHOLD_PCT__GRAILBABE)
 *   3. Global env var (e.g. ALERT_CPU_THRESHOLD_PCT)
 *   4. Built-in default (cpu=80, memory=85, consecutiveChecks=2)
 *
 * isOverride is true whenever a per-app value (DB or env) overrides the global
 * default. isDbOverride is true specifically when the DB row is the source.
 */

import { db, alertThresholdConfigTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger.js";

export type ThresholdSource = "db" | "env" | "default";

export interface ResolvedThresholds {
  cpuThresholdPct: number;
  cpuIsOverride: boolean;
  cpuSource: ThresholdSource;
  memoryThresholdPct: number;
  memoryIsOverride: boolean;
  memorySource: ThresholdSource;
  consecutiveChecks: number;
  consecutiveChecksIsOverride: boolean;
  consecutiveChecksSource: ThresholdSource;
  /** ISO string when a DB row exists for this app, null otherwise. */
  updatedAt: string | null;
  /** Display name / UPN of the operator who last saved, or null. */
  updatedBy: string | null;
}

function appEnvKey(appId: string): string {
  return appId.toUpperCase().replace(/-/g, "_");
}

function envCpuPct(appId: string): { value: number; isOverride: boolean } {
  const perApp = process.env[`ALERT_CPU_THRESHOLD_PCT__${appEnvKey(appId)}`];
  if (perApp !== undefined) {
    const v = Number(perApp);
    if (Number.isFinite(v) && v > 0 && v <= 100) return { value: v, isOverride: true };
  }
  const global = process.env["ALERT_CPU_THRESHOLD_PCT"];
  if (global !== undefined) {
    const v = Number(global);
    if (Number.isFinite(v) && v > 0 && v <= 100) return { value: v, isOverride: false };
  }
  return { value: 80, isOverride: false };
}

function envMemoryPct(appId: string): { value: number; isOverride: boolean } {
  const perApp = process.env[`ALERT_MEMORY_THRESHOLD_PCT__${appEnvKey(appId)}`];
  if (perApp !== undefined) {
    const v = Number(perApp);
    if (Number.isFinite(v) && v > 0 && v <= 100) return { value: v, isOverride: true };
  }
  const global = process.env["ALERT_MEMORY_THRESHOLD_PCT"];
  if (global !== undefined) {
    const v = Number(global);
    if (Number.isFinite(v) && v > 0 && v <= 100) return { value: v, isOverride: false };
  }
  return { value: 85, isOverride: false };
}

function envConsecutiveChecks(appId: string): { value: number; isOverride: boolean } {
  const perApp = process.env[`ALERT_INFRA_CONSECUTIVE_CHECKS__${appEnvKey(appId)}`];
  if (perApp !== undefined) {
    const v = Number(perApp);
    if (Number.isFinite(v) && v >= 1) return { value: Math.floor(v), isOverride: true };
  }
  const global = process.env["ALERT_INFRA_CONSECUTIVE_CHECKS"];
  if (global !== undefined) {
    const v = Number(global);
    if (Number.isFinite(v) && v >= 1) return { value: Math.floor(v), isOverride: false };
  }
  return { value: 2, isOverride: false };
}

/**
 * Resolve effective thresholds for a single app, checking DB → env → default.
 * Returns synchronous env/default values on DB error (safe fallback).
 */
export async function resolveThresholds(appId: string): Promise<ResolvedThresholds> {
  let row: { cpuThresholdPct: number | null; memoryThresholdPct: number | null; consecutiveChecks: number | null; updatedAt: Date; updatedBy: string | null } | null = null;
  try {
    const rows = await db
      .select()
      .from(alertThresholdConfigTable)
      .where(eq(alertThresholdConfigTable.appId, appId))
      .limit(1);
    row = rows[0] ?? null;
  } catch (err) {
    logger.warn({ err, appId }, "alertThresholds: DB lookup failed, falling back to env/default");
  }

  const envCpu = envCpuPct(appId);
  const envMem = envMemoryPct(appId);
  const envConsec = envConsecutiveChecks(appId);

  const dbCpu = row?.cpuThresholdPct;
  const dbMem = row?.memoryThresholdPct;
  const dbConsec = row?.consecutiveChecks;

  const updatedAt = row ? row.updatedAt.toISOString() : null;
  const updatedBy = row?.updatedBy ?? null;

  return {
    cpuThresholdPct: dbCpu != null ? dbCpu : envCpu.value,
    cpuIsOverride: dbCpu != null ? true : envCpu.isOverride,
    cpuSource: dbCpu != null ? "db" : (envCpu.isOverride ? "env" : "default"),

    memoryThresholdPct: dbMem != null ? dbMem : envMem.value,
    memoryIsOverride: dbMem != null ? true : envMem.isOverride,
    memorySource: dbMem != null ? "db" : (envMem.isOverride ? "env" : "default"),

    consecutiveChecks: dbConsec != null ? dbConsec : envConsec.value,
    consecutiveChecksIsOverride: dbConsec != null ? true : envConsec.isOverride,
    consecutiveChecksSource: dbConsec != null ? "db" : (envConsec.isOverride ? "env" : "default"),

    updatedAt,
    updatedBy,
  };
}

/**
 * Bulk-resolve thresholds for all given app IDs in a single DB query.
 * Useful in the GET /alerts/config route to avoid N+1 queries.
 */
export async function resolveThresholdsBulk(
  appIds: string[],
): Promise<Map<string, ResolvedThresholds>> {
  let dbRows: Array<{ appId: string; cpuThresholdPct: number | null; memoryThresholdPct: number | null; consecutiveChecks: number | null; updatedAt: Date; updatedBy: string | null }> = [];
  try {
    dbRows = await db.select().from(alertThresholdConfigTable);
  } catch (err) {
    logger.warn({ err }, "alertThresholds: bulk DB lookup failed, falling back to env/default");
  }

  const rowByAppId = new Map(dbRows.map((r) => [r.appId, r]));
  const result = new Map<string, ResolvedThresholds>();

  for (const appId of appIds) {
    const row = rowByAppId.get(appId) ?? null;
    const envCpu = envCpuPct(appId);
    const envMem = envMemoryPct(appId);
    const envConsec = envConsecutiveChecks(appId);

    const dbCpu = row?.cpuThresholdPct ?? null;
    const dbMem = row?.memoryThresholdPct ?? null;
    const dbConsec = row?.consecutiveChecks ?? null;

    result.set(appId, {
      cpuThresholdPct: dbCpu != null ? dbCpu : envCpu.value,
      cpuIsOverride: dbCpu != null ? true : envCpu.isOverride,
      cpuSource: dbCpu != null ? "db" : (envCpu.isOverride ? "env" : "default"),

      memoryThresholdPct: dbMem != null ? dbMem : envMem.value,
      memoryIsOverride: dbMem != null ? true : envMem.isOverride,
      memorySource: dbMem != null ? "db" : (envMem.isOverride ? "env" : "default"),

      consecutiveChecks: dbConsec != null ? dbConsec : envConsec.value,
      consecutiveChecksIsOverride: dbConsec != null ? true : envConsec.isOverride,
      consecutiveChecksSource: dbConsec != null ? "db" : (envConsec.isOverride ? "env" : "default"),

      updatedAt: row ? row.updatedAt.toISOString() : null,
      updatedBy: row?.updatedBy ?? null,
    });
  }

  return result;
}
