import { Router, type IRouter } from "express";
import { requireAuth, requireAdmin } from "../../../middlewares/auth.js";
import { getAccessToken, isAzureMonitorConfigured } from "../../../lib/azure-monitor.js";
import { logger } from "../../../lib/logger.js";

const router: IRouter = Router();

const CACHE_TTL_MS = 2 * 60 * 1000;
let cachedSnapshot: UXSnapshot | null = null;
let cacheExpiresAt = 0;

// ── Types ──────────────────────────────────────────────────────────────────────

export interface PageLoadMetric {
  page: string;
  p50Ms: number | null;
  p95Ms: number | null;
  p99Ms: number | null;
  sessions: number | null;
}

export interface ApiLatencyRegion {
  region: string;
  avgMs: number | null;
  p95Ms: number | null;
  requestCount: number | null;
  failureRate: number | null;
}

export interface ErrorBucket {
  type: string;
  count: number;
  affectedUsers: number | null;
  sample: string | null;
}

export interface SyntheticResult {
  name: string;
  location: string;
  success: boolean;
  durationMs: number | null;
  lastRunAt: string | null;
}

export interface FailingJourney {
  journey: string;
  failureCount: number;
  affectedUsers: number | null;
  topError: string | null;
}

export interface UXSnapshot {
  portalLoadTimes: PageLoadMetric[];
  apiLatencyByRegion: ApiLatencyRegion[];
  errorDistribution: ErrorBucket[];
  syntheticResults: SyntheticResult[];
  failingJourneys: FailingJourney[];
  overallScore: number | null;
  capturedAt: string;
  appInsightsConfigured: boolean;
}

// ── App Insights query helper ──────────────────────────────────────────────────

function getAppInsightsCredentials(): { appId: string; apiKey: string } | null {
  const connStr = process.env.APPLICATIONINSIGHTS_CONNECTION_STRING ?? process.env.APPINSIGHTS_CONNECTION_STRING;
  if (!connStr) return null;
  const keyMatch = connStr.match(/InstrumentationKey=([^;]+)/i);
  const appIdMatch = connStr.match(/ApplicationId=([^;]+)/i);
  const key = keyMatch?.[1];
  if (!key) return null;
  return { appId: appIdMatch?.[1] ?? key, apiKey: key };
}

async function queryAI(query: string): Promise<unknown[]> {
  const creds = getAppInsightsCredentials();
  if (!creds) return [];
  try {
    const url = `https://api.applicationinsights.io/v1/apps/${creds.appId}/query`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "x-api-key": creds.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
    });
    if (!res.ok) {
      logger.warn({ status: res.status, query: query.slice(0, 80) }, "App Insights query failed");
      return [];
    }
    type AIResponse = { tables?: Array<{ rows?: unknown[][] }> };
    const data = (await res.json()) as AIResponse;
    return data.tables?.[0]?.rows ?? [];
  } catch (err) {
    logger.warn({ err }, "App Insights query threw");
    return [];
  }
}

// ── Data fetchers ──────────────────────────────────────────────────────────────

async function fetchPortalLoadTimes(): Promise<PageLoadMetric[]> {
  const rows = await queryAI(`
    pageViews
    | where timestamp > ago(1h)
    | summarize
        p50=percentile(duration, 50),
        p95=percentile(duration, 95),
        p99=percentile(duration, 99),
        sessions=dcount(session_Id)
      by name
    | top 10 by p95 desc
  `);
  return rows.map((r) => {
    const row = r as (number | string | null)[];
    return {
      page: String(row[0] ?? "Unknown"),
      p50Ms: typeof row[1] === "number" ? Math.round(row[1]) : null,
      p95Ms: typeof row[2] === "number" ? Math.round(row[2]) : null,
      p99Ms: typeof row[3] === "number" ? Math.round(row[3]) : null,
      sessions: typeof row[4] === "number" ? row[4] : null,
    };
  });
}

