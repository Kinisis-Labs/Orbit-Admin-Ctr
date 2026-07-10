/**
 * Azure Monitor + Application Insights client.
 *
 * Production: uses Managed Identity token endpoint (IDENTITY_ENDPOINT + IDENTITY_HEADER).
 * Local dev fallback: reads AZURE_TENANT_ID / AZURE_CLIENT_ID / AZURE_CLIENT_SECRET from env.
 *
 * All functions return null-safe results — callers must handle the case where
 * Azure is not configured (e.g. local dev without credentials).
 */

export type HealthStatus = "healthy" | "warning" | "critical" | "unknown";

export interface MetricResult {
  resourceId: string;
  resourceName: string;
  resourceType: string;
  metricName: string;
  value: number | null;
  unit: string;
  capturedAt: string;
}

export interface ResourceGroup {
  name: string;
  resourceType: string;
  health: HealthStatus;
  metrics: MetricResult[];
}

export interface InfrastructureSnapshot {
  overallHealth: HealthStatus;
  containerApps: ResourceGroup[];
  database: ResourceGroup[];
  network: ResourceGroup[];
  api: ResourceGroup[];
  capturedAt: string;
}

// ── Config helpers ────────────────────────────────────────────────────────────

function env(key: string): string | undefined {
  return process.env[key];
}

export function isAzureMonitorConfigured(): boolean {
  return !!(
    env("IDENTITY_ENDPOINT") ||
    (env("AZURE_TENANT_ID") && env("AZURE_CLIENT_ID") && env("AZURE_CLIENT_SECRET"))
  );
}

// ── Azure Monitor REST helper ─────────────────────────────────────────────────

