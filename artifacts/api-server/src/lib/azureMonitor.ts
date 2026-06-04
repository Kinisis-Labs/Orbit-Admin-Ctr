import { MetricsQueryClient, LogsQueryClient } from "@azure/monitor-query";
import { ResourceGraphClient } from "@azure/arm-resourcegraph";
import { getAzureCredential, getSubscriptionIds, isAzureConfigured } from "./azure.js";
import type { AppRecord } from "../routes/orbit.js";

export type TelemetrySummary = {
  requestsPerMin: number;
  p95LatencyMs: number;
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
async function resolveAppInsightsResourceId(
  app: AppRecord,
  { bypassCache = false }: { bypassCache?: boolean } = {},
): Promise<string | null> {
  if (bypassCache) {
    _appInsightsIdCache.delete(app.id);
  }
  if (_appInsightsIdCache.has(app.id)) {
    return _appInsightsIdCache.get(app.id) ?? null;
  }

  const subscriptionIds = getSubscriptionIds();
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
    const rows = (result.data as Record<string, unknown>[]) ?? [];
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

    _timeSeriesCache.set(cacheKey, { result: points, expiresAt: Date.now() + METRICS_CACHE_TTL_MS });
    return points;
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
  const resourceId = await resolveAppInsightsResourceId(app, { bypassCache });
  if (!resourceId) return null;
  return fetchMetricTimeSeries(resourceId, metricName, hours, { bypassCache });
}

/**
 * Fetch telemetry summary metrics for the past hour from Azure Monitor.
 * Looks up the Application Insights component in the app's RG, then queries:
 *   - requests/count (total over 1h → /min)
 *   - requests/failed (for error rate)
 *   - requests/duration (P95 approximated from average — real P95 via Log Analytics)
 *   - availabilityResults/availabilityPercentage
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
    // Azure Monitor Metrics API does not expose true percentiles; use average × 1.4
    // as an approximation. Real P95 is available via fetchMetricTimeSeries.
    const p95LatencyMs = Number((avgDurationMs * 1.4).toFixed(0));

    const summary: TelemetrySummary = {
      requestsPerMin,
      p95LatencyMs,
      errorRatePercent,
      availabilityPercent: Number(availabilityPct.toFixed(2)),
    };
    _metricsCache.set(app.id, { result: summary, expiresAt: Date.now() + METRICS_CACHE_TTL_MS });
    return summary;
  } catch {
    return null;
  }
}
