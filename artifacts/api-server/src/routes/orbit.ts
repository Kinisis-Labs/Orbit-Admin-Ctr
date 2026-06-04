import { Router, type IRouter } from "express";
import {
  ListAppsResponse,
  GetAppResponse,
  GetInfrastructureResponse,
  GetNetworkResponse,
  GetCostResponse,
  GetTelemetryResponse,
  GetAppAlertsResponse,
  GetGlobalHealthResponse,
  ListGlobalAlertsResponse,
  GetGlobalCostSummaryResponse,
} from "@workspace/api-zod";
import { fetchResourcesByResourceGroup, fetchResourceGroupTags } from "../lib/azureResources.js";
import { fetchMonthToDateCost } from "../lib/azureCost.js";
import { fetchAppMetrics, fetchAppTimeSeries } from "../lib/azureMonitor.js";
import { fetchActiveAlerts } from "../lib/azureAlerts.js";
import { fetchNetworkEndpoints } from "../lib/azureNetwork.js";

const router: IRouter = Router();

type Status = "healthy" | "degraded" | "unhealthy" | "unknown";
type Severity = "info" | "warning" | "error" | "critical";

// AppRecord derives its full shape from the OpenAPI contract (GetAppResponse)
// so that adding a required field to the spec causes a compile-time error here
// rather than a runtime surprise. userAuth and androidPackage are now part of
// the AppDetail schema in the spec, so no intersection is needed.
export type AppRecord = ReturnType<typeof GetAppResponse.parse>;

export const APPS: AppRecord[] = [
  {
    id: "grailbabe",
    name: "GrailBabe",
    environment: "prod",
    region: "eastus2",
    resourceGroup: "rg-grailbabeprod-compute-prod-eus2",
    status: "healthy",
    activeAlerts: 1,
    monthToDateCost: 4128.42,
    subscriptionId: "a1f4-shared-platform",
    description: "Consumer marketplace for limited-edition collectibles.",
    tags: {
      workload: "GrailBabeProd",
      environment: "prod",
      owner: "Ryan Gutridge",
      "cost-center": "CC-GrailBabeProd",
      criticality: "mission-critical",
    },
    owners: ["Ryan Gutridge"],
    userAuth: "clerk",
    androidPackage: "com.grailbabe.app",
  },
  {
    id: "orbit",
    name: "Orbit",
    environment: "prod",
    region: "eastus2",
    resourceGroup: "rg-orbit-prod-eus2",
    status: "healthy",
    activeAlerts: 0,
    monthToDateCost: 612.33,
    subscriptionId: "b203-internal-tools",
    description: "The Kinisis admin center — Azure operations dashboard.",
    tags: {
      workload: "Orbit",
      environment: "prod",
      owner: "Ryan Gutridge",
      "cost-center": "CC-Orbit",
      criticality: "high",
    },
    owners: ["Ryan Gutridge"],
    userAuth: "entra",
  },
  {
    id: "kinisis-labs",
    name: "Kinisis Labs",
    environment: "prod",
    region: "eastus2",
    resourceGroup: "rg-kinisislabs-web-prod-eus2",
    status: "healthy",
    activeAlerts: 0,
    monthToDateCost: 47.18,
    subscriptionId: "a1f4-shared-platform",
    description: "Public marketing site for Kinisis Labs (kinisislabs.com).",
    tags: {
      workload: "KinisisLabs",
      environment: "prod",
      owner: "Ryan Gutridge",
      "cost-center": "CC-Platform",
      criticality: "medium",
    },
    owners: ["Ryan Gutridge"],
    userAuth: "none",
  },
];

// ---------------------------------------------------------------------------
// Startup validation: every APPS entry must satisfy the GetAppResponse schema.
// This ensures the inventory stays consistent with the OpenAPI contract.
// The server refuses to start if any entry is invalid.
// ---------------------------------------------------------------------------
const _appsValidation = GetAppResponse.array().safeParse(APPS);
if (!_appsValidation.success) {
  const formatted = _appsValidation.error.format();
  throw new Error(
    `APPS inventory validation failed — fix the entries before starting the server:\n` +
      JSON.stringify(formatted, null, 2),
  );
}