export async function getAccessToken(): Promise<string | null> {
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
  const connStr = env("APPLICATIONINSIGHTS_CONNECTION_STRING") ?? env("APPINSIGHTS_CONNECTION_STRING");
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

// ── Health status derivation ──────────────────────────────────────────────────

function deriveHealth(metrics: MetricResult[]): HealthStatus {
  let worst: HealthStatus = "unknown";
  for (const m of metrics) {
    if (m.value === null) continue;
    let status: HealthStatus = "healthy";
    const n = m.metricName.toLowerCase();
    if (n.includes("cpu") || n.includes("memory") || n.includes("storage_percent")) {
      status = m.value > 90 ? "critical" : m.value > 75 ? "warning" : "healthy";
    } else if (n.includes("availability")) {
      status = m.value < 95 ? "critical" : m.value < 99 ? "warning" : "healthy";
    } else if (n.includes("restartcount") || n.includes("crashloop")) {
      status = m.value > 5 ? "critical" : m.value > 0 ? "warning" : "healthy";
    } else if (n.includes("failed") || n.includes("errors")) {
      status = m.value > 10 ? "critical" : m.value > 0 ? "warning" : "healthy";
    } else if (n.includes("duration") || n.includes("latency") || n.includes("responsetime")) {
      status = m.value > 5000 ? "critical" : m.value > 1000 ? "warning" : "healthy";
    } else if (n.includes("deadlock")) {
      status = m.value > 0 ? "critical" : "healthy";
    } else if (n.includes("active_connections")) {
      status = m.value > 90 ? "critical" : m.value > 70 ? "warning" : "healthy";
    }
    if (status === "critical") return "critical";
    if (status === "warning") worst = "warning";
    else if (status === "healthy" && worst === "unknown") worst = "healthy";
  }
  return worst;
}

function overallHealth(groups: ResourceGroup[][]): HealthStatus {
  const all = groups.flat().map((g) => g.health);
  if (all.includes("critical")) return "critical";
  if (all.includes("warning")) return "warning";
  if (all.every((h) => h === "healthy")) return "healthy";
  return "unknown";
}

// ── Main snapshot builder ─────────────────────────────────────────────────────

function makeMetric(
  resourceId: string,
  resourceName: string,
  resourceType: string,
  metricName: string,
  value: number | null,
  unit: string,
  capturedAt: string,
): MetricResult {
  return { resourceId, resourceName, resourceType, metricName, value, unit, capturedAt };
}

export async function getInfrastructureSnapshot(): Promise<InfrastructureSnapshot> {
  const capturedAt = new Date().toISOString();
  const empty: InfrastructureSnapshot = {
    overallHealth: "unknown",
    containerApps: [],
    database: [],
    network: [],
    api: [],
    capturedAt,
  };

  // AZURE_SUBSCRIPTION_IDS is a comma-separated list: first = Orbit sub, second = Shared Platform sub.
  // Individual overrides (AZURE_SUB_ORBIT, AZURE_SUB_SHARED) take precedence when set.
  const subIds = (env("AZURE_SUBSCRIPTION_IDS") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const orbitSubId = env("AZURE_SUB_ORBIT") ?? subIds[0];
  const sharedSubId = env("AZURE_SUB_SHARED") ?? subIds[1] ?? subIds[0];

  if (!orbitSubId) return empty;

  const token = await getAccessToken();
  if (!token) return empty;

  // ── Container Apps (Orbit subscription) ─────────────────────────────────────
  const caResourceGroup = env("AZURE_RESOURCE_GROUP_ORBIT") ?? "rg-kinisislabs-orbit-prod-eus2";
  const caName = env("AZURE_CONTAINER_APP_NAME") ?? "ca-orbit-prod-v2";
  const caResourceId = `/subscriptions/${orbitSubId}/resourceGroups/${caResourceGroup}/providers/Microsoft.App/containerApps/${caName}`;

  const [cpuUsage, memUsage, reqCount, restartCount, replicaCount] = await Promise.all([
    queryMetric(token, orbitSubId, caResourceId, "CpuPercentage"),
    queryMetric(token, orbitSubId, caResourceId, "MemoryPercentage"),
    queryMetric(token, orbitSubId, caResourceId, "Requests", "PT1H", "Total"),
    queryMetric(token, orbitSubId, caResourceId, "RestartCount", "PT1H", "Total"),
    queryMetric(token, orbitSubId, caResourceId, "Replicas"),
  ]);

  const caMetrics: MetricResult[] = [
    makeMetric(caResourceId, caName, "ContainerApp", "CpuPercentage", cpuUsage, "%", capturedAt),
    makeMetric(caResourceId, caName, "ContainerApp", "MemoryPercentage", memUsage, "%", capturedAt),
    makeMetric(caResourceId, caName, "ContainerApp", "Requests", reqCount, "count", capturedAt),
    makeMetric(caResourceId, caName, "ContainerApp", "RestartCount", restartCount, "count", capturedAt),
    makeMetric(caResourceId, caName, "ContainerApp", "Replicas", replicaCount, "count", capturedAt),
  ];

  const containerApps: ResourceGroup[] = [
    { name: caName, resourceType: "ContainerApp", health: deriveHealth(caMetrics), metrics: caMetrics },
  ];

  // ── PostgreSQL (Shared Platform subscription) ────────────────────────────────
  const pgResourceGroup = env("AZURE_RESOURCE_GROUP_SHARED") ?? "rg-kinisislabs-platform-shared-prod-eus2";
  const pgName = env("AZURE_POSTGRES_NAME") ?? "pg-orbit-prod";
  const pgResourceId = `/subscriptions/${sharedSubId}/resourceGroups/${pgResourceGroup}/providers/Microsoft.DBforPostgreSQL/flexibleServers/${pgName}`;

  const [pgAvail, pgConns, pgStorage, pgCpu, pgDeadlocks, pgQueryTime] = await Promise.all([
    queryMetric(token, sharedSubId, pgResourceId, "availability_percent"),
    queryMetric(token, sharedSubId, pgResourceId, "active_connections"),
    queryMetric(token, sharedSubId, pgResourceId, "storage_percent"),
    queryMetric(token, sharedSubId, pgResourceId, "cpu_percent"),
    queryMetric(token, sharedSubId, pgResourceId, "deadlocks", "PT1H", "Total"),
    queryMetric(token, sharedSubId, pgResourceId, "read_iops"),
  ]);

  const pgMetrics: MetricResult[] = [
    makeMetric(pgResourceId, pgName, "PostgreSQL", "availability_percent", pgAvail, "%", capturedAt),
    makeMetric(pgResourceId, pgName, "PostgreSQL", "active_connections", pgConns, "count", capturedAt),
    makeMetric(pgResourceId, pgName, "PostgreSQL", "storage_percent", pgStorage, "%", capturedAt),
    makeMetric(pgResourceId, pgName, "PostgreSQL", "cpu_percent", pgCpu, "%", capturedAt),
    makeMetric(pgResourceId, pgName, "PostgreSQL", "deadlocks", pgDeadlocks, "count", capturedAt),
    makeMetric(pgResourceId, pgName, "PostgreSQL", "read_iops", pgQueryTime, "count", capturedAt),
  ];

  const database: ResourceGroup[] = [
    { name: pgName, resourceType: "PostgreSQL", health: deriveHealth(pgMetrics), metrics: pgMetrics },
  ];

  // ── Network (Storage as proxy for throughput) ────────────────────────────────
  const stResourceGroup = env("AZURE_RESOURCE_GROUP_SHARED") ?? "rg-kinisislabs-platform-shared-prod-eus2";
  const stName = env("AZURE_STORAGE_NAME") ?? "stsharedprod";
  const stResourceId = `/subscriptions/${sharedSubId}/resourceGroups/${stResourceGroup}/providers/Microsoft.Storage/storageAccounts/${stName}`;

  const [stIngress, stEgress, stTransactions, stLatency] = await Promise.all([
    queryMetric(token, sharedSubId, stResourceId, "Ingress", "PT1H", "Total"),
    queryMetric(token, sharedSubId, stResourceId, "Egress", "PT1H", "Total"),
    queryMetric(token, sharedSubId, stResourceId, "Transactions", "PT1H", "Total"),
    queryMetric(token, sharedSubId, stResourceId, "SuccessE2ELatency"),
  ]);

  const networkMetrics: MetricResult[] = [
    makeMetric(stResourceId, stName, "Storage", "Ingress", stIngress, "bytes", capturedAt),
    makeMetric(stResourceId, stName, "Storage", "Egress", stEgress, "bytes", capturedAt),
    makeMetric(stResourceId, stName, "Storage", "Transactions", stTransactions, "count", capturedAt),
    makeMetric(stResourceId, stName, "Storage", "SuccessE2ELatency", stLatency, "ms", capturedAt),
  ];

  const network: ResourceGroup[] = [
    { name: stName, resourceType: "Storage", health: deriveHealth(networkMetrics), metrics: networkMetrics },
  ];

  // ── API (Application Insights) ───────────────────────────────────────────────
  const [aiRequests, aiDuration, aiFailed, aiAvailability, aiExceptions] = await Promise.all([
    queryAppInsights("requests/count"),
    queryAppInsights("requests/duration"),
    queryAppInsights("requests/failed"),
    queryAppInsights("availabilityResults/availabilityPercentage"),
    queryAppInsights("exceptions/count"),
  ]);

  const aiResourceId = "appinsights/orbit";
  const aiMetrics: MetricResult[] = [
    makeMetric(aiResourceId, "appi-orbit-prod", "AppInsights", "requests/count", aiRequests, "count", capturedAt),
    makeMetric(aiResourceId, "appi-orbit-prod", "AppInsights", "requests/duration", aiDuration, "ms", capturedAt),
    makeMetric(aiResourceId, "appi-orbit-prod", "AppInsights", "requests/failed", aiFailed, "count", capturedAt),
    makeMetric(aiResourceId, "appi-orbit-prod", "AppInsights", "availability", aiAvailability, "%", capturedAt),
    makeMetric(aiResourceId, "appi-orbit-prod", "AppInsights", "exceptions/count", aiExceptions, "count", capturedAt),
  ];

  const api: ResourceGroup[] = [
    { name: "appi-orbit-prod", resourceType: "AppInsights", health: deriveHealth(aiMetrics), metrics: aiMetrics },
  ];

  return {
    overallHealth: overallHealth([containerApps, database, network, api]),
    containerApps,
    database,
    network,
    api,
    capturedAt,
  };
}
