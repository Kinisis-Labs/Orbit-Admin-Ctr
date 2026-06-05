import { Router, type IRouter } from "express";
import { APPS } from "./orbit.js";
import { resolveThresholdsBulk, resolveThresholds } from "../lib/alertThresholds.js";
import { db, alertThresholdConfigTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAdmin } from "../middlewares/auth.js";

const router: IRouter = Router();

router.get("/alerts/config", async (_req, res) => {
  const appIds = APPS.map((a) => a.id);
  const thresholds = await resolveThresholdsBulk(appIds);

  const result = APPS.map((app) => {
    const t = thresholds.get(app.id)!;
    return {
      appId: app.id,
      appName: app.name,
      cpuThresholdPct: t.cpuThresholdPct,
      memoryThresholdPct: t.memoryThresholdPct,
      cpuIsOverride: t.cpuIsOverride,
      memoryIsOverride: t.memoryIsOverride,
      consecutiveChecks: t.consecutiveChecks,
      consecutiveChecksIsOverride: t.consecutiveChecksIsOverride,
      cpuSource: t.cpuSource,
      memorySource: t.memorySource,
      consecutiveChecksSource: t.consecutiveChecksSource,
      updatedAt: t.updatedAt,
      updatedBy: t.updatedBy,
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

  if (errors.length > 0) {
    res.status(400).json({ error: "validation error", issues: errors });
    return;
  }

  const updatedBy =
    req.session.user?.displayName ??
    req.session.user?.userPrincipalName ??
    "mock-admin";

  await db
    .insert(alertThresholdConfigTable)
    .values({
      appId,
      cpuThresholdPct: cpu.value,
      memoryThresholdPct: mem.value,
      consecutiveChecks: consec.value,
      updatedBy,
    })
    .onConflictDoUpdate({
      target: alertThresholdConfigTable.appId,
      set: {
        cpuThresholdPct: cpu.value,
        memoryThresholdPct: mem.value,
        consecutiveChecks: consec.value,
        updatedAt: new Date(),
        updatedBy,
      },
    });

  const t = await resolveThresholds(appId);

  res.json({
    appId: app.id,
    appName: app.name,
    cpuThresholdPct: t.cpuThresholdPct,
    memoryThresholdPct: t.memoryThresholdPct,
    cpuIsOverride: t.cpuIsOverride,
    memoryIsOverride: t.memoryIsOverride,
    consecutiveChecks: t.consecutiveChecks,
    consecutiveChecksIsOverride: t.consecutiveChecksIsOverride,
    cpuSource: t.cpuSource,
    memorySource: t.memorySource,
    consecutiveChecksSource: t.consecutiveChecksSource,
    updatedAt: t.updatedAt,
    updatedBy: t.updatedBy,
  });
});

export default router;
