import { MetricsQueryClient } from "@azure/monitor-query";
import { ResourceGraphClient } from "@azure/arm-resourcegraph";
import { getAzureCredential, getSubscriptionIds, isAzureConfigured } from "./azure.js";
import type { AppRecord } from "../routes/orbit.js";

export type TelemetrySummary = {
  requestsPerMin: number;
  p95LatencyMs: number;
  errorRatePercent: number;
  availabilityPercent: number;
};

let _metricsClient: MetricsQueryClient | null = null;
let _graphClient: ResourceGraphClient | null = null;

function getMetricsClient(): MetricsQueryClient {
  if (!_metricsClient) {
    _metricsClient = new MetricsQueryClient(getAzureCredential());
  }
  return _metricsClient;
}

function getGraphClient(): ResourceGraphClient {
  if (!_graphClient) {
    _graphClient = new ResourceGraphClient(getAzureCredential());
  }
  return _graphClient;
}

/**
 * Resolve the Application Insights component resource ID for the app's RG.
 * Returns null if none found.
 */
async function resolveAppInsightsResourceId(
  app: AppRecord,
): Promise<string | null> {
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
    if (rows.length === 0) return null;
    return String(rows[0]?.["id"] ?? "");
  } catch {
    return null;
  }
}

/**
 * Fetch telemetry summary metrics for the past hour from Azure Monitor.
 * Looks up the Application Insights component in the app's RG, then queries:
 *   - requests/count (total over 1h → /min)
 *   - requests/failed (for error rate)
 *   - requests/duration (P95 approximated from average — real P95 requires Log Analytics)
 *   - availabilityResults/availabilityPercentage
 *
 * Returns null when not configured, no App Insights found, or on any error.
 */
export async function fetchAppMetrics(
  app: AppRecord,
): Promise<TelemetrySummary | null> {
  if (!isAzureConfigured()) return null;

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
    // Azure Monitor doesn't expose P95 directly via the Metrics API (it requires
    // Log Analytics). We use average × 1.4 as a reasonable approximation.
    const p95LatencyMs = Number((avgDurationMs * 1.4).toFixed(0));

    return {
      requestsPerMin,
      p95LatencyMs,
      errorRatePercent,
      availabilityPercent: Number(availabilityPct.toFixed(2)),
    };
  } catch {
    return null;
  }
}
