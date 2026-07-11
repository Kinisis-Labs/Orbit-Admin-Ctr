import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../../../middlewares/auth.js";
import { db } from "../../../lib/db.js";
import { applicationsTable } from "@workspace/db";
import { getAccessToken } from "../../../lib/azure-monitor.js";

const router: IRouter = Router();

// ── App Insights telemetry helper ─────────────────────────────────────────────

interface AppTelemetry {
  availability: number | null;
  avgResponseMs: number | null;
  failedRequests: number | null;
  totalRequests: number | null;
  exceptions: number | null;
  activeSessions: number | null;
  authFailures: number | null;
}

// Extract the App Insights resource ID from the connection string's IngestionEndpoint
// or fall back to a known env var. The REST Metrics API requires the resource ID,
// not the InstrumentationKey UUID.
function extractResourceId(connectionString: string, slugHint?: string): string | null {
  // Explicit env var override: AZURE_APP_INSIGHTS_RESOURCE_ID_<SLUG> or AZURE_APP_INSIGHTS_RESOURCE_ID
  if (slugHint) {
    const slugKey = `AZURE_APP_INSIGHTS_RESOURCE_ID_${slugHint.toUpperCase().replace(/-/g, "_")}`;
    if (process.env[slugKey]) return process.env[slugKey] ?? null;
  }
  if (process.env.AZURE_APP_INSIGHTS_RESOURCE_ID) return process.env.AZURE_APP_INSIGHTS_RESOURCE_ID;

  // Parse from connection string: IngestionEndpoint tells us the resource name/sub indirectly.
  // The reliable field is the resource ID stored in some connection strings as ResourceId=
  const resourceIdMatch = connectionString.match(/ResourceId=([^;]+)/i);
  if (resourceIdMatch?.[1]) return resourceIdMatch[1].trim();

  return null;
}

async function getAppInsightsTelemetry(
  connectionString: string,
  token: string,
  slugHint?: string,
): Promise<AppTelemetry> {
  const empty: AppTelemetry = {
    availability: null,
    avgResponseMs: null,
    failedRequests: null,
    totalRequests: null,
    exceptions: null,
    activeSessions: null,
    authFailures: null,
  };

  try {
    const resourceId = extractResourceId(connectionString, slugHint);
    if (!resourceId) return empty;

    // Use Azure Monitor Metrics REST API with bearer token — same as infrastructure NOC
    const baseUrl = `https://management.azure.com${resourceId}/providers/microsoft.insights/metrics`;
    const timespan = "PT24H";
    const auth = { Authorization: `Bearer ${token}` };

    type MetricResponse = {
      value?: Array<{
        name?: { value?: string };
        timeseries?: Array<{ data?: Array<Record<string, number | undefined>> }>;
      }>;
    };

    const extractLast = async (
      metricName: string,
      aggregation: string,
    ): Promise<number | null> => {
      try {
        const url = `${baseUrl}?api-version=2023-10-01&metricnames=${encodeURIComponent(metricName)}&timespan=${timespan}&aggregation=${aggregation}&interval=PT24H`;
        const res = await fetch(url, { headers: auth });
        if (!res.ok) {
          const txt = await res.text().catch(() => "");
          console.warn(`[NOC/apps] metrics ${metricName} failed ${res.status}: ${txt.slice(0, 200)}`);
          return null;
        }
        const data = (await res.json()) as MetricResponse;
        const points = data.value?.[0]?.timeseries?.[0]?.data ?? [];
        const last = points[points.length - 1];
        if (!last) return null;
        const val = last[aggregation.toLowerCase() as keyof typeof last];
        return typeof val === "number" ? Math.round(val * 100) / 100 : null;
      } catch {
        return null;
      }
    };

    const [avail, dur, failed, total, exc, sessions] = await Promise.all([
      extractLast("availabilityResults/availabilityPercentage", "average"),
      extractLast("requests/duration", "average"),
      extractLast("requests/failed", "count"),
      extractLast("requests/count", "count"),
      extractLast("exceptions/count", "count"),
      extractLast("sessions/count", "unique"),
    ]);

    return {
      availability: avail,
      avgResponseMs: dur,
      failedRequests: failed,
      totalRequests: total,
      exceptions: exc,
      activeSessions: sessions,
      authFailures: null,
    };
  } catch {
    return empty;
  }
}