// Deterministic pseudo-random so the dashboard feels stable across requests
// while still varying per app / metric.
function seededRand(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeSeries(
  seed: string,
  name: string,
  unit: string,
  hours: number,
  base: number,
  jitter: number,
) {
  const rand = seededRand(seed + name);
  const now = Date.now();
  const points = Array.from({ length: hours }, (_, i) => {
    const t = new Date(now - (hours - 1 - i) * 60 * 60 * 1000).toISOString();
    const value =
      base + Math.sin(i / 3) * jitter * 0.4 + (rand() - 0.5) * jitter;
    return { timestamp: t, value: Number(value.toFixed(2)) };
  });
  return { name, unit, points };
}

function makeDaily(seed: string, days: number, base: number) {
  const rand = seededRand(seed + "daily");
  const now = new Date();
  // Generate 7 extra prior-week values so every day in the visible window
  // has a vsLastWeek comparison point.
  const totalDays = days + 7;
  const values = Array.from({ length: totalDays }, () =>
    Number((base * (0.6 + rand() * 0.8)).toFixed(2))
  );
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(now);
    d.setUTCHours(0, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() - (days - 1 - i));
    const cur = values[i + 7];
    const prev = values[i]; // same relative day, 7 indices back
    const vsLastWeek = prev > 0 ? Number(((cur - prev) / prev * 100).toFixed(1)) : null;
    return {
      timestamp: d.toISOString(),
      value: cur,
      vsLastWeek,
    };
  });
}

export function findApp(id: string): AppRecord | undefined {
  return APPS.find((a) => a.id === id);
}

// Apps whose END USERS authenticate via Clerk — the ones Orbit ingests
// user-activity webhooks for.
export function clerkApps(): AppRecord[] {
  return APPS.filter((a) => a.userAuth === "clerk");
}

// Apps that ship an Android build tracked in the Google Play Console — the ones
// the Play subscriptions surface reports subscriber states + revenue for.
export function playApps(): AppRecord[] {
  return APPS.filter((a) => Boolean(a.androidPackage));
}

function activeAlertCount(app: AppRecord): number {
  return buildAlertsForApp(app).filter((a) => a.status === "active").length;
}

// --- /apps ---
router.get("/apps", (_req, res) => {
  const data = ListAppsResponse.parse(
    APPS.map((app) => ({
      id: app.id,
      name: app.name,
      environment: app.environment,
      region: app.region,
      resourceGroup: app.resourceGroup,
      subscriptionId: app.subscriptionId,
      tags: app.tags,
      status: app.status,
      activeAlerts: activeAlertCount(app),
      monthToDateCost: app.monthToDateCost,
      group: app.group,
      userAuth: app.userAuth,
    })),
  );
  res.json(data);
});

router.get("/apps/:appId", async (req, res) => {
  const app = findApp(req.params.appId);
  if (!app) {
    res.status(404).json({ error: "App not found" });
    return;
  }
  const bypassCache = req.query["refresh"] === "true";
  const liveTags = await fetchResourceGroupTags(app, { bypassCache });
  const data = GetAppResponse.parse({
    ...app,
    tags: liveTags ?? app.tags,
    activeAlerts: activeAlertCount(app),
  });
  res.json(data);
});

// --- infrastructure ---
function mockInfraResources(app: AppRecord) {
  const rand = seededRand(app.id + "infra");
  return [
    {
      id: `${app.id}-app-plan`,
      name: `plan-${app.id}-prod`,
      type: "Microsoft.Web/serverFarms",
      status: app.status,
      location: app.region,
      cpuPercent: Number((30 + rand() * 50).toFixed(1)),
      memoryPercent: Number((40 + rand() * 40).toFixed(1)),
    },
    {
      id: `${app.id}-web`,
      name: `app-${app.id}-prod`,
      type: "Microsoft.Web/sites",
      status: app.status,
      location: app.region,
      cpuPercent: Number((15 + rand() * 60).toFixed(1)),
      memoryPercent: Number((25 + rand() * 55).toFixed(1)),
    },
    {
      id: `${app.id}-sql`,
      name: `sql-${app.id}-prod`,
      type: "Microsoft.Sql/servers/databases",
      status: app.status === "unhealthy" ? "degraded" : "healthy",
      location: app.region,
      cpuPercent: Number((10 + rand() * 70).toFixed(1)),
      memoryPercent: Number((30 + rand() * 40).toFixed(1)),
    },
    {
      id: `${app.id}-storage`,
      name: `st${app.id.replace(/-/g, "")}prod`,
      type: "Microsoft.Storage/storageAccounts",
      status: "healthy",
      location: app.region,
      cpuPercent: undefined,
      memoryPercent: undefined,
    },
    {
      id: `${app.id}-redis`,
      name: `redis-${app.id}-prod`,
      type: "Microsoft.Cache/Redis",
      status: app.status === "unhealthy" ? "unhealthy" : "healthy",
      location: app.region,
      cpuPercent: Number((20 + rand() * 30).toFixed(1)),
      memoryPercent: Number((40 + rand() * 40).toFixed(1)),
    },
  ];
}

