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
  vpn: ResourceGroup[];
  loadBalancers: ResourceGroup[];
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

    if (miEndpoint && miHeader && !env("AZURE_USE_CLIENT_CREDENTIALS")) {
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
      const errText = await res.text().catch(() => "unreadable");
      throw new Error(`OAuth failed ${res.status}: ${errText.slice(0, 300)}`);
    }
    return null;
  } catch (err) {
    throw err;
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

async function queryContainerApp(
  token: string,
  subId: string,
  resourceGroup: string,
  caName: string,
  capturedAt: string,
): Promise<ResourceGroup> {
  const caResourceId = `/subscriptions/${subId}/resourceGroups/${resourceGroup}/providers/Microsoft.App/containerApps/${caName}`;
  const [cpuUsage, memUsage, reqCount, restartCount, replicaCount] = await Promise.all([
    queryMetric(token, subId, caResourceId, "CpuPercentage", "PT6H"),
    queryMetric(token, subId, caResourceId, "MemoryPercentage", "PT6H"),
    queryMetric(token, subId, caResourceId, "Requests", "PT6H", "Total"),
    queryMetric(token, subId, caResourceId, "RestartCount", "PT6H", "Total"),
    queryMetric(token, subId, caResourceId, "Replicas", "PT6H"),
  ]);
  const metrics: MetricResult[] = [
    makeMetric(caResourceId, caName, "ContainerApp", "CpuPercentage", cpuUsage, "%", capturedAt),
    makeMetric(caResourceId, caName, "ContainerApp", "MemoryPercentage", memUsage, "%", capturedAt),
    makeMetric(caResourceId, caName, "ContainerApp", "Requests", reqCount, "count", capturedAt),
    makeMetric(caResourceId, caName, "ContainerApp", "RestartCount", restartCount, "count", capturedAt),
    makeMetric(caResourceId, caName, "ContainerApp", "Replicas", replicaCount, "count", capturedAt),
  ];
  return { name: caName, resourceType: "ContainerApp", health: deriveHealth(metrics), metrics };
}

async function queryAppInsightsGroup(
  connStr: string,
  displayName: string,
  capturedAt: string,
): Promise<ResourceGroup> {
  const match = connStr.match(/InstrumentationKey=([^;]+)/i);
  const key = match?.[1];

  async function q(metricId: string): Promise<number | null> {
    if (!key) return null;
    try {
      const url = `https://api.applicationinsights.io/v1/apps/${key}/metrics/${encodeURIComponent(metricId)}?timespan=PT6H`;
      const res = await fetch(url, { headers: { "x-api-key": key } });
      if (!res.ok) return null;
      type R = { value?: Record<string, { avg?: number; sum?: number }> };
      const data = (await res.json()) as R;
      const val = data.value?.[metricId];
      return val?.avg ?? val?.sum ?? null;
    } catch { return null; }
  }

  const [requests, duration, failed, availability, exceptions] = await Promise.all([
    q("requests/count"),
    q("requests/duration"),
    q("requests/failed"),
    q("availabilityResults/availabilityPercentage"),
    q("exceptions/count"),
  ]);

  const resourceId = `appinsights/${displayName}`;
  const metrics: MetricResult[] = [
    makeMetric(resourceId, displayName, "AppInsights", "requests/count", requests, "count", capturedAt),
    makeMetric(resourceId, displayName, "AppInsights", "requests/duration", duration, "ms", capturedAt),
    makeMetric(resourceId, displayName, "AppInsights", "requests/failed", failed, "count", capturedAt),
    makeMetric(resourceId, displayName, "AppInsights", "availability", availability, "%", capturedAt),
    makeMetric(resourceId, displayName, "AppInsights", "exceptions/count", exceptions, "count", capturedAt),
  ];
  return { name: displayName, resourceType: "AppInsights", health: deriveHealth(metrics), metrics };
}

export async function getInfrastructureSnapshot(): Promise<InfrastructureSnapshot> {
  const capturedAt = new Date().toISOString();
  const empty: InfrastructureSnapshot = {
    overallHealth: "unknown",
    containerApps: [],
    database: [],
    network: [],
    vpn: [],
    loadBalancers: [],
    api: [],
    capturedAt,
  };

  // AZURE_SUBSCRIPTION_IDS: primary subscription for all resources.
  // AZURE_SUB_ORBIT / AZURE_SUB_SHARED can override individually but default to the same sub.
  const subIds = (env("AZURE_SUBSCRIPTION_IDS") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const orbitSubId = env("AZURE_SUB_ORBIT") ?? subIds[0];
  const sharedSubId = env("AZURE_SUB_SHARED") ?? orbitSubId;

  if (!orbitSubId) return empty;

  const token = await getAccessToken();
  if (!token) return empty;

  // ── Container Apps ───────────────────────────────────────────────────────────
  // Orbit CA (always included)
  const orbitRg = env("AZURE_RESOURCE_GROUP_ORBIT") ?? "rg-kinisislabs-orbit-prod-eus2";
  const orbitCaName = env("AZURE_CONTAINER_APP_NAME") ?? "ca-orbit-prod-v2";

  // GrailBabe CA (included when env vars are set)
  const gbCaName = env("AZURE_CONTAINER_APP_NAME_GRAILBABE");
  const gbRg = env("AZURE_RESOURCE_GROUP_GRAILBABE") ?? orbitRg;
  const gbSubId = env("AZURE_SUB_GRAILBABE") ?? orbitSubId;

  const caPromises: Promise<ResourceGroup>[] = [
    queryContainerApp(token, orbitSubId, orbitRg, orbitCaName, capturedAt),
  ];
  if (gbCaName) {
    caPromises.push(queryContainerApp(token, gbSubId, gbRg, gbCaName, capturedAt));
  }

  const containerApps = await Promise.all(caPromises);

  // ── PostgreSQL (Shared Platform subscription) ────────────────────────────────
  const pgResourceGroup = env("AZURE_RESOURCE_GROUP_SHARED") ?? "rg-kinisislabs-platform-shared-prod-eus2";
  const pgName = env("AZURE_POSTGRES_NAME") ?? "pg-orbit-prod";
  const pgResourceId = `/subscriptions/${sharedSubId}/resourceGroups/${pgResourceGroup}/providers/Microsoft.DBforPostgreSQL/flexibleServers/${pgName}`;

  const [pgAvail, pgConns, pgStorage, pgCpu, pgDeadlocks, pgQueryTime] = await Promise.all([
    queryMetric(token, sharedSubId, pgResourceId, "availability_percent", "PT6H"),
    queryMetric(token, sharedSubId, pgResourceId, "active_connections", "PT6H"),
    queryMetric(token, sharedSubId, pgResourceId, "storage_percent", "PT6H"),
    queryMetric(token, sharedSubId, pgResourceId, "cpu_percent", "PT6H"),
    queryMetric(token, sharedSubId, pgResourceId, "deadlocks", "PT6H", "Total"),
    queryMetric(token, sharedSubId, pgResourceId, "read_iops", "PT6H"),
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
  const stSubId = env("AZURE_SUB_STORAGE") ?? sharedSubId;
  const stResourceGroup = env("AZURE_RESOURCE_GROUP_STORAGE") ?? env("AZURE_RESOURCE_GROUP_SHARED") ?? "rg-kinisislabs-platform-shared-prod-eus2";
  const stName = env("AZURE_STORAGE_NAME") ?? "stsharedprod";
  const stResourceId = `/subscriptions/${stSubId}/resourceGroups/${stResourceGroup}/providers/Microsoft.Storage/storageAccounts/${stName}`;

  const [stIngress, stEgress, stTransactions, stLatency] = await Promise.all([
    queryMetric(token, stSubId, stResourceId, "Ingress", "PT1H", "Total"),
    queryMetric(token, stSubId, stResourceId, "Egress", "PT1H", "Total"),
    queryMetric(token, stSubId, stResourceId, "Transactions", "PT1H", "Total"),
    queryMetric(token, stSubId, stResourceId, "SuccessE2ELatency"),
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

  // ── Virtual Networks ──────────────────────────────────────────────────────────
  const vnetConfigs = [
    {
      name: env("AZURE_VNET_NAME_SHARED") ?? "vnet-sharedplatform-prod",
      rg: env("AZURE_RESOURCE_GROUP_VNET_SHARED") ?? env("AZURE_RESOURCE_GROUP_VNET") ?? env("AZURE_RESOURCE_GROUP_SHARED") ?? "rg-kinisislabs-platform-shared-prod-eus2",
      subId: env("AZURE_SUB_VNET_SHARED") ?? env("AZURE_SUB_VNET") ?? orbitSubId,
    },
    {
      name: env("AZURE_VNET_NAME_GRAILBABE") ?? "vnet-grailbabe-prod",
      rg: env("AZURE_RESOURCE_GROUP_VNET_GRAILBABE") ?? env("AZURE_RESOURCE_GROUP_VNET") ?? env("AZURE_RESOURCE_GROUP_GRAILBABE") ?? "rg-kinisislabs-platform-shared-prod-eus2",
      subId: env("AZURE_SUB_VNET_GRAILBABE") ?? env("AZURE_SUB_VNET") ?? gbSubId,
    },
  ];

  const vnetPromises = vnetConfigs.map(async ({ name: vnetName, rg: vnetRg, subId: vnetSubId }): Promise<ResourceGroup> => {
    const vnetResourceId = `/subscriptions/${vnetSubId}/resourceGroups/${vnetRg}/providers/Microsoft.Network/virtualNetworks/${vnetName}`;
    const [bytesIn, bytesOut, packetsIn, packetsOut, droppedIn, droppedOut] = await Promise.all([
      queryMetric(token, vnetSubId, vnetResourceId, "BytesInDDoS", "PT6H", "Total"),
      queryMetric(token, vnetSubId, vnetResourceId, "BytesOutDDoS", "PT6H", "Total"),
      queryMetric(token, vnetSubId, vnetResourceId, "PacketsInDDoS", "PT6H", "Total"),
      queryMetric(token, vnetSubId, vnetResourceId, "PacketsOutDDoS", "PT6H", "Total"),
      queryMetric(token, vnetSubId, vnetResourceId, "PacketsDroppedDDoS", "PT6H", "Total"),
      queryMetric(token, vnetSubId, vnetResourceId, "BytesDroppedDDoS", "PT6H", "Total"),
    ]);
    const metrics: MetricResult[] = [
      makeMetric(vnetResourceId, vnetName, "VirtualNetwork", "BytesIn", bytesIn, "bytes", capturedAt),
      makeMetric(vnetResourceId, vnetName, "VirtualNetwork", "BytesOut", bytesOut, "bytes", capturedAt),
      makeMetric(vnetResourceId, vnetName, "VirtualNetwork", "PacketsIn", packetsIn, "count", capturedAt),
      makeMetric(vnetResourceId, vnetName, "VirtualNetwork", "PacketsOut", packetsOut, "count", capturedAt),
      makeMetric(vnetResourceId, vnetName, "VirtualNetwork", "PacketsDropped", droppedIn, "count", capturedAt),
      makeMetric(vnetResourceId, vnetName, "VirtualNetwork", "BytesDropped", droppedOut, "bytes", capturedAt),
    ];
    return { name: vnetName, resourceType: "VirtualNetwork", health: deriveHealth(metrics), metrics };
  });

  const vpn = await Promise.all(vnetPromises);

  // ── Load Balancers ────────────────────────────────────────────────────────────
  const lbConfigs = [
    {
      name: env("AZURE_LB_NAME_SHARED") ?? "capp-svc-lb",
      rg: env("AZURE_RESOURCE_GROUP_LB_SHARED") ?? "rg-sharedplatform-prod-cae-infra",
      subId: env("AZURE_SUB_LB_SHARED") ?? orbitSubId,
      displayName: "lb-vnet-sharedplatform-prod",
    },
    {
      name: env("AZURE_LB_NAME_GRAILBABE") ?? "capp-svc-lb",
      rg: env("AZURE_RESOURCE_GROUP_LB_GRAILBABE") ?? "rg-grailbabe-prod-v2-infra",
      subId: env("AZURE_SUB_LB_GRAILBABE") ?? gbSubId,
      displayName: "lb-vnet-grailbabe-prod",
    },
  ];

  const lbPromises = lbConfigs.map(async ({ name, rg, subId, displayName }): Promise<ResourceGroup> => {
    const lbResourceId = `/subscriptions/${subId}/resourceGroups/${rg}/providers/Microsoft.Network/loadBalancers/${name}`;
    const [byteCount, packetCount, synCount, snatUsed, snatAllocated, healthProbeStatus] = await Promise.all([
      queryMetric(token, subId, lbResourceId, "ByteCount", "PT6H", "Total"),
      queryMetric(token, subId, lbResourceId, "PacketCount", "PT6H", "Total"),
      queryMetric(token, subId, lbResourceId, "SYNCount", "PT6H", "Total"),
      queryMetric(token, subId, lbResourceId, "UsedSNATPorts", "PT6H", "Average"),
      queryMetric(token, subId, lbResourceId, "AllocatedSNATPorts", "PT6H", "Average"),
      queryMetric(token, subId, lbResourceId, "VipAvailability", "PT6H", "Average"),
    ]);
    const metrics: MetricResult[] = [
      makeMetric(lbResourceId, displayName, "LoadBalancer", "ByteCount", byteCount, "bytes", capturedAt),
      makeMetric(lbResourceId, displayName, "LoadBalancer", "PacketCount", packetCount, "count", capturedAt),
      makeMetric(lbResourceId, displayName, "LoadBalancer", "SYNCount", synCount, "count", capturedAt),
      makeMetric(lbResourceId, displayName, "LoadBalancer", "UsedSNATPorts", snatUsed, "count", capturedAt),
      makeMetric(lbResourceId, displayName, "LoadBalancer", "AllocatedSNATPorts", snatAllocated, "count", capturedAt),
      makeMetric(lbResourceId, displayName, "LoadBalancer", "VipAvailability", healthProbeStatus, "%", capturedAt),
    ];
    return { name: displayName, resourceType: "LoadBalancer", health: deriveHealth(metrics), metrics };
  });

  const loadBalancers = await Promise.all(lbPromises);

  // ── API (Application Insights — one entry per configured app) ───────────────
  const apiPromises: Promise<ResourceGroup>[] = [];

  const orbitConnStr = env("APPLICATIONINSIGHTS_CONNECTION_STRING") ?? env("APPINSIGHTS_CONNECTION_STRING");
  if (orbitConnStr) {
    apiPromises.push(queryAppInsightsGroup(orbitConnStr, "appi-orbit-prod", capturedAt));
  }

  const gbConnStr = env("GRAILBABE_APPLICATIONINSIGHTS_CONNECTION_STRING");
  if (gbConnStr) {
    apiPromises.push(queryAppInsightsGroup(gbConnStr, "appi-grailbabe-prod", capturedAt));
  }

  const api: ResourceGroup[] = await Promise.all(apiPromises);

  return {
    overallHealth: overallHealth([containerApps, database, network, vpn, loadBalancers, api]),
    containerApps,
    database,
    network,
    vpn,
    loadBalancers,
    api,
    capturedAt,
  };
}
