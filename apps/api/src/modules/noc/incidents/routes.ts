import { Router, type IRouter } from "express";
import { requireAuth, requireAdmin } from "../../../middlewares/auth.js";
import { fetchAzureAlerts, computeIncidentMetrics } from "../../../lib/azure-alerts.js";
import { isAzureMonitorConfigured } from "../../../lib/azure-monitor.js";
import { db } from "../../../lib/db.js";
import { nocIncidentsTable } from "@workspace/db";
import { desc, gte } from "drizzle-orm";

const router: IRouter = Router();

const CACHE_TTL_MS = 2 * 60 * 1000;
let cachedAlerts: Awaited<ReturnType<typeof fetchAzureAlerts>> | null = null;
let cacheExpiresAt = 0;

// ── GET /api/noc/incidents ────────────────────────────────────────────────────

router.get("/incidents", requireAuth, requireAdmin, async (req, res) => {
  try {
    const forceRefresh = req.query.refresh === "1";
    const now = Date.now();

    if (!forceRefresh && cachedAlerts && now < cacheExpiresAt) {
      const metrics = computeIncidentMetrics(cachedAlerts);
      return res.json({ alerts: cachedAlerts, metrics, azureConfigured: isAzureMonitorConfigured(), cachedAt: new Date(cacheExpiresAt - CACHE_TTL_MS).toISOString() });
    }

    const alerts = await fetchAzureAlerts();

    if (alerts.length > 0) {
      cachedAlerts = alerts;
      cacheExpiresAt = now + CACHE_TTL_MS;

      // Upsert into noc_incidents for MTTA/MTTR history
      await db
        .insert(nocIncidentsTable)
        .values(
          alerts.map((a) => ({
            externalId: a.id,
            title: a.name,
            severity: a.severity,
            status: a.status,
            service: a.service,
            source: a.source,
            description: a.description,
            acknowledgedAt: a.status === "acknowledged" ? new Date() : undefined,
            resolvedAt: a.resolvedAt ? new Date(a.resolvedAt) : undefined,
            createdAt: new Date(a.firedAt),
          })),
        )
        .onConflictDoNothing()
        .catch(() => {});
    }

    const metrics = computeIncidentMetrics(alerts);
    return res.json({
      alerts,
      metrics,
      azureConfigured: isAzureMonitorConfigured(),
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    req.log.error(err, "GET /api/noc/incidents failed");
    return res.status(500).json({ message: "Internal server error" });
  }
});

// ── GET /api/noc/incidents/metrics — MTTA/MTTR trends from DB ─────────────────

router.get("/incidents/metrics", requireAuth, requireAdmin, async (req, res) => {
  try {
    const days = Math.min(Number(req.query.days ?? 7), 30);
    const since = new Date(Date.now() - days * 86_400_000);

    const rows = await db
      .select()
      .from(nocIncidentsTable)
      .where(gte(nocIncidentsTable.createdAt, since))
      .orderBy(desc(nocIncidentsTable.createdAt))
      .limit(500);

    // Group by day for trend charts
    const byDay: Record<string, { date: string; count: number; resolved: number; mttaSum: number; mttaCount: number; mttrSum: number; mttrCount: number }> = {};

    for (const row of rows) {
      const day = row.createdAt.toISOString().slice(0, 10);
      if (!byDay[day]) byDay[day] = { date: day, count: 0, resolved: 0, mttaSum: 0, mttaCount: 0, mttrSum: 0, mttrCount: 0 };
      const d = byDay[day];
      d.count++;
      if (row.resolvedAt) {
        d.resolved++;
        d.mttrSum += (row.resolvedAt.getTime() - row.createdAt.getTime()) / 60_000;
        d.mttrCount++;
      }
      if (row.acknowledgedAt) {
        d.mttaSum += (row.acknowledgedAt.getTime() - row.createdAt.getTime()) / 60_000;
        d.mttaCount++;
      }
    }

    const trend = Object.values(byDay)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((d) => ({
        date: d.date,
        count: d.count,
        resolved: d.resolved,
        mttaMinutes: d.mttaCount > 0 ? Math.round(d.mttaSum / d.mttaCount) : null,
        mttrMinutes: d.mttrCount > 0 ? Math.round(d.mttrSum / d.mttrCount) : null,
      }));

    res.json({ days, trend, total: rows.length, generatedAt: new Date().toISOString() });
  } catch (err) {
    req.log.error(err, "GET /api/noc/incidents/metrics failed");
    res.status(500).json({ message: "Internal server error" });
  }
});

export default router;
