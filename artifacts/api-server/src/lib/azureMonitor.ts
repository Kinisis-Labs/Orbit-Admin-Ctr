import { MetricsQueryClient, LogsQueryClient } from "@azure/monitor-query";
import { ResourceGraphClient } from "@azure/arm-resourcegraph";
import { getAzureCredential, getSubscriptionIds, isAzureConfigured } from "./azure.js";
import { normalizeResourceGraphRows } from "./azureNetwork.js";
import type { AppRecord } from "../routes/orbit.js";

export type TelemetrySummary = {
  requestsPerMin: number;
  p95LatencyMs: number;
  /** True when the value came from a real KQL percentile query; false when it is an avg × 1.4 estimate. */
  p95LatencyIsReal: boolean;
  errorRatePercent: number;
  availabilityPercent: number;
};

export type TimeSeriesPoint = {
  timestamp: string;
  value: number;
};

let _metricsClient: MetricsQueryClient | null = null;
let _logsClient: LogsQueryClient | null = null;
let _graphClient: ResourceGraphClient | null = null;

function getMetricsClient(): MetricsQueryClient {
  if (!_metricsClient) {
    _metricsClient = new MetricsQueryClient(getAzureCredential());
  }
  return _metricsClient;
}

function getLogsClient(): LogsQueryClient {
  if (!_logsClient) {
    _logsClient = new LogsQueryClient(getAzureCredential());
  }
  return _logsClient;
}

function getGraphClient(): ResourceGraphClient {
  if (!_graphClient) {
    _graphClient = new ResourceGraphClient(getAzureCredential());
  }
  return _graphClient;
}

/**
 * The Log Analytics workspace customer ID (GUID shown as "Workspace ID" in the
 * Azure portal). Required for queryWorkspace(); set AZURE_LOG_ANALYTICS_WORKSPACE_ID
 * on the Container App alongside AZURE_CLIENT_ID / AZURE_TENANT_ID.
 */
export function getLogAnalyticsWorkspaceId(): string | null {
  return process.env.AZURE_LOG_ANALYTICS_WORKSPACE_ID?.trim() || null;
}

/**
 * Returns true when both base Azure credentials and the Log Analytics workspace
 * ID are configured. Controls the live time-series path.
 */
export function isMonitorConfigured(): boolean {
  return isAzureConfigured() && Boolean(getLogAnalyticsWorkspaceId());
}

/**
 * KQL query factories by metric name.
 *
 * Each factory receives the App Insights component resource ID and the lookback
 * window (hours), and returns KQL that produces exactly two columns —
 * `timestamp` (datetime) and `value` (real) — ordered ascending.
 *
 * The `_ResourceId =~ resourceId` filter scopes every query to a single App
 * Insights component even though the query runs against a shared workspace,
 * ensuring app A and app B never bleed into each other's charts.
 *
 * KQL notes:
 * - requests.duration is a timespan; `duration / 1ms` converts it to a real
 *   in milliseconds — the idiomatic KQL timespan-to-number idiom.
 * - performanceCounters category+counter selects percentage values only,
 *   never raw byte counts.
 */
const METRIC_QUERIES: Record<
  string,
  (resourceId: string, hours: number) => string