router.get("/apps/:appId/infrastructure", async (req, res) => {
  const app = findApp(req.params.appId);
  if (!app) {
    res.status(404).json({ error: "App not found" });
    return;
  }
  const bypassCache = req.query["refresh"] === "true";
  const [liveResources, liveCpuSeries, liveMemSeries] = await Promise.all([
    fetchResourcesByResourceGroup(app, { bypassCache }),
    fetchAppTimeSeries(app, "cpu_pct", 24, { bypassCache }),
    fetchAppTimeSeries(app, "memory_pct", 24, { bypassCache }),
  ]);
  const resources = liveResources ?? mockInfraResources(app);
  const series = [
    {
      ...makeSeries(app.id, "CPU %", "%", 24, 45, 25),
      points: liveCpuSeries ?? makeSeries(app.id, "CPU %", "%", 24, 45, 25).points,
    },
    {
      ...makeSeries(app.id, "Memory %", "%", 24, 60, 20),
      points: liveMemSeries ?? makeSeries(app.id, "Memory %", "%", 24, 60, 20).points,
    },
    makeSeries(app.id, "Disk IOPS", "ops/s", 24, 1200, 600),
  ];
  const data = GetInfrastructureResponse.parse({ resources, series, dataSource: liveResources ? "live" : "mock" });
  res.json(data);
});

// --- network ---
function mockNetworkEndpoints(app: AppRecord) {
  const rand = seededRand(app.id + "net");
  return [
    {
      name: "Front Door",
      status: app.status === "unhealthy" ? "degraded" : "healthy",
      latencyMs: Number((30 + rand() * 40).toFixed(1)),
      packetLossPercent: Number((rand() * 0.3).toFixed(2)),
      region: app.region,
    },
    {
      name: "Application Gateway",
      status: "healthy",
      latencyMs: Number((10 + rand() * 15).toFixed(1)),
      packetLossPercent: 0,
      region: app.region,
    },
    {
      name: "Origin VNet Link",
      status: app.status,
      latencyMs: Number((2 + rand() * 6).toFixed(1)),
      packetLossPercent: Number((rand() * 0.1).toFixed(2)),
      region: app.region,
    },
    {
      name: "Private DNS",
      status: "healthy",
      latencyMs: Number((1 + rand() * 2).toFixed(2)),
      packetLossPercent: 0,
      region: "global",
    },
  ];
}

router.get("/apps/:appId/network", async (req, res) => {
  const app = findApp(req.params.appId);
  if (!app) {
    res.status(404).json({ error: "App not found" });
    return;
  }
  const bypassCache = req.query["refresh"] === "true";
  const liveEndpoints = await fetchNetworkEndpoints(app, { bypassCache });
  const endpoints = liveEndpoints ?? mockNetworkEndpoints(app);
  const throughput = [
    makeSeries(app.id, "Ingress (Mbps)", "Mbps", 24, 220, 120),
    makeSeries(app.id, "Egress (Mbps)", "Mbps", 24, 180, 100),
  ];
  const data = GetNetworkResponse.parse({ endpoints, throughput });
  res.json(data);
});

