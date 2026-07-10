import { Router, type IRouter } from "express";
import { requireAuth, requireAdmin } from "../../../middlewares/auth.js";
import { getInfrastructureSnapshot, isAzureMonitorConfigured } from "../../../lib/azure-monitor.js";
import { db } from "../../../lib/db.js";
import { nocMetricSnapshotsTable } from "@workspace/db";
import { desc, gte } from "drizzle-orm";

type InfraSnapshot = Awaited<ReturnType<typeof getInfrastructureSnapshot>>;

const router: IRouter = Router();

const CACHE_TTL_MS = 5 * 60 * 1000;
let cachedSnapshot: InfraSnapshot | null = null;
let cacheExpiresAt = 0;

router.get("/noc/infrastructure", requireAuth, requireAdmin, async (req, res) => {
  try {
    const now = Date.now();
    const forceRefresh = req.query.refresh === "1";
    let snapshot: InfraSnapshot;
    if (!forceRefresh && cachedSnapshot && now < cacheExpiresAt) {
      snapshot = cachedSnapshot;
    } else {
      snapshot = await getInfrastructureSnapshot();
      if (snapshot.containerApps.length > 0 || snapshot.database.length > 0 || snapshot.api.length > 0) {
        cachedSnapshot = snapshot;
        cacheExpiresAt = now + CACHE_TTL_MS;
      }
    }

    if (isAzureMonitorConfigured()) {
      const allMetrics = [
        ...snapshot.containerApps,
        ...snapshot.database,
        ...snapshot.network,
        ...snapshot.api,
      ].flatMap((g) => g.metrics);

      if (allMetrics.length > 0) {
        await db
          .insert(nocMetricSnapshotsTable)
          .values(
            allMetrics.map((m) => ({
              resourceId: m.resourceId,
              resourceName: m.resourceName,
              resourceType: m.resourceType,
              metricName: m.metricName,
              value: m.value ?? undefined,
              unit: m.unit,
              source: "azure-monitor",
            })),
          )
          .catch(() => {});
      }
    }

    res.json(snapshot);
  } catch (err) {
    req.log.error(err, "GET /api/noc/infrastructure failed");
    res.status(500).json({ message: "Internal server error" });
  }
});

router.get("/noc/infrastructure/history", requireAuth, requireAdmin, async (req, res) => {
  try {
    const hours = Math.min(Number(req.query.hours ?? 6), 24);
    const since = new Date(Date.now() - hours * 3600 * 1000);

    const rows = await db
      .select({
        resourceName: nocMetricSnapshotsTable.resourceName,
        resourceType: nocMetricSnapshotsTable.resourceType,
        metricName: nocMetricSnapshotsTable.metricName,
        value: nocMetricSnapshotsTable.value,
        unit: nocMetricSnapshotsTable.unit,
        capturedAt: nocMetricSnapshotsTable.capturedAt,
      })
      .from(nocMetricSnapshotsTable)
      .where(gte(nocMetricSnapshotsTable.capturedAt, since))
      .orderBy(desc(nocMetricSnapshotsTable.capturedAt))
      .limit(2000);

    type SeriesKey = string;
    const series: Record<SeriesKey, { resourceName: string; resourceType: string; metricName: string; unit: string; points: { t: string; v: number | null }[] }> = {};

    for (const row of rows) {
      const key = `${row.resourceName}::${row.metricName}`;
      if (!series[key]) {
        series[key] = {
          resourceName: row.resourceName,
          resourceType: row.resourceType,
          metricName: row.metricName,
          unit: row.unit ?? "",
          points: [],
        };
      }
      series[key].points.push({ t: row.capturedAt.toISOString(), v: row.value ?? null });
    }

    for (const s of Object.values(series)) {
      s.points.sort((a, b) => a.t.localeCompare(b.t));
    }

    res.json({ hours, series: Object.values(series), generatedAt: new Date().toISOString() });
  } catch (err) {
    req.log.error(err, "GET /api/noc/infrastructure/history failed");
    res.status(500).json({ message: "Internal server error" });
  }
});

export default router;