> = {
  requests_per_min: (resourceId, hours) => `
    requests
    | where _ResourceId =~ '${resourceId}'
    | where timestamp >= ago(${hours}h)
    | summarize value = count() / 60.0 by bin(timestamp, 1h)
    | order by timestamp asc
  `,
  p95_latency_ms: (resourceId, hours) => `
    requests
    | where _ResourceId =~ '${resourceId}'
    | where timestamp >= ago(${hours}h)
    | summarize value = percentile(duration / 1ms, 95) by bin(timestamp, 1h)
    | order by timestamp asc
  `,
  error_rate_pct: (resourceId, hours) => `
    requests
    | where _ResourceId =~ '${resourceId}'
    | where timestamp >= ago(${hours}h)
    | summarize value = 100.0 * countif(success == false) / count() by bin(timestamp, 1h)
    | order by timestamp asc
  `,
  cpu_pct: (resourceId, hours) => `
    performanceCounters
    | where _ResourceId =~ '${resourceId}'
    | where timestamp >= ago(${hours}h)
    | where category == "Processor" and counter == "% Processor Time"
    | summarize value = avg(value) by bin(timestamp, 1h)
    | order by timestamp asc
  `,
  memory_pct: (resourceId, hours) => `
    performanceCounters
    | where _ResourceId =~ '${resourceId}'
    | where timestamp >= ago(${hours}h)
    | where category == "Memory" and counter == "% Committed Bytes In Use"
    | summarize value = avg(value) by bin(timestamp, 1h)
    | order by timestamp asc
  `,
  // Disk Transfers/sec (reads + writes combined) from the _Total logical disk
  // instance. Aggregated as average over each hourly bucket.
  disk_iops: (resourceId, hours) => `
    performanceCounters
    | where _ResourceId =~ '${resourceId}'
    | where timestamp >= ago(${hours}h)
    | where category == "LogicalDisk" and counter == "Disk Transfers/sec" and instance == "_Total"
    | summarize value = avg(value) by bin(timestamp, 1h)
    | order by timestamp asc
  `,
  // Network bytes received per second, converted to MB/s (÷ 1 048 576).
  // Uses the first NIC interface found; summed across interfaces if multiple.
  network_ingress_mbps: (resourceId, hours) => `
    performanceCounters
    | where _ResourceId =~ '${resourceId}'
    | where timestamp >= ago(${hours}h)
    | where category == "Network Interface" and counter == "Bytes Received/sec"
    | summarize value = avg(value) / (1024.0 * 1024.0) by bin(timestamp, 1h)
    | order by timestamp asc
  `,
  // Network bytes sent per second, converted to MB/s.
  network_egress_mbps: (resourceId, hours) => `
    performanceCounters
    | where _ResourceId =~ '${resourceId}'
    | where timestamp >= ago(${hours}h)
    | where category == "Network Interface" and counter == "Bytes Sent/sec"
    | summarize value = avg(value) / (1024.0 * 1024.0) by bin(timestamp, 1h)
    | order by timestamp asc
  `,
  // P95 browser page-load time per hour (ms) from the browserTimings table.
  // totalDuration includes network + server + DOM processing time as tracked by
  // the App Insights browser SDK.
  browser_page_load_p95: (resourceId, hours) => `
    browserTimings
    | where _ResourceId =~ '${resourceId}'
    | where timestamp >= ago(${hours}h)
    | summarize value = percentile(totalDuration, 95) by bin(timestamp, 1h)
    | order by timestamp asc
  `,
  // Browser-side JS exception count per hour (exceptions where client_Type = Browser).
  browser_exception_rate: (resourceId, hours) => `
    exceptions
    | where _ResourceId =~ '${resourceId}'
    | where timestamp >= ago(${hours}h)
    | where client_Type == "Browser"
    | summarize value = count() by bin(timestamp, 1h)
    | order by timestamp asc
  `,
  // Browser page views per hour from the pageViews table, scoped by _ResourceId.
  // Each row in pageViews represents a single page navigation tracked by the
  // App Insights browser SDK; counting by hourly bin gives a traffic volume trend.
  browser_page_views: (resourceId, hours) => `
    pageViews
    | where _ResourceId =~ '${resourceId}'
    | where timestamp >= ago(${hours}h)
    | summarize value = count() by bin(timestamp, 1h)
    | order by timestamp asc
  `,
};

// Cache resolved App Insights resource IDs per app to avoid repeated Resource
// Graph queries when multiple metrics are fetched in parallel for the same app.
// Entries carry an expiry timestamp so stale null results (e.g. component not
// yet deployed, or temporarily unavailable) self-heal without a server restart.
type AppInsightsCacheEntry = { id: string | null; expiresAt: number };
/** @internal Exported for unit tests only — do not use in production code. */
export const _appInsightsIdCache = new Map<string, AppInsightsCacheEntry>();

/** TTL for a cache entry whose Resource Graph query returned a valid resource ID. */
const APP_INSIGHTS_ID_TTL_MS = 60 * 60 * 1000; // 60 minutes
/** TTL for a cache entry whose Resource Graph query returned null (not found / error). */
const APP_INSIGHTS_NULL_TTL_MS = 2 * 60 * 1000; // 2 minutes

