import { Router, type IRouter } from "express";
import { requireAuth, requireAdmin } from "../../../middlewares/auth.js";
import { getInfrastructureSnapshot, isAzureMonitorConfigured } from "../../../lib/azure-monitor.js";
import { db } from "../../../lib/db.js";
import { nocMetricSnapshotsTable } from "@workspace/db";

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
      if (snapshot.containerApps.length > 0 || snapshot.database.length > 0) {
        cachedSnapshot = snapshot;
        cacheExpiresAt = now + CACHE_TTL_MS;
      }
    }

    if (isAzureMonitorConfigured()) {
      const allMetrics = [
        ...snapshot.containerApps,
        ...snapshot.database,
        ...snapshot.storage,
        ...snapshot.appInsights,
      ];

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

    res.json({
      azureConfigured: isAzureMonitorConfigured(),
      ...snapshot,
    });
  } catch (err) {
    req.log.error(err, "GET /api/noc/infrastructure failed");
    res.status(500).json({ message: "Internal server error" });
  }
});

export default router;
