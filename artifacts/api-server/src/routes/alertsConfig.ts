import { Router, type IRouter } from "express";
import { APPS } from "./orbit.js";

const router: IRouter = Router();

function appEnvKey(appId: string): string {
  return appId.toUpperCase().replace(/-/g, "_");
}

function cpuThresholdPct(appId: string): { value: number; isOverride: boolean } {
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

function memoryThresholdPct(appId: string): { value: number; isOverride: boolean } {
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

function consecutiveChecks(): number {
  const v = Number(process.env["ALERT_INFRA_CONSECUTIVE_CHECKS"] ?? 2);
  return Number.isFinite(v) && v >= 1 ? Math.floor(v) : 2;
}

router.get("/alerts/config", (_req, res) => {
  const checks = consecutiveChecks();
  const result = APPS.map((app) => {
    const cpu = cpuThresholdPct(app.id);
    const mem = memoryThresholdPct(app.id);
    return {
      appId: app.id,
      appName: app.name,
      cpuThresholdPct: cpu.value,
      memoryThresholdPct: mem.value,
      cpuIsOverride: cpu.isOverride,
      memoryIsOverride: mem.isOverride,
      consecutiveChecks: checks,
    };
  });
  res.json(result);
});

export default router;