// Shared TTL for all in-process caches (5 minutes).
const METRICS_CACHE_TTL_MS = 5 * 60 * 1000;

// Cache: "resourceId:metricName:hours" → { result, fetchedAt, expiresAt }
type TimeSeriesCacheEntry = { result: TimeSeriesPoint[]; fetchedAt: number; expiresAt: number };
/** @internal Exported for unit tests only — do not use in production code. */
export const _timeSeriesCache = new Map<string, TimeSeriesCacheEntry>();

/**
 * Evict all `_timeSeriesCache` entries associated with `appId` by resolving
 * the cached App Insights resource ID first, then deleting every cache key
 * that starts with that resource ID.
 *
 * Must be called **before** clearing `_appInsightsIdCache` for the same app —
 * once the resource-ID entry is gone the scan has nothing to match against.
 *
 * Safe to call when the app has no cached resource ID (no-op in that case).
 *
 * @internal Also exported so the force-refresh route can call it directly
 *   without going through the full `fetchAppTimeSeries` path.
 */
export function evictAppTimeSeries(appId: string): void {
  const cachedEntry = _appInsightsIdCache.get(appId);
  const cachedResourceId = cachedEntry?.id;
  if (!cachedResourceId) return;
  const prefix = `${cachedResourceId}:`;
  for (const key of _timeSeriesCache.keys()) {
    if (key.startsWith(prefix)) {
      _timeSeriesCache.delete(key);
    }
  }
}

/**
 * Resolve the Application Insights component resource ID for the app's RG.
 * Returns null if none found. Result is cached in-process.
 * Pass `bypassCache: true` to force a fresh Resource Graph lookup.
 */
export async function resolveAppInsightsResourceId(
  app: AppRecord,
  { bypassCache = false }: { bypassCache?: boolean } = {},
): Promise<string | null> {
  if (bypassCache) {
    _appInsightsIdCache.delete(app.id);
  } else {
    const entry = _appInsightsIdCache.get(app.id);
    if (entry && Date.now() < entry.expiresAt) {
      return entry.id;
    }
    // Entry missing or expired — fall through to a fresh lookup.
    if (entry) _appInsightsIdCache.delete(app.id);
  }

  // Include the app's own subscription so App Insights is found even when
  // an app lives in a dedicated sub not listed in AZURE_SUBSCRIPTION_IDS.
  // Filter to valid GUIDs only — placeholder strings (e.g. "a1f4-shared-platform")
  // cause Resource Graph to reject the entire request with a 400 error.
  const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const globalSubs = getSubscriptionIds().filter((s) => GUID_RE.test(s));
  const appSub = app.subscriptionId && GUID_RE.test(app.subscriptionId) ? app.subscriptionId : null;
  const subscriptionIds = appSub
    ? [...new Set([...globalSubs, appSub])]
    : globalSubs;
  if (subscriptionIds.length === 0) {
    _appInsightsIdCache.set(app.id, { id: null, expiresAt: Date.now() + APP_INSIGHTS_NULL_TTL_MS });
    return null;
  }
  const rg = app.resourceGroup.toLowerCase();

  const query = `
    resources
    | where resourceGroup =~ '${rg}'
    | where type =~ 'microsoft.insights/components'
    | project id
    | limit 1
  `;

  try {
    const result = await getGraphClient().resources({
      query,
      subscriptions: subscriptionIds,
    });
    const rows = normalizeResourceGraphRows(result.data);
    const id = rows.length === 0 ? null : String(rows[0]?.["id"] ?? "");
    const ttl = id !== null ? APP_INSIGHTS_ID_TTL_MS : APP_INSIGHTS_NULL_TTL_MS;
    _appInsightsIdCache.set(app.id, { id, expiresAt: Date.now() + ttl });
    return id;
  } catch {
    _appInsightsIdCache.set(app.id, { id: null, expiresAt: Date.now() + APP_INSIGHTS_NULL_TTL_MS });
    return null;
  }
}