function deriveStatus(telemetry: AppTelemetry): "healthy" | "degraded" | "unhealthy" | "unknown" {
  if (telemetry.availability === null && telemetry.avgResponseMs === null) return "unknown";
  if (telemetry.availability !== null && telemetry.availability < 95) return "unhealthy";
  if (telemetry.availability !== null && telemetry.availability < 99) return "degraded";
  if (telemetry.avgResponseMs !== null && telemetry.avgResponseMs > 5000) return "degraded";
  return "healthy";
}

function getAppInsightsConnStr(): string | undefined {
  return process.env.APPLICATIONINSIGHTS_CONNECTION_STRING ?? process.env.APPINSIGHTS_CONNECTION_STRING;
}

// ── Routes ────────────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 2 * 60 * 1000;
let cachedApps: unknown = null;
let cacheExpiresAt = 0;

router.get("/applications", requireAuth, requireAdmin, async (req, res) => {
  try {
    const now = Date.now();
    const forceRefresh = req.query.refresh === "1";
    if (!forceRefresh && cachedApps && now < cacheExpiresAt) {
      res.json(cachedApps);
      return;
    }
    const apps = await db
      .select()
      .from(applicationsTable)
      .where(eq(applicationsTable.enabled, true));

    const globalConnStr = getAppInsightsConnStr();
    const token = await getAccessToken();

    const emptyTelemetry: AppTelemetry = {
      availability: null, avgResponseMs: null, failedRequests: null,
      totalRequests: null, exceptions: null, activeSessions: null, authFailures: null,
    };

    const results = await Promise.all(
      apps.map(async (app) => {
        const connStr = app.appInsightsConnectionString ?? globalConnStr;
        const telemetry =
          connStr && token
            ? await getAppInsightsTelemetry(connStr, token, app.slug)
            : emptyTelemetry;
        return {
          slug: app.slug,
          displayName: app.displayName,
          category: app.category,
          url: app.url,
          status: deriveStatus(telemetry),
          telemetry,
          appInsightsConfigured: !!connStr,
        };
      }),
    );

    const payload = { apps: results, capturedAt: new Date().toISOString() };
    if (results.length > 0) {
      cachedApps = payload;
      cacheExpiresAt = Date.now() + CACHE_TTL_MS;
    }
    res.json(payload);
  } catch (err) {
    req.log.error(err, "GET /api/noc/applications failed");
    res.status(500).json({ message: "Internal server error" });
  }
});

router.get("/applications/:slug", requireAuth, requireAdmin, async (req, res) => {
  try {
    const [app] = await db
      .select()
      .from(applicationsTable)
      .where(eq(applicationsTable.slug, String(req.params.slug)))
      .limit(1);

    if (!app) {
      res.status(404).json({ message: "Application not found" });
      return;
    }

    const connStr = app.appInsightsConnectionString ?? getAppInsightsConnStr();
    const token = await getAccessToken();
    const telemetry =
      connStr && token
        ? await getAppInsightsTelemetry(connStr, token, app.slug)
        : {
            availability: null, avgResponseMs: null, failedRequests: null,
            totalRequests: null, exceptions: null, activeSessions: null, authFailures: null,
          };

    res.json({
      slug: app.slug,
      displayName: app.displayName,
      description: app.description,
      category: app.category,
      url: app.url,
      status: deriveStatus(telemetry),
      telemetry,
      appInsightsConfigured: !!connStr,
      capturedAt: new Date().toISOString(),
    });
  } catch (err) {
    req.log.error(err, "GET /api/noc/applications/:slug failed");
    res.status(500).json({ message: "Internal server error" });
  }
});

export default router;
