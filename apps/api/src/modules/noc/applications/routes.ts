import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../../../middlewares/auth.js";
import { db } from "../../../lib/db.js";
import { applicationsTable } from "@workspace/db";

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

async function getAppInsightsTelemetry(connectionString: string): Promise<AppTelemetry> {
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
    const match = connectionString.match(/InstrumentationKey=([^;]+)/i);
    const key = match?.[1];
    if (!key) return empty;

    const baseUrl = `https://api.applicationinsights.io/v1/apps/${key}/metrics`;
    const timespan = "PT24H";

    const results = await Promise.allSettled([
      fetch(`${baseUrl}/availabilityResults/availabilityPercentage?timespan=${timespan}`, { headers: { "x-api-key": key } }),
      fetch(`${baseUrl}/requests/duration?timespan=${timespan}&aggregation=avg`, { headers: { "x-api-key": key } }),
      fetch(`${baseUrl}/requests/failed?timespan=${timespan}&aggregation=count`, { headers: { "x-api-key": key } }),
      fetch(`${baseUrl}/requests/count?timespan=${timespan}&aggregation=count`, { headers: { "x-api-key": key } }),
      fetch(`${baseUrl}/exceptions/count?timespan=${timespan}&aggregation=count`, { headers: { "x-api-key": key } }),
      fetch(`${baseUrl}/sessions/count?timespan=${timespan}&aggregation=unique`, { headers: { "x-api-key": key } }),
      fetch(`${baseUrl}/customEvents/count?timespan=${timespan}&aggregation=count&$filter=name eq 'authFailure'`, { headers: { "x-api-key": key } }),
    ]);

    type AiResponse = { value?: Record<string, { avg?: number; count?: number; unique?: number; sum?: number }> };

    const extract = (r: PromiseSettledResult<Response>, metricId: string, agg: string): number | null => {
      if (r.status !== "fulfilled") return null;
      return r.value.json().then((d: AiResponse) => {
        const v = d.value?.[metricId];
        return (v?.[agg as keyof typeof v] as number | undefined) ?? null;
      }).catch(() => null) as unknown as number | null;
    };

    const [avail, dur, failed, total, exc, sessions, authFail] = await Promise.all([
      results[0].status === "fulfilled" ? results[0].value.json().then((d: AiResponse) => d.value?.["availabilityResults/availabilityPercentage"]?.avg ?? null).catch(() => null) : null,
      results[1].status === "fulfilled" ? results[1].value.json().then((d: AiResponse) => d.value?.["requests/duration"]?.avg ?? null).catch(() => null) : null,
      results[2].status === "fulfilled" ? results[2].value.json().then((d: AiResponse) => d.value?.["requests/failed"]?.count ?? null).catch(() => null) : null,
      results[3].status === "fulfilled" ? results[3].value.json().then((d: AiResponse) => d.value?.["requests/count"]?.count ?? null).catch(() => null) : null,
      results[4].status === "fulfilled" ? results[4].value.json().then((d: AiResponse) => d.value?.["exceptions/count"]?.count ?? null).catch(() => null) : null,
      results[5].status === "fulfilled" ? results[5].value.json().then((d: AiResponse) => d.value?.["sessions/count"]?.unique ?? null).catch(() => null) : null,
      results[6].status === "fulfilled" ? results[6].value.json().then((d: AiResponse) => d.value?.["customEvents/count"]?.count ?? null).catch(() => null) : null,
    ]);

    void extract;

    return {
      availability: avail as number | null,
      avgResponseMs: dur as number | null,
      failedRequests: failed as number | null,
      totalRequests: total as number | null,
      exceptions: exc as number | null,
      activeSessions: sessions as number | null,
      authFailures: authFail as number | null,
    };
  } catch {
    return empty;
  }
}

function deriveStatus(telemetry: AppTelemetry): "healthy" | "degraded" | "unhealthy" | "unknown" {
  if (telemetry.availability === null && telemetry.avgResponseMs === null) return "unknown";
  if (telemetry.availability !== null && telemetry.availability < 95) return "unhealthy";
  if (telemetry.availability !== null && telemetry.availability < 99) return "degraded";
  return "healthy";
}

function getAppInsightsConnStr(): string | undefined {
  return process.env.APPINSIGHTS_CONNECTION_STRING;
}

// ── Routes ────────────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 2 * 60 * 1000;
let cachedApps: unknown = null;
let cacheExpiresAt = 0;

router.get("/noc/applications", requireAuth, requireAdmin, async (req, res) => {
  try {
    const now = Date.now();
    if (cachedApps && now < cacheExpiresAt) {
      res.json(cachedApps);
      return;
    }
    const apps = await db
      .select()
      .from(applicationsTable)
      .where(eq(applicationsTable.enabled, true));

    const connStr = getAppInsightsConnStr();

    const results = await Promise.all(
      apps.map(async (app) => {
        const telemetry = connStr ? await getAppInsightsTelemetry(connStr) : {
          availability: null, avgResponseMs: null, failedRequests: null,
          totalRequests: null, exceptions: null, activeSessions: null, authFailures: null,
        };
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
    cachedApps = payload;
    cacheExpiresAt = Date.now() + CACHE_TTL_MS;
    res.json(payload);
  } catch (err) {
    req.log.error(err, "GET /api/noc/applications failed");
    res.status(500).json({ message: "Internal server error" });
  }
});

router.get("/noc/applications/:slug", requireAuth, requireAdmin, async (req, res) => {
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

    const connStr = getAppInsightsConnStr();
    const telemetry = connStr ? await getAppInsightsTelemetry(connStr) : {
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
