import { Router, type IRouter } from "express";
import { APPS } from "./orbit.js";
import { resolveThresholdsBulk, resolveThresholds } from "../lib/alertThresholds.js";
import { resolveCooldownHours, getAlertChannelStatus, getSilencedUntil } from "../lib/budgetAlerts.js";
import { db, alertThresholdConfigTable, alertThresholdConfigLogTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { requireAdmin } from "../middlewares/auth.js";

const router: IRouter = Router();

router.get("/alerts/channels", (_req, res) => {
  res.json(getAlertChannelStatus());
});

router.get("/alerts/config", async (_req, res) => {
  const appIds = APPS.map((a) => a.id);
  const inventoryByAppId = new Map(
    APPS.map((a) => [a.id, { cpuThresholdPct: a.cpuThreshold ?? null, memoryThresholdPct: a.memoryThreshold ?? null }]),
  );
  const thresholds = await resolveThresholdsBulk(appIds, inventoryByAppId);

  const [cooldowns, silencedUntils] = await Promise.all([
    Promise.all(APPS.map((app) => resolveCooldownHours(app.id))),
    Promise.all(APPS.map((app) => getSilencedUntil(app.id))),
  ]);

  const result = APPS.map((app, i) => {
    const t = thresholds.get(app.id)!;
    const cooldown = cooldowns[i]!;
    return {
      appId: app.id,
      appName: app.name,
      cpuThresholdPct: t.cpuThresholdPct,
      memoryThresholdPct: t.memoryThresholdPct,
      cpuIsOverride: t.cpuIsOverride,
      memoryIsOverride: t.memoryIsOverride,
      consecutiveChecks: t.consecutiveChecks,
      consecutiveChecksIsOverride: t.consecutiveChecksIsOverride,
      cooldownHours: cooldown.hours,
      cooldownIsOverride: cooldown.isOverride,
      cpuSource: t.cpuSource,
      memorySource: t.memorySource,
      consecutiveChecksSource: t.consecutiveChecksSource,
      cooldownSource: cooldown.source,
      silencedUntil: silencedUntils[i] ?? null,
      updatedAt: t.updatedAt,
      updatedBy: t.updatedBy,
      cpuEnvValue: t.cpuEnvValue,
      cpuEnvVarName: t.cpuEnvVarName,
      memoryEnvValue: t.memoryEnvValue,
      memoryEnvVarName: t.memoryEnvVarName,
      consecutiveChecksEnvValue: t.consecutiveChecksEnvValue,
      consecutiveChecksEnvVarName: t.consecutiveChecksEnvVarName,
    };
  });

  res.json(result);
});

function parseIntField(
  raw: unknown,
  label: string,
  min: number,
  max?: number,
): { value: number; error: string | null } {
  if (raw === null || raw === undefined) return { value: 0, error: null };
  const v = Number(raw);
  if (!Number.isFinite(v) || !Number.isInteger(v)) {
    return { value: 0, error: `${label} must be an integer` };
  }
  if (v < min) return { value: 0, error: `${label} must be >= ${min}` };
  if (max !== undefined && v > max) return { value: 0, error: `${label} must be <= ${max}` };
  return { value: v, error: null };
}

function toNullableInt(raw: unknown, label: string, min: number, max?: number): { value: number | null; error: string | null } {
  if (raw === null || raw === undefined) return { value: null, error: null };
  const { value, error } = parseIntField(raw, label, min, max);
  if (error) return { value: null, error };
  return { value, error: null };
}

router.put("/alerts/config/:appId", requireAdmin, async (req, res) => {
  const appId = req.params["appId"] as string;
  const app = APPS.find((a) => a.id === appId);
  if (!app) {
    res.status(404).json({ error: "app not found" });
    return;
  }

  const body = req.body as Record<string, unknown>;
  const errors: string[] = [];

  const cpu = toNullableInt(body["cpuThresholdPct"], "cpuThresholdPct", 1, 100);
  if (cpu.error) errors.push(cpu.error);

  const mem = toNullableInt(body["memoryThresholdPct"], "memoryThresholdPct", 1, 100);
  if (mem.error) errors.push(mem.error);

  const consec = toNullableInt(body["consecutiveChecks"], "consecutiveChecks", 1);
  if (consec.error) errors.push(consec.error);

  const cooldownField = toNullableInt(body["cooldownHours"], "cooldownHours", 1);
  if (cooldownField.error) errors.push(cooldownField.error);

  if (errors.length > 0) {
    res.status(400).json({ error: "validation error", issues: errors });
    return;
  }

  const updatedBy =
    req.session.user?.displayName ??
    req.session.user?.userPrincipalName ??
    "mock-admin";

  const existing = await db
    .select()
    .from(alertThresholdConfigTable)
    .where(eq(alertThresholdConfigTable.appId, appId))
    .limit(1);
  const prev = existing[0] ?? null;

  await db
    .insert(alertThresholdConfigTable)
    .values({
      appId,
      cpuThresholdPct: cpu.value,
      memoryThresholdPct: mem.value,
      consecutiveChecks: consec.value,
      cooldownHours: cooldownField.value,
      updatedBy,
    })
    .onConflictDoUpdate({
      target: alertThresholdConfigTable.appId,
      set: {
        cpuThresholdPct: cpu.value,
        memoryThresholdPct: mem.value,
        consecutiveChecks: consec.value,
        cooldownHours: cooldownField.value,
        updatedAt: new Date(),
        updatedBy,
      },
    });

  await db.insert(alertThresholdConfigLogTable).values({
    appId,
    oldCpuThresholdPct: prev?.cpuThresholdPct ?? null,
    newCpuThresholdPct: cpu.value,
    oldMemoryThresholdPct: prev?.memoryThresholdPct ?? null,
    newMemoryThresholdPct: mem.value,
    oldConsecutiveChecks: prev?.consecutiveChecks ?? null,
    newConsecutiveChecks: consec.value,
    oldCooldownHours: prev?.cooldownHours ?? null,
    newCooldownHours: cooldownField.value,
    changedBy: updatedBy,
  });

  const t = await resolveThresholds(appId, {
    cpuThresholdPct: app.cpuThreshold ?? null,
    memoryThresholdPct: app.memoryThreshold ?? null,
  });
  const cooldown = await resolveCooldownHours(appId);

  res.json({
    appId: app.id,
    appName: app.name,
    cpuThresholdPct: t.cpuThresholdPct,
    memoryThresholdPct: t.memoryThresholdPct,
    cpuIsOverride: t.cpuIsOverride,
    memoryIsOverride: t.memoryIsOverride,
    consecutiveChecks: t.consecutiveChecks,
    consecutiveChecksIsOverride: t.consecutiveChecksIsOverride,
    cooldownHours: cooldown.hours,
    cooldownIsOverride: cooldown.isOverride,
    cpuSource: t.cpuSource,
    memorySource: t.memorySource,
    consecutiveChecksSource: t.consecutiveChecksSource,
    cooldownSource: cooldown.source,
    silencedUntil: await getSilencedUntil(appId),
    updatedAt: t.updatedAt,
    updatedBy: t.updatedBy,
    cpuEnvValue: t.cpuEnvValue,
    cpuEnvVarName: t.cpuEnvVarName,
    memoryEnvValue: t.memoryEnvValue,
    memoryEnvVarName: t.memoryEnvVarName,
    consecutiveChecksEnvValue: t.consecutiveChecksEnvValue,
    consecutiveChecksEnvVarName: t.consecutiveChecksEnvVarName,
  });
});

router.get("/alerts/config/:appId/history", async (req, res) => {
  const appId = req.params["appId"] as string;
  const app = APPS.find((a) => a.id === appId);
  if (!app) {
    res.status(404).json({ error: "app not found" });
    return;
  }

  const rawLimit = Number(req.query["limit"]);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0
    ? Math.min(Math.round(rawLimit), 200)
    : 50;

  const rows = await db
    .select()
    .from(alertThresholdConfigLogTable)
    .where(eq(alertThresholdConfigLogTable.appId, appId))
    .orderBy(desc(alertThresholdConfigLogTable.changedAt))
    .limit(limit);

  res.json(
    rows.map((r) => ({
      id: r.id,
      appId: r.appId,
      oldCpuThresholdPct: r.oldCpuThresholdPct,
      newCpuThresholdPct: r.newCpuThresholdPct,
      oldMemoryThresholdPct: r.oldMemoryThresholdPct,
      newMemoryThresholdPct: r.newMemoryThresholdPct,
      oldConsecutiveChecks: r.oldConsecutiveChecks,
      newConsecutiveChecks: r.newConsecutiveChecks,
      oldCooldownHours: r.oldCooldownHours,
      newCooldownHours: r.newCooldownHours,
      changedBy: r.changedBy,
      changedAt: r.changedAt,
    })),
  );
});

export default router;