/**
 * Query a single time-series metric from the Log Analytics workspace, scoped
 * to a specific Application Insights component via a `_ResourceId` filter.
 *
 * Runs via LogsQueryClient.queryWorkspace() using AZURE_LOG_ANALYTICS_WORKSPACE_ID.
 * The `resourceId` parameter is the Azure resource ID of the App Insights component
 * — this ensures results are app-specific even in a shared workspace.
 *
 * @param resourceId - Azure resource ID of the Application Insights component
 * @param metricName - One of the keys in METRIC_QUERIES
 * @param hours      - Lookback window in hours (returns hourly buckets)
 * @returns Array of {timestamp, value} points ordered asc, or null when:
 *   - Monitor is not configured (workspace ID or Azure creds missing)
 *   - The metric name is unknown
 *   - The query returns zero rows or all-NaN values
 *   - Any error occurs (all errors are suppressed; callers use mock fallback)
 */
export async function fetchMetricTimeSeries(
  resourceId: string,
  metricName: string,
  hours: number,
  { bypassCache = false }: { bypassCache?: boolean } = {},
): Promise<TimeSeriesPoint[] | null> {
  // Evict before the configuration gate so a force-refresh always clears the
  // stale entry, even when Monitor is temporarily unconfigured or in tests.
  const cacheKey = `${resourceId}:${metricName}:${hours}`;
  if (bypassCache) {
    _timeSeriesCache.delete(cacheKey);
  }

  if (!isMonitorConfigured()) return null;

  const queryFn = METRIC_QUERIES[metricName];
  if (!queryFn) return null;

  if (!bypassCache) {
    const entry = _timeSeriesCache.get(cacheKey);
    if (entry && entry.expiresAt > Date.now()) {
      return entry.result;
    }
  }

  const workspaceId = getLogAnalyticsWorkspaceId()!;

  try {
    const result = await getLogsClient().queryWorkspace(
      workspaceId,
      queryFn(resourceId, hours),
      { duration: `PT${hours}H` },
    );

    if (result.status !== "Success") return null;
    const table = result.tables?.[0];
    if (!table) return null;

    const cols = table.columnDescriptors as Array<{ name?: string }>;
    const tsIdx = cols.findIndex((c) => c.name === "timestamp");
    const valIdx = cols.findIndex((c) => c.name === "value");
    if (tsIdx === -1 || valIdx === -1) return null;

    const points = (table.rows as unknown[][]).map((row) => ({
      timestamp: String(row[tsIdx]),
      value: Number(Number(row[valIdx]).toFixed(2)),
    }));

    // Treat empty results or all-NaN values as unavailable so callers fall back
    // to seeded mock series rather than rendering empty / broken charts.
    if (points.length === 0) return null;
    if (points.every((p) => !isFinite(p.value))) return null;

    _timeSeriesCache.set(cacheKey, { result: points, fetchedAt: Date.now(), expiresAt: Date.now() + METRICS_CACHE_TTL_MS });
    return points;
  } catch {
    return null;
  }
}

export type TopException = {
  message: string;
  count: number;
  lastSeen: string;
};

// Cache: "appId:hours:limit" → { result, fetchedAt, expiresAt }
type TopExceptionsCacheEntry = { result: TopException[]; fetchedAt: number; expiresAt: number };

/** @internal Exported for unit tests only — do not use in production code. */
export const _topExceptionsCache = new Map<string, TopExceptionsCacheEntry>();

/**
 * Build the cache key for a top-exceptions lookup. Exported so tests can
 * verify that the key used at write-time and at eviction-time are identical.
 *
 * Key scheme: `"${appId}:${hours}:${limit}"`
 */
export function buildTopExceptionsCacheKey(
  appId: string,
  hours: number,
  limit: number,
): string {
  return `${appId}:${hours}:${limit}`;
}

/**
 * Query the top N exceptions (by count) from the Application Insights `exceptions`
 * table over the last `hours` hours, scoped to a specific App Insights component
 * via `_ResourceId`.
 *
 * Returns up to `limit` exceptions ordered by count descending, or null when:
 *   - Monitor is not configured
 *   - No App Insights component is found for the app
 *   - The query returns zero rows
 *   - Any error occurs (all errors are suppressed; callers fall back to mock data)
 */