// --- cost ---
const API_COST_PER_MILLION = 3.5; // blended APIM + gateway egress unit price
const API_NAMES_BY_APP: Record<string, string[]> = {
  grailbabe: [
    "GET /products",
    "GET /products/{id}",
    "POST /orders",
    "GET /search",
    "POST /checkout",
    "GET /users/me",
    "POST /cart/items",
  ],
  orbit: [
    "GET /incidents",
    "POST /incidents",
    "GET /dashboards/{id}",
    "POST /deployments",
    "GET /runs",
    "POST /runbooks/execute",
  ],
  "kinisis-labs": [
    "GET /",
    "GET /about",
    "GET /pricing",
    "GET /blog",
    "GET /contact",
  ],
};

// Mocked month-to-date revenue per app, split by channel. Designed to mirror what
// real integrations would return (Stripe BalanceTransactions, App Store Connect
// Sales/Trends, Google Play earnings reports). orbit is internal -> $0.
const REVENUE_BY_APP: Record<string, { stripe: number; appStore: number; playStore: number }> = {
  grailbabe: { stripe: 28430.18, appStore: 9120.55, playStore: 4892.40 },
  orbit: { stripe: 0, appStore: 0, playStore: 0 },
  "kinisis-labs": { stripe: 0, appStore: 0, playStore: 0 },
};

const REVENUE_SOURCE_LABELS = {
  stripe: "Stripe",
  app_store: "Apple App Store",
  play_store: "Google Play Store",
} as const;

function revenueForApp(appId: string) {
  const r = REVENUE_BY_APP[appId] ?? { stripe: 0, appStore: 0, playStore: 0 };
  const bySource = [
    { source: "stripe" as const, label: REVENUE_SOURCE_LABELS.stripe, amount: Number(r.stripe.toFixed(2)) },
    { source: "app_store" as const, label: REVENUE_SOURCE_LABELS.app_store, amount: Number(r.appStore.toFixed(2)) },
    { source: "play_store" as const, label: REVENUE_SOURCE_LABELS.play_store, amount: Number(r.playStore.toFixed(2)) },
  ];
  const total = Number((r.stripe + r.appStore + r.playStore).toFixed(2));
  return { currency: "USD", total, bySource };
}

function splitInts(total: number, weights: number[]): number[] {
  const sum = weights.reduce((s, w) => s + w, 0);
  const out = weights.map((w) => Math.floor((total * w) / sum));
  let remainder = total - out.reduce((s, v) => s + v, 0);
  for (let i = 0; remainder > 0; i = (i + 1) % out.length, remainder--) out[i] += 1;
  return out;
}

function apiUsageForApp(app: AppRecord) {
  const rand = seededRand(app.id + "api");
  const baseCalls = 8_000_000 + Math.floor(rand() * 42_000_000);
  const criticalityMultiplier =
    app.tags.criticality === "mission-critical" ? 3.2 :
    app.tags.criticality === "high" ? 2.0 :
    app.tags.criticality === "medium" ? 1.0 : 0.4;
  const totalCalls = Math.floor(baseCalls * criticalityMultiplier);
  const cost = Number(((totalCalls / 1_000_000) * API_COST_PER_MILLION).toFixed(2));

  const names = API_NAMES_BY_APP[app.id] ?? ["GET /", "POST /", "GET /health"];
  const weightRand = seededRand(app.id + "apiweights");
  const weights = names.map(() => 1 + weightRand() * 9);
  const callsPerApi = splitInts(totalCalls, weights);
  // Allocate cost in cents using the same call weights so sum(byApi.cost) === cost exactly.
  const totalCents = Math.round(cost * 100);
  const centsPerApi = splitInts(totalCents, callsPerApi.map((c) => Math.max(c, 1)));
  const byApi = names.map((name, i) => ({
    name,
    totalCalls: callsPerApi[i] ?? 0,
    cost: (centsPerApi[i] ?? 0) / 100,
  })).sort((a, b) => b.cost - a.cost);

  return { totalCalls, costPerMillion: API_COST_PER_MILLION, cost, byApi };
}

const MOCK_SERVICE_TRENDS: Record<string, string> = {
  "App Service":          "+6.3%",
  "Azure SQL":            "-2.1%",
  "API Management":       "+11.4%",
  "Storage":              "+0.8%",
  "Application Insights": "+3.2%",
  "Front Door":           "-1.5%",
  "Redis Cache":          "+5.7%",
  "Other":                "+2.9%",
};