async function fetchApiLatencyByRegion(): Promise<ApiLatencyRegion[]> {
  const rows = await queryAI(`
    requests
    | where timestamp > ago(1h)
    | extend region = tostring(customDimensions["region"])
    | where isnotempty(region)
    | summarize
        avgMs=avg(duration),
        p95Ms=percentile(duration, 95),
        requestCount=count(),
        failures=countif(success == false)
      by region
    | extend failureRate=round(todouble(failures) / requestCount * 100, 2)
    | top 10 by requestCount desc
  `);

  if (rows.length === 0) {
    const fallback = await queryAI(`
      requests
      | where timestamp > ago(1h)
      | summarize
          avgMs=avg(duration),
          p95Ms=percentile(duration, 95),
          requestCount=count(),
          failures=countif(success == false)
      | extend failureRate=round(todouble(failures) / requestCount * 100, 2)
      | extend region="Global"
    `);
    return fallback.map((r) => {
      const row = r as (number | string | null)[];
      return {
        region: String(row[4] ?? "Global"),
        avgMs: typeof row[0] === "number" ? Math.round(row[0]) : null,
        p95Ms: typeof row[1] === "number" ? Math.round(row[1]) : null,
        requestCount: typeof row[2] === "number" ? row[2] : null,
        failureRate: typeof row[3] === "number" ? row[3] : null,
      };
    });
  }

  return rows.map((r) => {
    const row = r as (number | string | null)[];
    return {
      region: String(row[0] ?? "Unknown"),
      avgMs: typeof row[1] === "number" ? Math.round(row[1]) : null,
      p95Ms: typeof row[2] === "number" ? Math.round(row[2]) : null,
      requestCount: typeof row[3] === "number" ? row[3] : null,
      failureRate: typeof row[5] === "number" ? row[5] : null,
    };
  });
}

async function fetchErrorDistribution(): Promise<ErrorBucket[]> {
  const rows = await queryAI(`
    exceptions
    | where timestamp > ago(1h)
    | summarize
        count=count(),
        affectedUsers=dcount(user_Id),
        sample=any(outerMessage)
      by type
    | top 10 by count desc
  `);
  return rows.map((r) => {
    const row = r as (number | string | null)[];
    return {
      type: String(row[0] ?? "Unknown"),
      count: typeof row[1] === "number" ? row[1] : 0,
      affectedUsers: typeof row[2] === "number" ? row[2] : null,
      sample: typeof row[3] === "string" ? row[3].slice(0, 200) : null,
    };
  });
}

async function fetchSyntheticResults(): Promise<SyntheticResult[]> {
  const rows = await queryAI(`
    availabilityResults
    | where timestamp > ago(1h)
    | summarize
        success=max(toint(success)),
        durationMs=avg(duration),
        lastRunAt=max(timestamp)
      by name, location
    | top 20 by lastRunAt desc
  `);
  return rows.map((r) => {
    const row = r as (number | string | null)[];
    return {
      name: String(row[0] ?? "Unknown"),
      location: String(row[1] ?? "Unknown"),
      success: row[2] === 1,
      durationMs: typeof row[3] === "number" ? Math.round(row[3]) : null,
      lastRunAt: typeof row[4] === "string" ? row[4] : null,
    };
  });
}

