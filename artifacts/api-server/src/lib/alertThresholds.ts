/**
 * DB-aware infra alert threshold helpers.
 *
 * Priority order for each per-app value:
 *   1. Row in alert_threshold_config (set by operators via the Orbit UI)
 *   2. Per-app env var (e.g. ALERT_CPU_THRESHOLD_PCT__GRAILBABE)
 *   3. APPS inventory baseline (app.cpuThreshold, caller-supplied)
 *   4. Global env var (e.g. ALERT_CPU_THRESHOLD_PCT)
 *   5. Built-in default (cpu=80, memory=85, consecutiveChecks=2)
 *
 * isOverride is true whenever a per-app value (DB or env) overrides the global
 * default. isDbOverride is true specifically when the DB row is the source.
 *
 * resolveEnvCpuThreshold / resolveEnvMemoryThreshold are exported for use by
 * callers (e.g. the SLO route) that manage their own DB-override tier and only
 * need the env-var + inventory + global resolution.
 */

import { db, alertThresholdConfigTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger.js";

export type ThresholdSource = "db" | "env" | "inventory" | "default";

export interface ResolvedThresholds {
  cpuThresholdPct: number;
  cpuIsOverride: boolean;
  cpuSource: ThresholdSource;
  /** The env-var value (per-app or global) for CPU, if any env var is set. Null when no env var is configured. */
  cpuEnvValue: number | null;
  /** The env-var name that produced cpuEnvValue, e.g. ALERT_CPU_THRESHOLD_PCT__GRAILBABE. Null when cpuEnvValue is null. */
  cpuEnvVarName: string | null;
  memoryThresholdPct: number;
  memoryIsOverride: boolean;
  memorySource: ThresholdSource;
  /** The env-var value (per-app or global) for memory, if any env var is set. Null when no env var is configured. */
  memoryEnvValue: number | null;
  /** The env-var name that produced memoryEnvValue. Null when memoryEnvValue is null. */
  memoryEnvVarName: string | null;
  consecutiveChecks: number;
  consecutiveChecksIsOverride: boolean;
  consecutiveChecksSource: ThresholdSource;
  /** The env-var value (per-app or global) for consecutive checks, if any env var is set. Null when no env var is configured. */
  consecutiveChecksEnvValue: number | null;
  /** The env-var name that produced consecutiveChecksEnvValue. Null when consecutiveChecksEnvValue is null. */
  consecutiveChecksEnvVarName: string | null;
  /** ISO string when a DB row exists for this app, null otherwise. */
  updatedAt: string | null;
  /** Display name / UPN of the operator who last saved, or null. */
  updatedBy: string | null;
}

function appEnvKey(appId: string): string {
  return appId.toUpperCase().replace(/-/g, "_");
}

/**
 * Resolve CPU threshold % using env vars and an optional inventory baseline —
 * no DB involvement. Resolution: per-app env var → inventoryValue → global env var → 80.
 *
 * Exported so callers that manage their own DB-override tier (e.g. the SLO
 * route in orbit.ts) can apply the env-var tier without duplicating the logic.
 */
export function resolveEnvCpuThreshold(appId: string, inventoryValue?: number): number {
  const perApp = process.env[`ALERT_CPU_THRESHOLD_PCT__${appEnvKey(appId)}`];
  if (perApp !== undefined) {
    const v = Number(perApp);
    if (Number.isFinite(v) && v > 0 && v <= 100) return v;
  }
  if (inventoryValue !== undefined) return inventoryValue;
  const globalEnv = process.env["ALERT_CPU_THRESHOLD_PCT"];
  if (globalEnv !== undefined) {
    const v = Number(globalEnv);
    if (Number.isFinite(v) && v > 0 && v <= 100) return v;
  }
  return 80;
}

/**
 * Resolve memory threshold % using env vars and an optional inventory baseline —
 * no DB involvement. Resolution: per-app env var → inventoryValue → global env var → 85.
 *
 * Exported for the same reason as resolveEnvCpuThreshold.
 */
export function resolveEnvMemoryThreshold(appId: string, inventoryValue?: number): number {
  const perApp = process.env[`ALERT_MEMORY_THRESHOLD_PCT__${appEnvKey(appId)}`];
  if (perApp !== undefined) {
    const v = Number(perApp);
    if (Number.isFinite(v) && v > 0 && v <= 100) return v;
  }
  if (inventoryValue !== undefined) return inventoryValue;
  const globalEnv = process.env["ALERT_MEMORY_THRESHOLD_PCT"];
  if (globalEnv !== undefined) {
    const v = Number(globalEnv);
    if (Number.isFinite(v) && v > 0 && v <= 100) return v;
  }
  return 85;
}

function envCpuPct(appId: string): { value: number; isOverride: boolean } {
  const perApp = process.env[`ALERT_CPU_THRESHOLD_PCT__${appEnvKey(appId)}`];
  if (perApp !== undefined) {
    const v = Number(perApp);
    if (Number.isFinite(v) && v > 0 && v <= 100) return { value: v, isOverride: true };
  }
  const globalEnv = process.env["ALERT_CPU_THRESHOLD_PCT"];
  if (globalEnv !== undefined) {
    const v = Number(globalEnv);
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
  const globalEnv = process.env["ALERT_MEMORY_THRESHOLD_PCT"];
  if (globalEnv !== undefined) {
    const v = Number(globalEnv);
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
 * Return the raw env-var value and its variable name for CPU threshold, if any env var is set.
 * Prefers per-app var over global. Returns { value: null, varName: null } when no env var is present.
 */
function rawEnvCpu(appId: string): { value: number | null; varName: string | null } {
  const key = appEnvKey(appId);
  const perAppName = `ALERT_CPU_THRESHOLD_PCT__${key}`;
  const perApp = process.env[perAppName];
  if (perApp !== undefined) {
    const v = Number(perApp);
    if (Number.isFinite(v) && v > 0 && v <= 100) return { value: v, varName: perAppName };
  }
  const globalEnv = process.env["ALERT_CPU_THRESHOLD_PCT"];
  if (globalEnv !== undefined) {
    const v = Number(globalEnv);
    if (Number.isFinite(v) && v > 0 && v <= 100) return { value: v, varName: "ALERT_CPU_THRESHOLD_PCT" };
  }
  return { value: null, varName: null };
}

/**
 * Return the raw env-var value and its variable name for memory threshold, if any env var is set.
 */
function rawEnvMemory(appId: string): { value: number | null; varName: string | null } {
  const key = appEnvKey(appId);
  const perAppName = `ALERT_MEMORY_THRESHOLD_PCT__${key}`;
  const perApp = process.env[perAppName];
  if (perApp !== undefined) {
    const v = Number(perApp);
    if (Number.isFinite(v) && v > 0 && v <= 100) return { value: v, varName: perAppName };
  }
  const globalEnv = process.env["ALERT_MEMORY_THRESHOLD_PCT"];
  if (globalEnv !== undefined) {
    const v = Number(globalEnv);
    if (Number.isFinite(v) && v > 0 && v <= 100) return { value: v, varName: "ALERT_MEMORY_THRESHOLD_PCT" };
  }
  return { value: null, varName: null };
}

/**
 * Return the raw env-var value and its variable name for consecutive checks, if any env var is set.
 */
function rawEnvConsecutiveChecks(appId: string): { value: number | null; varName: string | null } {
  const key = appEnvKey(appId);
  const perAppName = `ALERT_INFRA_CONSECUTIVE_CHECKS__${key}`;
  const perApp = process.env[perAppName];
  if (perApp !== undefined) {
    const v = Number(perApp);
    if (Number.isFinite(v) && v >= 1) return { value: Math.floor(v), varName: perAppName };
  }
  const globalEnv = process.env["ALERT_INFRA_CONSECUTIVE_CHECKS"];
  if (globalEnv !== undefined) {
    const v = Number(globalEnv);
    if (Number.isFinite(v) && v >= 1) return { value: Math.floor(v), varName: "ALERT_INFRA_CONSECUTIVE_CHECKS" };
  }
  return { value: null, varName: null };
}

/**
 * Resolve effective thresholds for a single app, checking DB → env → inventory → default.
 * Returns synchronous env/default values on DB error (safe fallback).
 *
 * Pass inventoryCpu / inventoryMemory to enable "inventory" source tracking when the
 * resolved value comes from the app's built-in APPS record baseline.
 */
export async function resolveThresholds(
  appId: string,
  inventory?: { cpuThresholdPct?: number | null; memoryThresholdPct?: number | null },
): Promise<ResolvedThresholds> {
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
  const rawCpu = rawEnvCpu(appId);
  const rawMem = rawEnvMemory(appId);
  const rawConsec = rawEnvConsecutiveChecks(appId);

  const dbCpu = row?.cpuThresholdPct;
  const dbMem = row?.memoryThresholdPct;
  const dbConsec = row?.consecutiveChecks;

  const invCpu = inventory?.cpuThresholdPct ?? null;
  const invMem = inventory?.memoryThresholdPct ?? null;

  const updatedAt = row ? row.updatedAt.toISOString() : null;
  const updatedBy = row?.updatedBy ?? null;

  function cpuSource(): ThresholdSource {
    if (dbCpu != null) return "db";
    if (envCpu.isOverride) return "env";
    if (invCpu != null) return "inventory";
    return "default";
  }

  function memSource(): ThresholdSource {
    if (dbMem != null) return "db";
    if (envMem.isOverride) return "env";
    if (invMem != null) return "inventory";
    return "default";
  }

  return {
    cpuThresholdPct: dbCpu ?? (envCpu.isOverride ? envCpu.value : (invCpu ?? envCpu.value)),
    cpuIsOverride: dbCpu != null ? true : envCpu.isOverride,
    cpuSource: cpuSource(),
    cpuEnvValue: rawCpu.value,
    cpuEnvVarName: rawCpu.varName,

    memoryThresholdPct: dbMem ?? (envMem.isOverride ? envMem.value : (invMem ?? envMem.value)),
    memoryIsOverride: dbMem != null ? true : envMem.isOverride,
    memorySource: memSource(),
    memoryEnvValue: rawMem.value,
    memoryEnvVarName: rawMem.varName,

    consecutiveChecks: dbConsec != null ? dbConsec : envConsec.value,
    consecutiveChecksIsOverride: dbConsec != null ? true : envConsec.isOverride,
    consecutiveChecksSource: dbConsec != null ? "db" : (envConsec.isOverride ? "env" : "default"),
    consecutiveChecksEnvValue: rawConsec.value,
    consecutiveChecksEnvVarName: rawConsec.varName,

    updatedAt,
    updatedBy,
  };
}

/**
 * Bulk-resolve thresholds for all given app IDs in a single DB query.
 * Useful in the GET /alerts/config route to avoid N+1 queries.
 *
 * Pass inventoryByAppId to enable "inventory" source tracking for apps whose
 * built-in APPS record defines per-app CPU / memory baseline thresholds.
 */
export async function resolveThresholdsBulk(
  appIds: string[],
  inventoryByAppId?: Map<string, { cpuThresholdPct?: number | null; memoryThresholdPct?: number | null }>,
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
    const rawCpu = rawEnvCpu(appId);
    const rawMem = rawEnvMemory(appId);
    const rawConsec = rawEnvConsecutiveChecks(appId);

    const dbCpu = row?.cpuThresholdPct ?? null;
    const dbMem = row?.memoryThresholdPct ?? null;
    const dbConsec = row?.consecutiveChecks ?? null;

    const inv = inventoryByAppId?.get(appId);
    const invCpu = inv?.cpuThresholdPct ?? null;
    const invMem = inv?.memoryThresholdPct ?? null;

    const cpuSrc: ThresholdSource =
      dbCpu != null ? "db" :
      envCpu.isOverride ? "env" :
      invCpu != null ? "inventory" :
      "default";

    const memSrc: ThresholdSource =
      dbMem != null ? "db" :
      envMem.isOverride ? "env" :
      invMem != null ? "inventory" :
      "default";

    result.set(appId, {
      cpuThresholdPct: dbCpu ?? (envCpu.isOverride ? envCpu.value : (invCpu ?? envCpu.value)),
      cpuIsOverride: dbCpu != null ? true : envCpu.isOverride,
      cpuSource: cpuSrc,
      cpuEnvValue: rawCpu.value,
      cpuEnvVarName: rawCpu.varName,

      memoryThresholdPct: dbMem ?? (envMem.isOverride ? envMem.value : (invMem ?? envMem.value)),
      memoryIsOverride: dbMem != null ? true : envMem.isOverride,
      memorySource: memSrc,
      memoryEnvValue: rawMem.value,
      memoryEnvVarName: rawMem.varName,

      consecutiveChecks: dbConsec != null ? dbConsec : envConsec.value,
      consecutiveChecksIsOverride: dbConsec != null ? true : envConsec.isOverride,
      consecutiveChecksSource: dbConsec != null ? "db" : (envConsec.isOverride ? "env" : "default"),
      consecutiveChecksEnvValue: rawConsec.value,
      consecutiveChecksEnvVarName: rawConsec.varName,

      updatedAt: row ? row.updatedAt.toISOString() : null,
      updatedBy: row?.updatedBy ?? null,
    });
  }

  return result;
}
