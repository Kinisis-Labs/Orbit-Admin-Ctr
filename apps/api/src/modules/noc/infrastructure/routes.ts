import { Router, type IRouter } from "express";
import { requireAuth, requireAdmin } from "../../../middlewares/auth.js";
import { getInfrastructureSnapshot, isAzureMonitorConfigured } from "../../../lib/azure-monitor.js";
import { db } from "../../../lib/db.js";
import { nocMetricSnapshotsTable } from "@workspace/db";

const router: IRouter = Router();

router.get("/noc/infrastructure", requireAuth, requireAdmin, async (req, res) => {
  try {
    const snapshot = await getInfrastructureSnapshot();

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