export async function fetchTopExceptions(
  app: AppRecord,
  {
    hours = 24,
    limit = 5,
    bypassCache = false,
  }: { hours?: number; limit?: number; bypassCache?: boolean } = {},
): Promise<TopException[] | null> {
  const cacheKey = buildTopExceptionsCacheKey(app.id, hours, limit);

  // Evict before the configuration gate so a force-refresh always clears the
  // stale entry, even when Monitor is temporarily unconfigured or in tests.
  if (bypassCache) {
    _topExceptionsCache.delete(cacheKey);
  }

  if (!isMonitorConfigured()) return null;

  if (!bypassCache) {
    const entry = _topExceptionsCache.get(cacheKey);
    if (entry && entry.expiresAt > Date.now()) {
      return entry.result;
    }
  }

  const resourceId = await resolveAppInsightsResourceId(app, { bypassCache });
  if (!resourceId) return null;

  const workspaceId = getLogAnalyticsWorkspaceId()!;

  const kql = `
    exceptions
    | where _ResourceId =~ '${resourceId}'
    | where timestamp >= ago(${hours}h)
    | summarize count = count(), lastSeen = max(timestamp) by type, outerMessage
    | top ${limit} by count desc
    | project message = strcat(type, ': ', outerMessage), count, lastSeen
    | order by count desc
  `;

  try {
    const result = await getLogsClient().queryWorkspace(
      workspaceId,
      kql,
      { duration: `PT${hours}H` },
    );

    if (result.status !== "Success") return null;
    const table = result.tables?.[0];
    if (!table) return null;

    const cols = table.columnDescriptors as Array<{ name?: string }>;
    const msgIdx = cols.findIndex((c) => c.name === "message");
    const cntIdx = cols.findIndex((c) => c.name === "count");
    const lsIdx = cols.findIndex((c) => c.name === "lastSeen");
    if (msgIdx === -1 || cntIdx === -1 || lsIdx === -1) return null;

    const rows = table.rows as unknown[][];
    if (rows.length === 0) return null;

    const exceptions: TopException[] = rows.map((row) => ({
      message: String(row[msgIdx] ?? ""),
      count: Number(row[cntIdx] ?? 0),
      lastSeen: String(row[lsIdx] ?? new Date().toISOString()),
    }));

    _topExceptionsCache.set(cacheKey, {
      result: exceptions,
      fetchedAt: Date.now(),
      expiresAt: Date.now() + METRICS_CACHE_TTL_MS,
    });
    return exceptions;
  } catch {
    return null;
  }
}

export type BrowserTelemetrySummary = {
  pageLoadP95Ms: number;
  pageLoadP95IsReal: boolean;
  browserExceptionsPerHour: number;
  pageViewsPerHour: number;
  topSlowPages: Array<{ name: string; p95Ms: number; count: number }>;
  topFailingUrls: Array<{ url: string; failureCount: number; failureRate: number }>;
};

// Cache: appId → { result, fetchedAt, expiresAt }
type BrowserTelemetryCacheEntry = {
  result: BrowserTelemetrySummary;
  fetchedAt: number;
  expiresAt: number;
};
/** @internal Exported for unit tests only — do not use in production code. */
export const _browserTelemetryCache = new Map<string, BrowserTelemetryCacheEntry>();

/**
 * Fetch client-side (browser) telemetry from App Insights via Log Analytics KQL.
 *
 * Queries three tables scoped to the app's App Insights component:
 *  - `browserTimings`     — P95 page-load time (last 1 h + top slow pages last 24 h)
 *  - `exceptions`         — browser-side exceptions (last 1 h)
 *  - `pageViews`          — page-view count (last 1 h)
 *  - `dependencies`       — AJAX calls that failed (last 24 h, top failing URLs)
 *
 * All queries run in parallel. Each is fault-tolerant: if one fails the others
 * still contribute to the result. Returns null when Monitor is not configured or
 * no App Insights component is found. The result is cached for METRICS_CACHE_TTL_MS.
 */
