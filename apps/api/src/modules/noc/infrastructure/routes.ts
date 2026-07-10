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

router.get("/infrastructure", requireAuth, requireAdmin, async (req, res) => {
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
        ...snapshot.vpn,
        ...snapshot.loadBalancers,
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

router.get("/infrastructure/debug", requireAuth, requireAdmin, async (req, res) => {
  const e = (k: string) => process.env[k];
  const present = (k: string) => (e(k) ? "✓ set" : "✗ missing");
  const masked = (k: string) => {
    const v = e(k);
    if (!v) return "✗ missing";
    return `✓ set (${v.slice(0, 4)}…${v.slice(-4)})`;
  };

  const subIds = (e("AZURE_SUBSCRIPTION_IDS") ?? "").split(",").map((s) => s.trim()).filter(Boolean);

  let tokenResult = "not attempted";
  if (e("IDENTITY_ENDPOINT") || (e("AZURE_TENANT_ID") && e("AZURE_CLIENT_ID") && e("AZURE_CLIENT_SECRET"))) {
    try {
      const { getAccessToken } = await import("../../../lib/azure-monitor.js");
      const token = await getAccessToken();
      tokenResult = token ? `✓ obtained (${token.slice(0, 10)}…)` : "✗ fetch succeeded but token was null";
    } catch (err) {
      tokenResult = `✗ threw: ${String(err)}`;
    }
  } else {
    tokenResult = "✗ no auth env vars present";
  }

  res.json({
    auth: {
      IDENTITY_ENDPOINT: present("IDENTITY_ENDPOINT"),
      IDENTITY_HEADER: present("IDENTITY_HEADER"),
      AZURE_TENANT_ID: present("AZURE_TENANT_ID"),
      AZURE_CLIENT_ID: masked("AZURE_CLIENT_ID"),
      AZURE_CLIENT_SECRET: present("AZURE_CLIENT_SECRET"),
      tokenResult,
    },
    subscriptions: {
      AZURE_SUBSCRIPTION_IDS: present("AZURE_SUBSCRIPTION_IDS"),
      parsedCount: subIds.length,
      AZURE_SUB_ORBIT: present("AZURE_SUB_ORBIT"),
      AZURE_SUB_SHARED: present("AZURE_SUB_SHARED"),
    },
    resources: {
      AZURE_RESOURCE_GROUP_ORBIT: e("AZURE_RESOURCE_GROUP_ORBIT") ?? "(default: rg-kinisislabs-orbit-prod-eus2)",
      AZURE_CONTAINER_APP_NAME: e("AZURE_CONTAINER_APP_NAME") ?? "(default: ca-orbit-prod-v2)",
      AZURE_RESOURCE_GROUP_SHARED: e("AZURE_RESOURCE_GROUP_SHARED") ?? "(default: rg-kinisislabs-platform-shared-prod-eus2)",
      AZURE_POSTGRES_NAME: e("AZURE_POSTGRES_NAME") ?? "(default: pg-orbit-prod)",
      AZURE_STORAGE_NAME: e("AZURE_STORAGE_NAME") ?? "(default: stsharedprod)",
      AZURE_CONTAINER_APP_NAME_GRAILBABE: present("AZURE_CONTAINER_APP_NAME_GRAILBABE"),
      APPLICATIONINSIGHTS_CONNECTION_STRING: present("APPLICATIONINSIGHTS_CONNECTION_STRING"),
    },
    cacheStatus: {
      hasCachedSnapshot: cachedSnapshot !== null,
      cacheExpiresAt: cacheExpiresAt ? new Date(cacheExpiresAt).toISOString() : null,
      cacheValid: Date.now() < cacheExpiresAt,
    },
    liveProbe: await (async () => {
      try {
        const { getAccessToken } = await import("../../../lib/azure-monitor.js");
        const token = await getAccessToken();
        if (!token) return { error: "no token" };
        const subIds = (process.env["AZURE_SUBSCRIPTION_IDS"] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
        const subId = subIds[0];
        const rg = process.env["AZURE_RESOURCE_GROUP_ORBIT"] ?? "rg-kinisislabs-orbit-prod-eus2";
        const ca = process.env["AZURE_CONTAINER_APP_NAME"] ?? "ca-orbit-prod-v2";
        const resourceId = `/subscriptions/${subId}/resourceGroups/${rg}/providers/Microsoft.App/containerApps/${ca}`;
        const defsUrl = `https://management.azure.com${resourceId}/providers/Microsoft.Insights/metricDefinitions?api-version=2023-10-01&metricnamespace=Microsoft.App%2FcontainerApps`;
        const defsRes = await fetch(defsUrl, { headers: { Authorization: `Bearer ${token}` } });
        const defsBody = (await defsRes.json()) as { value?: Array<{ name?: { value?: string } }> };
        const availableMetrics = (defsBody.value ?? []).map((m) => m.name?.value).filter(Boolean);

        const url = `https://management.azure.com${resourceId}/providers/Microsoft.Insights/metrics?api-version=2023-10-01&metricnamespace=Microsoft.App%2FcontainerApps&metricnames=CpuPercentage&timespan=PT24H&aggregation=Average&interval=PT1H`;
        const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        const body = await res.text();
        return { status: res.status, resourceId, availableMetrics, bodyPreview: body.slice(0, 400) };
      } catch (err) {
        return { error: String(err) };
      }
    })(),
  });
});

router.get("/infrastructure/history", requireAuth, requireAdmin, async (req, res) => {
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