async function fetchFailingJourneys(): Promise<FailingJourney[]> {
  const rows = await queryAI(`
    requests
    | where timestamp > ago(1h) and success == false
    | extend journey = strcat(tostring(customDimensions["journey"]))
    | where isnotempty(journey)
    | summarize
        failureCount=count(),
        affectedUsers=dcount(user_Id),
        topError=any(resultCode)
      by journey
    | top 10 by failureCount desc
  `);

  if (rows.length === 0) {
    const fallback = await queryAI(`
      requests
      | where timestamp > ago(1h) and success == false
      | summarize
          failureCount=count(),
          affectedUsers=dcount(user_Id),
          topError=any(resultCode)
        by name
      | top 10 by failureCount desc
    `);
    return fallback.map((r) => {
      const row = r as (number | string | null)[];
      return {
        journey: String(row[0] ?? "Unknown"),
        failureCount: typeof row[1] === "number" ? row[1] : 0,
        affectedUsers: typeof row[2] === "number" ? row[2] : null,
        topError: typeof row[3] === "string" ? row[3] : null,
      };
    });
  }

  return rows.map((r) => {
    const row = r as (number | string | null)[];
    return {
      journey: String(row[0] ?? "Unknown"),
      failureCount: typeof row[1] === "number" ? row[1] : 0,
      affectedUsers: typeof row[2] === "number" ? row[2] : null,
      topError: typeof row[3] === "string" ? row[3] : null,
    };
  });
}

async function computeOverallScore(
  loadTimes: PageLoadMetric[],
  latency: ApiLatencyRegion[],
  errors: ErrorBucket[],
  synthetic: SyntheticResult[],
): Promise<number | null> {
  let score = 100;
  const p95s = loadTimes.map((l) => l.p95Ms).filter((v): v is number => v !== null);
  if (p95s.length > 0) {
    const avgP95 = p95s.reduce((a, b) => a + b, 0) / p95s.length;
    if (avgP95 > 5000) score -= 30;
    else if (avgP95 > 2000) score -= 15;
    else if (avgP95 > 1000) score -= 5;
  }
  const failureRates = latency.map((r) => r.failureRate).filter((v): v is number => v !== null);
  if (failureRates.length > 0) {
    const avgFailure = failureRates.reduce((a, b) => a + b, 0) / failureRates.length;
    if (avgFailure > 10) score -= 30;
    else if (avgFailure > 5) score -= 15;
    else if (avgFailure > 1) score -= 5;
  }
  const totalErrors = errors.reduce((a, b) => a + b.count, 0);
  if (totalErrors > 500) score -= 20;
  else if (totalErrors > 100) score -= 10;
  else if (totalErrors > 10) score -= 5;
  if (synthetic.length > 0) {
    const failedSynthetic = synthetic.filter((s) => !s.success).length;
    const failRate = failedSynthetic / synthetic.length;
    if (failRate > 0.5) score -= 20;
    else if (failRate > 0.2) score -= 10;
    else if (failRate > 0) score -= 5;
  }
  return Math.max(0, score);
}


// ── Route ──────────────────────────────────────────────────────────────────────

router.get("/ux", requireAuth, requireAdmin, async (req, res) => {
  try {
    const forceRefresh = req.query.refresh === "1";
    const now = Date.now();
    const appInsightsConfigured = !!getAppInsightsCredentials();

    if (!forceRefresh && cachedSnapshot && now < cacheExpiresAt) {
      res.json(cachedSnapshot);
      return;
    }

    const [portalLoadTimes, apiLatencyByRegion, errorDistribution, syntheticResults, failingJourneys] =
      await Promise.all([
        fetchPortalLoadTimes(),
        fetchApiLatencyByRegion(),
        fetchErrorDistribution(),
        fetchSyntheticResults(),
        fetchFailingJourneys(),
      ]);

    const overallScore = await computeOverallScore(
      portalLoadTimes,
      apiLatencyByRegion,
      errorDistribution,
      syntheticResults,
    );

    const snapshot: UXSnapshot = {
      portalLoadTimes,
      apiLatencyByRegion,
      errorDistribution,
      syntheticResults,
      failingJourneys,
      overallScore,
      capturedAt: new Date().toISOString(),
      appInsightsConfigured,
    };

    cachedSnapshot = snapshot;
    cacheExpiresAt = now + CACHE_TTL_MS;

    res.json(snapshot);
  } catch (err) {
    logger.error({ err }, "GET /api/noc/ux failed");
    res.status(500).json({ error: "Failed to fetch UX metrics" });
  }
});

export default router;