export async function fetchBrowserTelemetry(
  app: AppRecord,
  { bypassCache = false }: { bypassCache?: boolean } = {},
): Promise<BrowserTelemetrySummary | null> {
  if (bypassCache) {
    _browserTelemetryCache.delete(app.id);
  }

  if (!isMonitorConfigured()) return null;

  if (!bypassCache) {
    const entry = _browserTelemetryCache.get(app.id);
    if (entry && entry.expiresAt > Date.now()) {
      return entry.result;
    }
  }

  const resourceId = await resolveAppInsightsResourceId(app, { bypassCache });
  if (!resourceId) return null;

  const workspaceId = getLogAnalyticsWorkspaceId()!;

  const kqlPageLoadP95 = `
    browserTimings
    | where _ResourceId =~ '${resourceId}'
    | where timestamp >= ago(1h)
    | summarize p95 = percentile(totalDuration, 95)
  `;

  const kqlBrowserExceptions = `
    exceptions
    | where _ResourceId =~ '${resourceId}'
    | where timestamp >= ago(1h)
    | where client_Type == "Browser"
    | count
  `;

  const kqlPageViews = `
    pageViews
    | where _ResourceId =~ '${resourceId}'
    | where timestamp >= ago(1h)
    | count
  `;

  const kqlTopSlowPages = `
    browserTimings
    | where _ResourceId =~ '${resourceId}'
    | where timestamp >= ago(24h)
    | summarize p95Ms = percentile(totalDuration, 95), count = count() by name
    | top 5 by p95Ms desc
    | project name, p95Ms, count
  `;

  const kqlTopFailingUrls = `
    dependencies
    | where _ResourceId =~ '${resourceId}'
    | where timestamp >= ago(24h)
    | where client_Type == "Browser"
    | where success == false
    | summarize failureCount = count() by target
    | join kind=leftouter (
        dependencies
        | where _ResourceId =~ '${resourceId}'
        | where timestamp >= ago(24h)
        | where client_Type == "Browser"
        | summarize total = count() by target
      ) on target
    | extend failureRate = round(100.0 * failureCount / (total + 0.0), 2)
    | top 5 by failureCount desc
    | project url = target, failureCount, failureRate
  `;

  const runQuery = async (kql: string, duration: string) => {
    try {
      return await getLogsClient().queryWorkspace(workspaceId, kql, { duration });
    } catch {
      return null;
    }
  };

  const [resP95, resExc, resPv, resSlowPages, resFailingUrls] = await Promise.all([
    runQuery(kqlPageLoadP95, "PT1H"),
    runQuery(kqlBrowserExceptions, "PT1H"),
    runQuery(kqlPageViews, "PT1H"),
    runQuery(kqlTopSlowPages, "PT24H"),
    runQuery(kqlTopFailingUrls, "PT24H"),
  ]);

  // --- Parse page load P95 ---
  let pageLoadP95Ms = 0;
  let pageLoadP95IsReal = false;
  if (resP95?.status === "Success") {
    const table = resP95.tables?.[0];
    if (table) {
      const cols = table.columnDescriptors as Array<{ name?: string }>;
      const idx = cols.findIndex((c) => c.name === "p95");
      const rows = table.rows as unknown[][];
      if (idx !== -1 && rows.length > 0) {
        const val = Number(rows[0]?.[idx]);
        if (isFinite(val) && val > 0) {
          pageLoadP95Ms = Number(val.toFixed(0));
          pageLoadP95IsReal = true;
        }
      }
    }
  }

  // --- Parse browser exceptions per hour ---
  let browserExceptionsPerHour = 0;
  if (resExc?.status === "Success") {
    const table = resExc.tables?.[0];
    if (table) {
      const rows = table.rows as unknown[][];
      if (rows.length > 0) {
        const val = Number(rows[0]?.[0]);
        if (isFinite(val)) browserExceptionsPerHour = val;
      }
    }
  }

  // --- Parse page views per hour ---
  let pageViewsPerHour = 0;
  if (resPv?.status === "Success") {
    const table = resPv.tables?.[0];
    if (table) {
      const rows = table.rows as unknown[][];
      if (rows.length > 0) {
        const val = Number(rows[0]?.[0]);
        if (isFinite(val)) pageViewsPerHour = val;
      }
    }
  }

  // --- Parse top slow pages ---
  const topSlowPages: BrowserTelemetrySummary["topSlowPages"] = [];
  if (resSlowPages?.status === "Success") {
    const table = resSlowPages.tables?.[0];
    if (table) {
      const cols = table.columnDescriptors as Array<{ name?: string }>;
      const nameIdx = cols.findIndex((c) => c.name === "name");
      const p95Idx = cols.findIndex((c) => c.name === "p95Ms");
      const cntIdx = cols.findIndex((c) => c.name === "count");
      for (const row of table.rows as unknown[][]) {
        if (nameIdx === -1 || p95Idx === -1 || cntIdx === -1) break;
        topSlowPages.push({
          name: String(row[nameIdx] ?? ""),
          p95Ms: Number(Number(row[p95Idx] ?? 0).toFixed(0)),
          count: Number(row[cntIdx] ?? 0),
        });
      }
    }
  }

  // --- Parse top failing URLs ---
  const topFailingUrls: BrowserTelemetrySummary["topFailingUrls"] = [];
  if (resFailingUrls?.status === "Success") {
    const table = resFailingUrls.tables?.[0];
    if (table) {
      const cols = table.columnDescriptors as Array<{ name?: string }>;
      const urlIdx = cols.findIndex((c) => c.name === "url");
      const fcIdx = cols.findIndex((c) => c.name === "failureCount");
      const frIdx = cols.findIndex((c) => c.name === "failureRate");
      for (const row of table.rows as unknown[][]) {
        if (urlIdx === -1 || fcIdx === -1 || frIdx === -1) break;
        topFailingUrls.push({
          url: String(row[urlIdx] ?? ""),
          failureCount: Number(row[fcIdx] ?? 0),
          failureRate: Number(Number(row[frIdx] ?? 0).toFixed(2)),
        });
      }
    }
  }

  const summary: BrowserTelemetrySummary = {
    pageLoadP95Ms,
    pageLoadP95IsReal,
    browserExceptionsPerHour,
    pageViewsPerHour,
    topSlowPages,
    topFailingUrls,
  };

  _browserTelemetryCache.set(app.id, {
    result: summary,
    fetchedAt: Date.now(),
    expiresAt: Date.now() + METRICS_CACHE_TTL_MS,
  });

  return summary;
}

