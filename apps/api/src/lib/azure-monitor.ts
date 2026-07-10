/**
 * Azure Monitor + Application Insights client.
 *
 * Production: uses Managed Identity (no credentials needed — DefaultAzureCredential picks up the CA Managed Identity).
 * Local dev fallback: reads AZURE_TENANT_ID / AZURE_CLIENT_ID / AZURE_CLIENT_SECRET from env.
 *
 * All functions return null-safe results — callers must handle the case where
 * Azure is not configured (e.g. local dev without credentials).
 */

export interface MetricResult {
  resourceId: string;
  resourceName: string;
  resourceType: string;
  metricName: string;
  value: number | null;
  unit: string;
  capturedAt: string;
}

export interface InfrastructureSnapshot {
  containerApps: MetricResult[];
  database: MetricResult[];
  storage: MetricResult[];
  appInsights: MetricResult[];
  capturedAt: string;
}

// ── Config helpers ────────────────────────────────────────────────────────────

function env(key: string): string | undefined {
  return process.env[key];
}

export function isAzureMonitorConfigured(): boolean {
  return !!(
    env("AZURE_SUBSCRIPTION_ID") &&
    (env("AZURE_CLIENT_ID") || env("AZURE_USE_MANAGED_IDENTITY") === "true")
  );
}

// ── Azure Monitor REST helper ─────────────────────────────────────────────────

async function getAccessToken(): Promise<string | null> {
  try {
    // Managed Identity token endpoint (works in Azure Container Apps)
    const miEndpoint = env("IDENTITY_ENDPOINT");
    const miHeader = env("IDENTITY_HEADER");

    if (miEndpoint && miHeader) {
      const res = await fetch(
        `${miEndpoint}?resource=https://management.azure.com&api-version=2019-08-01`,
        { headers: { "X-IDENTITY-HEADER": miHeader } },
      );
      if (res.ok) {
        const data = (await res.json()) as { access_token: string };
        return data.access_token;
      }
    }

    // Client credentials fallback (local dev)
    const tenantId = env("AZURE_TENANT_ID");
    const clientId = env("AZURE_CLIENT_ID");
    const clientSecret = env("AZURE_CLIENT_SECRET");
    if (tenantId && clientId && clientSecret) {
      const body = new URLSearchParams({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret,
        scope: "https://management.azure.com/.default",
      });
      const res = await fetch(
        `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
        { method: "POST", body },
      );
      if (res.ok) {
        const data = (await res.json()) as { access_token: string };
        return data.access_token;
      }
    }
    return null;
  } catch {
    return null;
  }
}

async function queryMetric(
  token: string,
  subscriptionId: string,
  resourceId: string,
  metricName: string,
  timespan: string = "PT1H",
  aggregation: string = "Average",
): Promise<number | null> {
  try {
    const url =
      `https://management.azure.com${resourceId}/providers/Microsoft.Insights/metrics` +
      `?api-version=2023-10-01&metricnames=${encodeURIComponent(metricName)}` +
      `&timespan=${timespan}&aggregation=${aggregation}&interval=PT1H`;

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    });
    if (!res.ok) return null;

    type MetricResponse = {
      value?: Array<{
        timeseries?: Array<{
          data?: Array<Record<string, number | undefined>>;
        }>;
      }>;
    };
    const data = (await res.json()) as MetricResponse;
    const points = data.value?.[0]?.timeseries?.[0]?.data ?? [];
    const last = points[points.length - 1];
    if (!last) return null;
    const val = last[aggregation.toLowerCase() as keyof typeof last];
    return typeof val === "number" ? Math.round(val * 100) / 100 : null;
  } catch {
    return null;
  }
}

// ── App Insights query ────────────────────────────────────────────────────────

async function queryAppInsights(metricId: string): Promise<number | null> {
  const connStr = env("APPINSIGHTS_CONNECTION_STRING");
  if (!connStr) return null;

  try {
    const match = connStr.match(/InstrumentationKey=([^;]+)/i);
    const key = match?.[1];
    if (!key) return null;

    const url = `https://api.applicationinsights.io/v1/apps/${key}/metrics/${encodeURIComponent(metricId)}?timespan=PT1H`;
    const res = await fetch(url, { headers: { "x-api-key": key } });
    if (!res.ok) return null;

    type AppInsightsResponse = {
      value?: Record<string, { avg?: number; sum?: number; count?: number }>;
    };
    const data = (await res.json()) as AppInsightsResponse;
    const val = data.value?.[metricId];
    return val?.avg ?? val?.sum ?? null;
  } catch {
    return null;
  }
}

// ── Main snapshot builder ─────────────────────────────────────────────────────

