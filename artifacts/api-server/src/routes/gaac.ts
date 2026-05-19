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

const router: IRouter = Router();

type Status = "healthy" | "degraded" | "unhealthy" | "unknown";
type Severity = "info" | "warning" | "error" | "critical";

type AppRecord = {
  id: string;
  name: string;
  environment: "prod" | "staging" | "dev";
  region: string;
  resourceGroup: string;
  status: Status;
  activeAlerts: number;
  monthToDateCost: number;
  subscriptionId: string;
  description: string;
  tags: Record<string, string>;
  owners: string[];
};

const APPS: AppRecord[] = [
  {
    id: "grailbabe",
    name: "GrailBabe",
    environment: "prod",
    region: "eastus2",
    resourceGroup: "rg-grailbabe-prod",
    status: "healthy",
    activeAlerts: 1,
    monthToDateCost: 4128.42,
    subscriptionId: "a1f4-shared-platform",
    description: "Consumer marketplace for limited-edition collectibles.",
    tags: { owner: "platform", tier: "tier-1", costCenter: "CC-1042" },
    owners: ["platform-eng@kinisis.io", "sre@kinisis.io"],
  },
  {
    id: "grailbabe-dev",
    name: "GrailBabe (dev)",
    environment: "dev",
    region: "eastus2",
    resourceGroup: "rg-grailbabe-dev",
    status: "degraded",
    activeAlerts: 2,
    monthToDateCost: 318.74,
    subscriptionId: "a1f4-shared-platform",
    description: "Development environment for the GrailBabe consumer marketplace.",
    tags: { owner: "platform", tier: "tier-3", costCenter: "CC-1042", env: "dev" },
    owners: ["platform-eng@kinisis.io"],
  },
  {
    id: "kinisis-id",
    name: "Kinisis ID",
    environment: "prod",
    region: "eastus2",
    resourceGroup: "rg-kid-prod",
    status: "degraded",
    activeAlerts: 3,
    monthToDateCost: 2218.07,
    subscriptionId: "a1f4-shared-platform",
    description: "Identity and SSO platform for all Kinisis-managed apps.",
    tags: { owner: "identity", tier: "tier-0", costCenter: "CC-1001" },
    owners: ["identity@kinisis.io"],
  },
  {
    id: "ops-portal",
    name: "Ops Portal",
    environment: "prod",
    region: "centralus",
    resourceGroup: "rg-ops-prod",
    status: "healthy",
    activeAlerts: 0,
    monthToDateCost: 612.33,
    subscriptionId: "b203-internal-tools",
    description: "Internal engineering operations portal.",
    tags: { owner: "platform", tier: "tier-2", costCenter: "CC-1042" },
    owners: ["platform-eng@kinisis.io"],
  },
  {
    id: "ledger-api",
    name: "Ledger API",
    environment: "prod",
    region: "westus2",
    resourceGroup: "rg-ledger-prod",
    status: "unhealthy",
    activeAlerts: 5,
    monthToDateCost: 3890.14,
    subscriptionId: "c508-finance",
    description: "Double-entry ledger service backing all transactional apps.",
    tags: { owner: "finance-eng", tier: "tier-0", costCenter: "CC-2200" },
    owners: ["finance-eng@kinisis.io", "sre@kinisis.io"],
  },
  {
    id: "atlas-cms",
    name: "Atlas CMS",
    environment: "staging",
    region: "eastus2",
    resourceGroup: "rg-atlas-stg",
    status: "healthy",
    activeAlerts: 0,
    monthToDateCost: 184.55,
    subscriptionId: "b203-internal-tools",
    description: "Headless CMS powering marketing surfaces.",
    tags: { owner: "marketing-eng", tier: "tier-3", costCenter: "CC-3010" },
    owners: ["marketing-eng@kinisis.io"],
  },
];

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
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(now);
    d.setUTCHours(0, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() - (days - 1 - i));
    return {
      timestamp: d.toISOString(),
      value: Number((base * (0.6 + rand() * 0.8)).toFixed(2)),
    };
  });
}

function findApp(id: string): AppRecord | undefined {
  return APPS.find((a) => a.id === id);
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
      status: app.status,
      activeAlerts: activeAlertCount(app),
      monthToDateCost: app.monthToDateCost,
    })),
  );
  res.json(data);
});