// Cache: app id → { result, fetchedAt, expiresAt }
type MetricsCacheEntry = { result: TelemetrySummary; fetchedAt: number; expiresAt: number };
/** @internal Exported for unit tests only — do not use in production code. */
export const _metricsCache = new Map<string, MetricsCacheEntry>();

/**
 * Returns the epoch-ms timestamp when the metrics summary for `appId` was last
 * fetched from Azure Monitor, or null if the cache is empty.
 */
export function getMetricsFetchedAt(appId: string): number | null {
  return _metricsCache.get(appId)?.fetchedAt ?? null;
}

/**
 * Convenience wrapper for route handlers: resolves the App Insights component
 * resource ID for `app` (via Resource Graph), then calls fetchMetricTimeSeries
 * scoped to that component.
 *
 * Results are cached in-process for METRICS_CACHE_TTL_MS (5 min). Pass
 * `bypassCache: true` to skip the cache and force a fresh Log Analytics query
 * (the fresh result is still written back to the cache).
 *
 * Returns null when monitor is not configured, no App Insights component is
 * found in the app's resource group, or the underlying query fails.
 */
export async function fetchAppTimeSeries(
  app: AppRecord,
  metricName: string,
  hours: number,
  { bypassCache = false }: { bypassCache?: boolean } = {},
): Promise<TimeSeriesPoint[] | null> {
  if (!isMonitorConfigured()) return null;

  // When bypassing, evict all _timeSeriesCache entries for this app before
  // resolveAppInsightsResourceId clears the ID cache. evictAppTimeSeries uses
  // the still-present resource-ID entry to find and delete every metric/hours
  // variant for this app, so the scan is never skipped due to a missing ID.
  if (bypassCache) {
    evictAppTimeSeries(app.id);
  }

  const resourceId = await resolveAppInsightsResourceId(app, { bypassCache });
  if (!resourceId) return null;
  return fetchMetricTimeSeries(resourceId, metricName, hours, { bypassCache });
}