function buildByServiceForApp(
  app: AppRecord,
  apiUsage: { cost: number },
): { service: string; amount: number; trend?: string }[] {
  const infraBudget = app.monthToDateCost;
  return [
    { service: "App Service",          amount: Number((infraBudget * 0.32).toFixed(2)), trend: MOCK_SERVICE_TRENDS["App Service"] },
    { service: "Azure SQL",            amount: Number((infraBudget * 0.24).toFixed(2)), trend: MOCK_SERVICE_TRENDS["Azure SQL"] },
    { service: "API Management",       amount: apiUsage.cost,                           trend: MOCK_SERVICE_TRENDS["API Management"] },
    { service: "Storage",              amount: Number((infraBudget * 0.08).toFixed(2)), trend: MOCK_SERVICE_TRENDS["Storage"] },
    { service: "Application Insights", amount: Number((infraBudget * 0.11).toFixed(2)), trend: MOCK_SERVICE_TRENDS["Application Insights"] },
    { service: "Front Door",           amount: Number((infraBudget * 0.14).toFixed(2)), trend: MOCK_SERVICE_TRENDS["Front Door"] },
    { service: "Redis Cache",          amount: Number((infraBudget * 0.07).toFixed(2)), trend: MOCK_SERVICE_TRENDS["Redis Cache"] },
    { service: "Other",                amount: Number((infraBudget * 0.04).toFixed(2)), trend: MOCK_SERVICE_TRENDS["Other"] },
  ];
}

router.get("/apps/:appId/cost", async (req, res) => {
  const app = findApp(req.params.appId);
  if (!app) {
    res.status(404).json({ error: "App not found" });
    return;
  }
  const bypassCache = req.query["refresh"] === "true";
  const apiUsage = apiUsageForApp(app);
  const liveCost = await fetchMonthToDateCost(app, { bypassCache });
  const mtd = liveCost
    ? liveCost.monthToDate
    : Number((app.monthToDateCost + apiUsage.cost).toFixed(2));
  const byService = liveCost
    ? liveCost.byService
    : buildByServiceForApp(app, apiUsage);
  const data = GetCostResponse.parse({
    currency: "USD",
    monthToDate: mtd,
    forecast: Number((mtd * 1.7).toFixed(2)),
    budget: Number((mtd * 2.0).toFixed(2)),
    daily: makeDaily(app.id, 30, mtd / 18),
    byService,
    apiUsage,
    revenue: revenueForApp(app.id),
    dataSource: liveCost ? "live" : "mock",
    ...(liveCost ? { dataAsOf: liveCost.dataAsOf } : {}),
  });
  res.json(data);
});