router.get("/apps/:appId", (req, res) => {
  const app = findApp(req.params.appId);
  if (!app) {
    res.status(404).json({ error: "App not found" });
    return;
  }
  const data = GetAppResponse.parse({
    ...app,
    activeAlerts: activeAlertCount(app),
  });
  res.json(data);
});

// --- infrastructure ---
router.get("/apps/:appId/infrastructure", (req, res) => {
  const app = findApp(req.params.appId);
  if (!app) {
    res.status(404).json({ error: "App not found" });
    return;
  }
  const rand = seededRand(app.id + "infra");
  const resources = [
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
  const series = [
    makeSeries(app.id, "CPU %", "%", 24, 45, 25),
    makeSeries(app.id, "Memory %", "%", 24, 60, 20),
    makeSeries(app.id, "Disk IOPS", "ops/s", 24, 1200, 600),
  ];
  const data = GetInfrastructureResponse.parse({ resources, series });
  res.json(data);
});

// --- network ---
router.get("/apps/:appId/network", (req, res) => {
  const app = findApp(req.params.appId);
  if (!app) {
    res.status(404).json({ error: "App not found" });
    return;
  }
  const rand = seededRand(app.id + "net");
  const endpoints = [
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
  "grailbabe-dev": [
    "GET /products",
    "GET /products/{id}",
    "POST /orders",
    "GET /search",
    "POST /checkout",
    "GET /users/me",
    "POST /cart/items",
  ],
  "kinisis-id": [
    "POST /oauth/token",
    "POST /sessions",
    "GET /users/{id}",
    "POST /mfa/verify",
    "POST /signup",
    "GET /jwks",
    "POST /password/reset",
  ],
  "ops-portal": [
    "GET /incidents",
    "POST /incidents",
    "GET /dashboards/{id}",
    "POST /deployments",
    "GET /runs",
    "POST /runbooks/execute",
  ],
  "ledger-api": [
    "POST /transactions",
    "GET /accounts/{id}/balance",
    "GET /accounts",
    "POST /journals",
    "GET /transactions",
    "POST /reconciliations",
    "GET /reports/trial-balance",
  ],
  "atlas-cms": [
    "GET /pages",
    "POST /pages",
    "GET /media",
    "POST /media/upload",
    "POST /publish",
    "GET /drafts",
  ],
};

// Mocked month-to-date revenue per app, split by channel. Designed to mirror what
// real integrations would return (Stripe BalanceTransactions, App Store Connect
// Sales/Trends, Google Play earnings reports). ops-portal is internal -> $0.
const REVENUE_BY_APP: Record<string, { stripe: number; appStore: number; playStore: number }> = {
  grailbabe: { stripe: 28430.18, appStore: 9120.55, playStore: 4892.40 },
  "grailbabe-dev": { stripe: 0, appStore: 0, playStore: 0 },
  "kinisis-id": { stripe: 18764.22, appStore: 0, playStore: 0 },
  "ops-portal": { stripe: 0, appStore: 0, playStore: 0 },
  "ledger-api": { stripe: 22518.96, appStore: 0, playStore: 0 },
  "atlas-cms": { stripe: 2104.50, appStore: 0, playStore: 0 },
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
  const tierMultiplier =
    app.tags.tier === "tier-0" ? 3.2 :
    app.tags.tier === "tier-1" ? 2.0 :
    app.tags.tier === "tier-2" ? 1.0 : 0.4;
  const totalCalls = Math.floor(baseCalls * tierMultiplier);
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

function buildByServiceForApp(
  app: AppRecord,
  apiUsage: { cost: number },
): { service: string; amount: number }[] {
  const infraBudget = app.monthToDateCost;
  return [
    { service: "App Service", amount: Number((infraBudget * 0.32).toFixed(2)) },
    { service: "Azure SQL", amount: Number((infraBudget * 0.24).toFixed(2)) },
    { service: "API Management", amount: apiUsage.cost },
    { service: "Storage", amount: Number((infraBudget * 0.08).toFixed(2)) },
    { service: "Application Insights", amount: Number((infraBudget * 0.11).toFixed(2)) },
    { service: "Front Door", amount: Number((infraBudget * 0.14).toFixed(2)) },
    { service: "Redis Cache", amount: Number((infraBudget * 0.07).toFixed(2)) },
    { service: "Other", amount: Number((infraBudget * 0.04).toFixed(2)) },
  ];
}

router.get("/apps/:appId/cost", (req, res) => {
  const app = findApp(req.params.appId);
  if (!app) {
    res.status(404).json({ error: "App not found" });
    return;
  }
  const apiUsage = apiUsageForApp(app);
  const mtd = Number((app.monthToDateCost + apiUsage.cost).toFixed(2));
  const data = GetCostResponse.parse({
    currency: "USD",
    monthToDate: mtd,
    forecast: Number((mtd * 1.7).toFixed(2)),
    budget: Number((mtd * 2.0).toFixed(2)),
    daily: makeDaily(app.id, 30, mtd / 18),
    byService: buildByServiceForApp(app, apiUsage),
    apiUsage,
    revenue: revenueForApp(app.id),
  });
  res.json(data);
});

// --- telemetry ---
router.get("/apps/:appId/telemetry", (req, res) => {
  const app = findApp(req.params.appId);
  if (!app) {
    res.status(404).json({ error: "App not found" });
    return;
  }
  const rand = seededRand(app.id + "tel");
  const sick = app.status === "unhealthy";
  const data = GetTelemetryResponse.parse({
    requestsPerMin: Number((400 + rand() * 1200).toFixed(0)),
    p95LatencyMs: Number(((sick ? 800 : 220) + rand() * 200).toFixed(0)),
    errorRatePercent: Number(((sick ? 4.2 : 0.3) + rand() * 0.6).toFixed(2)),
    availabilityPercent: Number((sick ? 97.4 : 99.92).toFixed(2)),
    series: [
      makeSeries(app.id, "Requests / min", "rpm", 24, 800, 300),
      makeSeries(app.id, "P95 latency (ms)", "ms", 24, sick ? 700 : 220, 120),
      makeSeries(app.id, "Error rate (%)", "%", 24, sick ? 4 : 0.4, 1.2),
    ],
    topErrors: [
      {
        message: "TimeoutException: upstream call to ledger-api exceeded 5s",
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

router.get("/apps/:appId/alerts", (req, res) => {
  const app = findApp(req.params.appId);
  if (!app) {
    res.status(404).json({ error: "App not found" });
    return;
  }
  const data = GetAppAlertsResponse.parse(buildAlertsForApp(app));
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

router.get("/global/cost-summary", (_req, res) => {
  const apiByApp = new Map(APPS.map((a) => [a.id, apiUsageForApp(a)] as const));
  const apiCost = APPS.reduce((s, a) => s + (apiByApp.get(a.id)?.cost ?? 0), 0);
  const apiCalls = APPS.reduce((s, a) => s + (apiByApp.get(a.id)?.totalCalls ?? 0), 0);
  const mtd = APPS.reduce((s, a) => s + a.monthToDateCost, 0) + apiCost;

  const revenueByApp = APPS.map((a) => {
    const r = REVENUE_BY_APP[a.id] ?? { stripe: 0, appStore: 0, playStore: 0 };
    const total = Number((r.stripe + r.appStore + r.playStore).toFixed(2));
    const cost = Number((a.monthToDateCost + (apiByApp.get(a.id)?.cost ?? 0)).toFixed(2));
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

  // Aggregate byService across all apps, preserving insertion order.
  const byResourceMap = new Map<string, number>();
  for (const a of APPS) {
    const usage = apiByApp.get(a.id)!;
    for (const line of buildByServiceForApp(a, usage)) {
      byResourceMap.set(line.service, (byResourceMap.get(line.service) ?? 0) + line.amount);
    }
  }
  const byResource = Array.from(byResourceMap.entries())
    .map(([service, amount]) => ({ service, amount: Number(amount.toFixed(2)) }))
    .sort((a, b) => b.amount - a.amount);

  const data = GetGlobalCostSummaryResponse.parse({
    currency: "USD",
    monthToDate: Number(mtd.toFixed(2)),
    forecast: Number((mtd * 1.65).toFixed(2)),
    budget: Number((mtd * 2.0).toFixed(2)),
    apiCalls,
    apiCost: Number(apiCost.toFixed(2)),
    byApp: APPS.map((a) => ({
      appId: a.id,
      appName: a.name,
      amount: Number((a.monthToDateCost + (apiByApp.get(a.id)?.cost ?? 0)).toFixed(2)),
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