/**
 * Fetch telemetry summary metrics for the past hour from Azure Monitor.
 * Looks up the Application Insights component in the app's RG, then queries:
 *   - requests/count (total over 1h → /min)
 *   - requests/failed (for error rate)
 *   - requests/duration (average, used as fallback only)
 *   - availabilityResults/availabilityPercentage
 *   - percentile(duration, 95) via LogsQueryClient KQL (when AZURE_LOG_ANALYTICS_WORKSPACE_ID
 *     is set); falls back to average × 1.4 when Log Analytics is not configured.
 *
 * Results are cached in-process for METRICS_CACHE_TTL_MS (5 min). Pass
 * `bypassCache: true` to skip the cache and force a fresh API call (the fresh
 * result is still written back to the cache).
 *
 * Returns null when not configured, no App Insights found, or on any error.
 */
export async function fetchAppMetrics(
  app: AppRecord,
  { bypassCache = false }: { bypassCache?: boolean } = {},
): Promise<TelemetrySummary | null> {
  // Evict before the configuration gate so a force-refresh always clears the
  // stale entry, even when Azure is temporarily unconfigured or in tests.
  if (bypassCache) {
    _metricsCache.delete(app.id);
  }

  if (!isAzureConfigured()) return null;

  if (!bypassCache) {
    const entry = _metricsCache.get(app.id);
    if (entry && entry.expiresAt > Date.now()) {
      return entry.result;
    }
  }

  const resourceId = await resolveAppInsightsResourceId(app);
  if (!resourceId) return null;

  const duration = "PT1H";

  try {
    const result = await getMetricsClient().queryResource(
      resourceId,
      [
        "requests/count",
        "requests/failed",
        "requests/duration",
        "availabilityResults/availabilityPercentage",
      ],
      { granularity: duration, timespan: { duration } },
    );

    let totalRequests = 0;
    let failedRequests = 0;
    let avgDurationMs = 0;
    let availabilityPct = 99.9;

    for (const metric of result.metrics) {
      const name = metric.name.toLowerCase();
      const timeseries = metric.timeseries?.[0];
      const point = timeseries?.data?.[0];
      if (!point) continue;

      if (name.includes("requests/count")) {
        totalRequests = point.total ?? point.average ?? 0;
      } else if (name.includes("requests/failed")) {
        failedRequests = point.total ?? point.average ?? 0;
      } else if (name.includes("requests/duration")) {
        avgDurationMs = point.average ?? 0;
      } else if (name.includes("availabilitypercentage")) {
        availabilityPct = point.average ?? 99.9;
      }
    }

    const requestsPerMin = Number((totalRequests / 60).toFixed(0));
    const errorRatePercent =
      totalRequests > 0
        ? Number(((failedRequests / totalRequests) * 100).toFixed(2))
        : 0;

    // Try to get a real P95 from Log Analytics. Falls back to the average × 1.4
    // approximation when the workspace is not configured or the query fails.
    let p95LatencyMs = Number((avgDurationMs * 1.4).toFixed(0));
    let p95LatencyIsReal = false;
    if (isMonitorConfigured()) {
      try {
        const workspaceId = getLogAnalyticsWorkspaceId()!;
        const kql = `
          requests
          | where _ResourceId =~ '${resourceId}'
          | where timestamp >= ago(1h)
          | summarize p95 = percentile(duration / 1ms, 95)
        `;
        const logsResult = await getLogsClient().queryWorkspace(
          workspaceId,
          kql,
          { duration: "PT1H" },
        );
        if (logsResult.status === "Success") {
          const table = logsResult.tables?.[0];
          if (table) {
            const cols = table.columnDescriptors as Array<{ name?: string }>;
            const p95Idx = cols.findIndex((c) => c.name === "p95");
            const rows = table.rows as unknown[][];
            if (p95Idx !== -1 && rows.length > 0) {
              const val = Number(rows[0][p95Idx]);
              if (isFinite(val) && val > 0) {
                p95LatencyMs = Number(val.toFixed(0));
                p95LatencyIsReal = true;
              }
            }
          }
        }
      } catch {
        // Keep the approximation already set above.
      }
    }

    const summary: TelemetrySummary = {
      requestsPerMin,
      p95LatencyMs,
      p95LatencyIsReal,
      errorRatePercent,
      availabilityPercent: Number(availabilityPct.toFixed(2)),
    };
    _metricsCache.set(app.id, { result: summary, fetchedAt: Date.now(), expiresAt: Date.now() + METRICS_CACHE_TTL_MS });
    return summary;
  } catch {
    return null;
  }
}