// --- telemetry ---
router.get("/apps/:appId/telemetry", async (req, res) => {
  const app = findApp(req.params.appId);
  if (!app) {
    res.status(404).json({ error: "App not found" });
    return;
  }
  const bypassCache = req.query["refresh"] === "true";
  const rand = seededRand(app.id + "tel");
  const sick = app.status === "unhealthy";

  // Fetch point-in-time summary and all three time-series in parallel.
  const [liveMetrics, liveRpmSeries, liveLatenSeries, liveErrSeries] =
    await Promise.all([
      fetchAppMetrics(app, { bypassCache }),
      fetchAppTimeSeries(app, "requests_per_min", 24, { bypassCache }),
      fetchAppTimeSeries(app, "p95_latency_ms", 24, { bypassCache }),
      fetchAppTimeSeries(app, "error_rate_pct", 24, { bypassCache }),
    ]);


  const data = GetTelemetryResponse.parse({
    requestsPerMin: liveMetrics?.requestsPerMin ?? Number((400 + rand() * 1200).toFixed(0)),
    p95LatencyMs: liveMetrics?.p95LatencyMs ?? Number(((sick ? 800 : 220) + rand() * 200).toFixed(0)),
    errorRatePercent: liveMetrics?.errorRatePercent ?? Number(((sick ? 4.2 : 0.3) + rand() * 0.6).toFixed(2)),
    availabilityPercent: liveMetrics?.availabilityPercent ?? Number((sick ? 97.4 : 99.92).toFixed(2)),
    series: [
      {
        ...makeSeries(app.id, "Requests / min", "rpm", 24, liveMetrics?.requestsPerMin ?? 800, 300),
        points: liveRpmSeries ?? makeSeries(app.id, "Requests / min", "rpm", 24, liveMetrics?.requestsPerMin ?? 800, 300).points,
      },
      {
        ...makeSeries(app.id, "P95 latency (ms)", "ms", 24, liveMetrics?.p95LatencyMs ?? (sick ? 700 : 220), 120),
        points: liveLatenSeries ?? makeSeries(app.id, "P95 latency (ms)", "ms", 24, liveMetrics?.p95LatencyMs ?? (sick ? 700 : 220), 120).points,
      },
      {
        ...makeSeries(app.id, "Error rate (%)", "%", 24, liveMetrics?.errorRatePercent ?? (sick ? 4 : 0.4), 1.2),
        points: liveErrSeries ?? makeSeries(app.id, "Error rate (%)", "%", 24, liveMetrics?.errorRatePercent ?? (sick ? 4 : 0.4), 1.2).points,
      },
    ],
    topErrors: [
      {
        message: "TimeoutException: upstream call to the ledger service exceeded 5s",
        count: sick ? 412 : 18,
        lastSeen: new Date(Date.now() - 1000 * 60 * 4).toISOString(),
      },
      {
        message: "Npgsql.NpgsqlException: connection pool exhausted",
        count: sick ? 188 : 6,
        lastSeen: new Date(Date.now() - 1000 * 60 * 22).toISOString(),
      },
      {
        message: "ArgumentNullException at OrderService.Process()",
        count: sick ? 74 : 11,
        lastSeen: new Date(Date.now() - 1000 * 60 * 67).toISOString(),
      },
    ],
    dataSource: liveMetrics ? "live" : "mock",
  });
  res.json(data);
});

// --- alerts ---
const SOURCES = [
  "AzureMonitor",
  "LogAnalytics",
  "NetworkWatcher",
  "CostManagement",
  "ApplicationInsights",
  "WebAppTelemetry",
] as const;

function buildAlertsForApp(app: AppRecord) {
  const rand = seededRand(app.id + "alerts");
  const out: Array<{
    id: string;
    appId: string;
    appName: string;
    title: string;
    description: string;
    severity: Severity;
    source: (typeof SOURCES)[number];
    firedAt: string;
    status: "active" | "acknowledged" | "resolved";
  }> = [];
  const templates: Array<{ title: string; severity: Severity; source: (typeof SOURCES)[number]; description: string }> = [
    {
      title: "P95 latency above 750ms for 10m",
      severity: "warning",
      source: "ApplicationInsights",
      description: "End-to-end P95 latency exceeded threshold on the primary endpoint.",
    },
    {
      title: "HTTP 5xx error rate > 2%",
      severity: "error",
      source: "ApplicationInsights",
      description: "Error rate surged above the 2% SLO threshold over the last 5 minutes.",
    },
    {
      title: "Forecast spend exceeds budget by 30%",
      severity: "warning",
      source: "CostManagement",
      description: "Projected end-of-month spend is forecast to exceed budget by more than 30%.",
    },
    {
      title: "Front Door origin health degraded",
      severity: "critical",
      source: "NetworkWatcher",
      description: "Origin probe failing in one of three regions; failover in effect.",
    },
    {
      title: "SQL DTU sustained above 90%",
      severity: "warning",
      source: "AzureMonitor",
      description: "Azure SQL database DTU consumption above 90% for 15+ minutes.",
    },
    {
      title: "Log ingestion volume up 4x",
      severity: "info",
      source: "LogAnalytics",
      description: "Unusual increase in log ingestion volume detected for the workspace.",
    },
  ];
  const count = Math.min(app.activeAlerts + (app.status === "healthy" ? 1 : 2), templates.length);
  for (let i = 0; i < count; i++) {
    const t = templates[i]!;
    const minsAgo = Math.floor(rand() * 240) + 2;
    out.push({
      id: `${app.id}-alert-${i + 1}`,
      appId: app.id,
      appName: app.name,
      title: t.title,
      description: t.description,
      severity: t.severity,
      source: t.source,
      firedAt: new Date(Date.now() - minsAgo * 60 * 1000).toISOString(),
      status: i === 0 && app.status !== "healthy" ? "active" : i % 3 === 0 ? "acknowledged" : "active",
    });
  }
  return out;
}

