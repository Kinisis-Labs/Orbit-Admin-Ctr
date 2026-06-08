import { MetricsQueryClient, LogsQueryClient } from "@azure/monitor-query";
import { ResourceGraphClient } from "@azure/arm-resourcegraph";
import { getAzureCredential, getSubscriptionIds, isAzureConfigured } from "./azure.js";
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
};

// Cache resolved App Insights resource IDs per app to avoid repeated Resource
// Graph queries when multiple metrics are fetched in parallel for the same app.
const _appInsightsIdCache = new Map<string, string | null>();

// Shared TTL for all in-process caches (5 minutes).
const METRICS_CACHE_TTL_MS = 5 * 60 * 1000;

// Cache: "resourceId:metricName:hours" → { result, expiresAt }
type TimeSeriesCacheEntry = { result: TimeSeriesPoint[]; expiresAt: number };
const _timeSeriesCache = new Map<string, TimeSeriesCacheEntry>();

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
  }
  if (_appInsightsIdCache.has(app.id)) {
    return _appInsightsIdCache.get(app.id) ?? null;
  }

  // Include the app's own subscription so App Insights is found even when
  // an app lives in a dedicated sub not listed in AZURE_SUBSCRIPTION_IDS.
  const globalSubs = getSubscriptionIds();
  const subscriptionIds = app.subscriptionId
    ? [...new Set([...globalSubs, app.subscriptionId])]
    : globalSubs;
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
    const rows = (result.data as unknown as Record<string, unknown>[]) ?? [];
    const id = rows.length === 0 ? null : String(rows[0]?.["id"] ?? "");
    _appInsightsIdCache.set(app.id, id);
    return id;
  } catch {
    _appInsightsIdCache.set(app.id, null);
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
  if (!isMonitorConfigured()) return null;

  const queryFn = METRIC_QUERIES[metricName];
  if (!queryFn) return null;

  const cacheKey = `${resourceId}:${metricName}:${hours}`;
  if (bypassCache) {
    _timeSeriesCache.delete(cacheKey);
  } else {
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

    _timeSeriesCache.set(cacheKey, { result: points, expiresAt: Date.now() + METRICS_CACHE_TTL_MS });
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

// Cache: "appId:hours:limit" → { result, expiresAt }
type TopExceptionsCacheEntry = { result: TopException[]; expiresAt: number };

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
      expiresAt: Date.now() + METRICS_CACHE_TTL_MS,
    });
    return exceptions;
  } catch {
    return null;
  }
}

// Cache: app id → { result, expiresAt }
type MetricsCacheEntry = { result: TelemetrySummary; expiresAt: number };
const _metricsCache = new Map<string, MetricsCacheEntry>();

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

  // When bypassing, evict all _timeSeriesCache entries for this app's resource
  // ID before resolveAppInsightsResourceId clears the ID cache. This ensures
  // every metric/hours variant is immediately invalidated, not just the one
  // being refreshed.
  if (bypassCache) {
    const cachedResourceId = _appInsightsIdCache.get(app.id);
    if (cachedResourceId) {
      for (const key of _timeSeriesCache.keys()) {
        if (key.startsWith(`${cachedResourceId}:`)) {
          _timeSeriesCache.delete(key);
        }
      }
    }
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
  if (!isAzureConfigured()) return null;

  if (bypassCache) {
    _metricsCache.delete(app.id);
  } else {
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
    _metricsCache.set(app.id, { result: summary, expiresAt: Date.now() + METRICS_CACHE_TTL_MS });
    return summary;
  } catch {
    return null;
  }
}