export async function getInfrastructureSnapshot(): Promise<InfrastructureSnapshot> {
  const capturedAt = new Date().toISOString();
  const empty: InfrastructureSnapshot = {
    containerApps: [],
    database: [],
    storage: [],
    appInsights: [],
    capturedAt,
  };

  const subscriptionId = env("AZURE_SUBSCRIPTION_ID");
  if (!subscriptionId) return empty;

  const token = await getAccessToken();
  if (!token) return empty;

  // ── Container Apps ──────────────────────────────────────────────────────────
  const caResourceGroup = env("AZURE_RESOURCE_GROUP_ORBIT") ?? "rg-kinisislabs-orbit-prod";
  const caName = env("AZURE_CONTAINER_APP_NAME") ?? "ca-orbit-prod";
  const caResourceId = `/subscriptions/${subscriptionId}/resourceGroups/${caResourceGroup}/providers/Microsoft.App/containerApps/${caName}`;

  const [cpuUsage, memUsage, reqCount] = await Promise.all([
    queryMetric(token, subscriptionId, caResourceId, "CpuPercentage"),
    queryMetric(token, subscriptionId, caResourceId, "MemoryPercentage"),
    queryMetric(token, subscriptionId, caResourceId, "Requests", "PT1H", "Total"),
  ]);

  const containerApps: MetricResult[] = [
    { resourceId: caResourceId, resourceName: caName, resourceType: "ContainerApp", metricName: "CpuPercentage", value: cpuUsage, unit: "%", capturedAt },
    { resourceId: caResourceId, resourceName: caName, resourceType: "ContainerApp", metricName: "MemoryPercentage", value: memUsage, unit: "%", capturedAt },
    { resourceId: caResourceId, resourceName: caName, resourceType: "ContainerApp", metricName: "Requests", value: reqCount, unit: "count", capturedAt },
  ];

  // ── PostgreSQL ──────────────────────────────────────────────────────────────
  const pgResourceGroup = env("AZURE_RESOURCE_GROUP_SHARED") ?? "rg-kinisislabs-platform-shared-prod";
  const pgName = env("AZURE_POSTGRES_NAME") ?? "pg-orbit-prod";
  const pgResourceId = `/subscriptions/${subscriptionId}/resourceGroups/${pgResourceGroup}/providers/Microsoft.DBforPostgreSQL/flexibleServers/${pgName}`;

  const [pgAvail, pgConns, pgStorage] = await Promise.all([
    queryMetric(token, subscriptionId, pgResourceId, "availability_percent"),
    queryMetric(token, subscriptionId, pgResourceId, "active_connections"),
    queryMetric(token, subscriptionId, pgResourceId, "storage_percent"),
  ]);

  const database: MetricResult[] = [
    { resourceId: pgResourceId, resourceName: pgName, resourceType: "PostgreSQL", metricName: "availability_percent", value: pgAvail, unit: "%", capturedAt },
    { resourceId: pgResourceId, resourceName: pgName, resourceType: "PostgreSQL", metricName: "active_connections", value: pgConns, unit: "count", capturedAt },
    { resourceId: pgResourceId, resourceName: pgName, resourceType: "PostgreSQL", metricName: "storage_percent", value: pgStorage, unit: "%", capturedAt },
  ];

  // ── Storage ─────────────────────────────────────────────────────────────────
  const stResourceGroup = env("AZURE_RESOURCE_GROUP_SHARED") ?? "rg-kinisislabs-platform-shared-prod";
  const stName = env("AZURE_STORAGE_NAME") ?? "stsharedprod";
  const stResourceId = `/subscriptions/${subscriptionId}/resourceGroups/${stResourceGroup}/providers/Microsoft.Storage/storageAccounts/${stName}`;

  const [stIngress, stEgress, stErrors] = await Promise.all([
    queryMetric(token, subscriptionId, stResourceId, "Ingress", "PT1H", "Total"),
    queryMetric(token, subscriptionId, stResourceId, "Egress", "PT1H", "Total"),
    queryMetric(token, subscriptionId, stResourceId, "Transactions", "PT1H", "Total"),
  ]);

  const storage: MetricResult[] = [
    { resourceId: stResourceId, resourceName: stName, resourceType: "Storage", metricName: "Ingress", value: stIngress, unit: "bytes", capturedAt },
    { resourceId: stResourceId, resourceName: stName, resourceType: "Storage", metricName: "Egress", value: stEgress, unit: "bytes", capturedAt },
    { resourceId: stResourceId, resourceName: stName, resourceType: "Storage", metricName: "Transactions", value: stErrors, unit: "count", capturedAt },
  ];

  // ── Application Insights ────────────────────────────────────────────────────
  const [aiRequests, aiDuration, aiFailed] = await Promise.all([
    queryAppInsights("requests/count"),
    queryAppInsights("requests/duration"),
    queryAppInsights("requests/failed"),
  ]);

  const appInsightsResourceId = `appinsights/orbit`;
  const appInsights: MetricResult[] = [
    { resourceId: appInsightsResourceId, resourceName: "appi-orbit-prod", resourceType: "AppInsights", metricName: "requests/count", value: aiRequests, unit: "count", capturedAt },
    { resourceId: appInsightsResourceId, resourceName: "appi-orbit-prod", resourceType: "AppInsights", metricName: "requests/duration", value: aiDuration, unit: "ms", capturedAt },
    { resourceId: appInsightsResourceId, resourceName: "appi-orbit-prod", resourceType: "AppInsights", metricName: "requests/failed", value: aiFailed, unit: "count", capturedAt },
  ];

  return { containerApps, database, storage, appInsights, capturedAt };
}