router.get("/apps/:appId/alerts", async (req, res) => {
  const app = findApp(req.params.appId);
  if (!app) {
    res.status(404).json({ error: "App not found" });
    return;
  }
  const bypassCache = req.query["refresh"] === "true";
  const liveAlerts = await fetchActiveAlerts(app, { bypassCache });
  const alerts = liveAlerts ?? buildAlertsForApp(app);
  const data = GetAppAlertsResponse.parse(alerts);
  res.json(data);
});

// --- global ---
router.get("/global/health", (_req, res) => {
  const totals = APPS.reduce(
    (acc, a) => {
      acc.totalApps += 1;
      acc.activeAlerts += activeAlertCount(a);
      acc.monthToDateCost += a.monthToDateCost;
      if (a.status === "healthy") acc.healthy += 1;
      else if (a.status === "degraded") acc.degraded += 1;
      else if (a.status === "unhealthy") acc.unhealthy += 1;
      return acc;
    },
    { totalApps: 0, healthy: 0, degraded: 0, unhealthy: 0, activeAlerts: 0, monthToDateCost: 0 },
  );
  const data = GetGlobalHealthResponse.parse({
    ...totals,
    monthToDateCost: Number(totals.monthToDateCost.toFixed(2)),
    currency: "USD",
  });
  res.json(data);
});

router.get("/global/alerts", (_req, res) => {
  const all = APPS.flatMap(buildAlertsForApp).sort((a, b) =>
    a.firedAt < b.firedAt ? 1 : -1,
  );
  const data = ListGlobalAlertsResponse.parse(all);
  res.json(data);
});

router.get("/global/cost-summary", async (req, res) => {
  const apiByApp = new Map(APPS.map((a) => [a.id, apiUsageForApp(a)] as const));

  const bypassCache = req.query["refresh"] === "true";
  // Fetch live Azure cost for every app in parallel; falls back to null (mock) when unconfigured.
  const liveCostResults = await Promise.all(APPS.map((a) => fetchMonthToDateCost(a, { bypassCache })));
  const liveCostByApp = new Map(APPS.map((a, i) => [a.id, liveCostResults[i]] as const));

  const apiCost = APPS.reduce((s, a) => s + (apiByApp.get(a.id)?.cost ?? 0), 0);
  const apiCalls = APPS.reduce((s, a) => s + (apiByApp.get(a.id)?.totalCalls ?? 0), 0);

  // Per-app infra cost: prefer real Azure data, fall back to mock monthToDateCost.
  const infraCostByApp = new Map(
    APPS.map((a) => {
      const live = liveCostByApp.get(a.id);
      return [a.id, live ? live.monthToDate : a.monthToDateCost] as const;
    }),
  );

  const mtd = APPS.reduce((s, a) => s + infraCostByApp.get(a.id)!, 0) + apiCost;

  const revenueByApp = APPS.map((a) => {
    const r = REVENUE_BY_APP[a.id] ?? { stripe: 0, appStore: 0, playStore: 0 };
    const total = Number((r.stripe + r.appStore + r.playStore).toFixed(2));
    const cost = Number((infraCostByApp.get(a.id)! + (apiByApp.get(a.id)?.cost ?? 0)).toFixed(2));
    const net = Number((total - cost).toFixed(2));
    return {
      appId: a.id,
      appName: a.name,
      total,
      stripe: Number(r.stripe.toFixed(2)),
      appStore: Number(r.appStore.toFixed(2)),
      playStore: Number(r.playStore.toFixed(2)),
      cost,
      net,
      marginPercent: total > 0 ? Number(((net / total) * 100).toFixed(1)) : null,
    };
  }).sort((a, b) => b.total - a.total);

  const totalStripe = revenueByApp.reduce((s, r) => s + r.stripe, 0);
  const totalAppStore = revenueByApp.reduce((s, r) => s + r.appStore, 0);
  const totalPlayStore = revenueByApp.reduce((s, r) => s + r.playStore, 0);
  const totalRevenue = Number((totalStripe + totalAppStore + totalPlayStore).toFixed(2));
  const revenue = {
    currency: "USD",
    total: totalRevenue,
    bySource: [
      { source: "stripe" as const, label: REVENUE_SOURCE_LABELS.stripe, amount: Number(totalStripe.toFixed(2)) },
      { source: "app_store" as const, label: REVENUE_SOURCE_LABELS.app_store, amount: Number(totalAppStore.toFixed(2)) },
      { source: "play_store" as const, label: REVENUE_SOURCE_LABELS.play_store, amount: Number(totalPlayStore.toFixed(2)) },
    ],
  };

  // Aggregate byService across all apps. Use live Azure service breakdown when available.
  // Track amount and weighted trend per service so the global table can show WoW.
  const byResourceMap = new Map<string, { amount: number; weightedTrendSum: number; trendWeight: number }>();
  for (const a of APPS) {
    const usage = apiByApp.get(a.id)!;
    const live = liveCostByApp.get(a.id);
    const lines = live ? live.byService : buildByServiceForApp(a, usage);
    for (const line of lines) {
      const existing = byResourceMap.get(line.service) ?? { amount: 0, weightedTrendSum: 0, trendWeight: 0 };
      let weightedTrendSum = existing.weightedTrendSum;
      let trendWeight = existing.trendWeight;
      if (line.trend != null) {
        const sign = line.trend.startsWith("-") ? -1 : 1;
        const pct = parseFloat(line.trend.replace(/[^0-9.]/g, "")) * sign;
        if (!isNaN(pct)) {
          weightedTrendSum += pct * line.amount;
          trendWeight += line.amount;
        }
      }
      byResourceMap.set(line.service, {
        amount: existing.amount + line.amount,
        weightedTrendSum,
        trendWeight,
      });
    }
  }
  const byResource = Array.from(byResourceMap.entries())
    .map(([service, { amount, weightedTrendSum, trendWeight }]) => {
      const roundedAmount = Number(amount.toFixed(2));
      let trend: string | undefined;
      if (trendWeight > 0) {
        const avg = weightedTrendSum / trendWeight;
        trend = (avg >= 0 ? "+" : "") + avg.toFixed(1) + "%";
      }
      return { service, amount: roundedAmount, ...(trend !== undefined ? { trend } : {}) };
    })
    .sort((a, b) => b.amount - a.amount);

  const anyLive = liveCostResults.some((r) => r !== null);
  const liveTimestamps = liveCostResults.filter((r) => r !== null).map((r) => r!.dataAsOf);
  const earliestDataAsOf = liveTimestamps.length > 0
    ? liveTimestamps.reduce((min, t) => (t < min ? t : min))
    : undefined;

  const data = GetGlobalCostSummaryResponse.parse({
    currency: "USD",
    monthToDate: Number(mtd.toFixed(2)),
    forecast: Number((mtd * 1.65).toFixed(2)),
    budget: Number((mtd * 2.0).toFixed(2)),
    daily: makeDaily("global", 30, mtd / 30),
    apiCalls,
    apiCost: Number(apiCost.toFixed(2)),
    dataSource: anyLive ? "live" : "mock",
    ...(earliestDataAsOf ? { dataAsOf: earliestDataAsOf } : {}),
    byApp: APPS.map((a) => ({
      appId: a.id,
      appName: a.name,
      amount: Number((infraCostByApp.get(a.id)! + (apiByApp.get(a.id)?.cost ?? 0)).toFixed(2)),
    })),
    byResource,
    apiByApp: APPS.map((a) => {
      const u = apiByApp.get(a.id)!;
      return {
        appId: a.id,
        appName: a.name,
        totalCalls: u.totalCalls,
        costPerMillion: u.costPerMillion,
        cost: u.cost,
      };
    }).sort((a, b) => b.cost - a.cost),
    apiByName: APPS.flatMap((a) => {
      const u = apiByApp.get(a.id)!;
      return u.byApi.map((row) => ({
        appId: a.id,
        appName: a.name,
        apiName: row.name,
        totalCalls: row.totalCalls,
        cost: row.cost,
      }));
    }).sort((a, b) => b.cost - a.cost),
    revenue,
    revenueByApp,
  });
  res.json(data);
});

export default router;
