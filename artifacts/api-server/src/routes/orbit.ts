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
  ListDeploymentsResponse,
  ListActivityLogResponse,
  QueryLogsResponse,
  ListServiceHealthResponse,
  ListSlosResponse,
  ListGlobalEndpointsResponse,
  GetAppThresholdsResponse,
  UpdateAppThresholdsBody,
} from "@workspace/api-zod";
import { db, appThresholdsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireEngineerOrAdmin } from "../middlewares/auth.js";
import { fetchResourcesByResourceGroup, fetchResourceGroupTags } from "../lib/azureResources.js";
import { fetchMonthToDateCost, fetchMonthToDateCostWithFallback } from "../lib/azureCost.js";
import { fetchBudgetForAppWithFallback } from "../lib/azureBudgets.js";
import { fetchSubscriptionNames } from "../lib/azureSubscriptions.js";
import {
  fetchAppMetrics,
  fetchAppTimeSeries,
  fetchTopExceptions,
  isMonitorConfigured,
  getLogAnalyticsWorkspaceId,
} from "../lib/azureMonitor.js";
import { isAzureConfigured } from "../lib/azure.js";
import { fetchActiveAlerts } from "../lib/azureAlerts.js";
import { fetchNetworkEndpoints } from "../lib/azureNetwork.js";
import { fetchDeployments } from "../lib/github.js";
import { fetchActivityLog } from "../lib/azureActivity.js";
import { fetchServiceHealth } from "../lib/azureServiceHealth.js";
import { isStripeConfigured } from "../lib/stripeClient.js";
import { syncStripeSales } from "../lib/stripeSync.js";
import { getLedgerMonthRevenue } from "../lib/ledger.js";
import { LogsQueryClient } from "@azure/monitor-query";

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
    subscriptionId: process.env.AZURE_SUB_GRAILBABE ?? "a1f4-shared-platform",
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
    iosBundle: "com.kinisislabs.grailbabe",
    appRepo: "GrailBabe",
    cpuThreshold: 75,
    memoryThreshold: 80,
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
    subscriptionId: process.env.AZURE_SUB_ORBIT ?? "b203-internal-tools",
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
    appRepo: "Orbit-Admin-Ctr",
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
    subscriptionId: process.env.AZURE_SUB_KINISIS_LABS ?? "a1f4-shared-platform",
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
  // Inject 1-2 deterministic anomaly spikes into the visible window so
  // operators can see the amber anomaly highlight in the demo environment.
  // Spike magnitude is 2.4-3.0× base; positions are seeded so they are
  // stable across reloads but vary per app.
  const spikeRand = seededRand(seed + "spikes");
  const spikeCount = Math.floor(spikeRand() * 2) + 1; // 1 or 2 spikes
  for (let s = 0; s < spikeCount; s++) {
    const pos = 7 + Math.floor(spikeRand() * days); // only in visible window
    values[pos] = Number((base * (2.4 + spikeRand() * 0.6)).toFixed(2));
  }
  // Always inject one spike 2 days ago so the cost-anomaly alert banner is
  // reliably visible in the demo / dev environment. Magnitude is seeded per
  // app but always in the 2.5-3.0× range so it clears the 2σ threshold.
  const recentSpikeRand = seededRand(seed + "recentspike");
  values[7 + days - 2] = Number((base * (2.5 + recentSpikeRand() * 0.5)).toFixed(2));
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

// Apps that ship an iOS build tracked in the Apple App Store — the ones
// the App Store subscriptions surface reports subscriber states + revenue for.
export function appStoreApps(): AppRecord[] {
  return APPS.filter((a) => Boolean(a.iosBundle));
}

function activeAlertCount(app: AppRecord): number {
  return buildAlertsForApp(app).filter((a) => a.status === "active").length;
}

// --- /apps ---
router.get("/apps", async (_req, res) => {
  // Fetch live cost, alert counts, budgets, and subscription names for all apps in parallel.
  // Falls back to static inventory values when Azure is unconfigured.
  const [alertResults, costWithSourceResults, budgetWithSourceResults] = await Promise.all([
    Promise.all(APPS.map((a) => fetchActiveAlerts(a, {}))),
    Promise.all(APPS.map((a) => fetchMonthToDateCostWithFallback(a, {}))),
    Promise.all(APPS.map((a) => fetchBudgetForAppWithFallback(a, {}))),
  ]);

  // Resolve subscription names from Azure once (cached; returns empty map in mock mode).
  const uniqueSubIds = [...new Set(APPS.map((a) => a.subscriptionId))];
  const subNames = await fetchSubscriptionNames(uniqueSubIds);

  const data = ListAppsResponse.parse(
    APPS.map((app, i) => {
      const liveAlerts = alertResults[i];
      const costWS = costWithSourceResults[i];
      const budgetWS = budgetWithSourceResults[i];
      const subName = subNames.get(app.subscriptionId.toLowerCase());
      const mtd = costWS ? costWS.result.monthToDate : app.monthToDateCost;
      const budget = budgetWS?.result.amount ?? Number((mtd * 2.0).toFixed(2));
      const forecastMultiplier = !budgetWS && app.id === "orbit" ? 2.3 : 1.7;
      const forecast =
        budgetWS?.result.forecastAmount !== null && budgetWS?.result.forecastAmount !== undefined
          ? budgetWS.result.forecastAmount
          : Number((mtd * forecastMultiplier).toFixed(2));
      return {
        id: app.id,
        name: app.name,
        environment: app.environment,
        region: app.region,
        resourceGroup: app.resourceGroup,
        subscriptionId: app.subscriptionId,
        ...(subName ? { subscriptionName: subName } : {}),
        tags: app.tags,
        status: app.status,
        activeAlerts: liveAlerts
          ? liveAlerts.filter((a) => a.status === "active").length
          : activeAlertCount(app),
        monthToDateCost: mtd,
        ...(budgetWS ? { budget: budgetWS.result.amount } : {}),
        ...(budgetWS?.result.forecastAmount !== null && budgetWS?.result.forecastAmount !== undefined
          ? { forecast: budgetWS.result.forecastAmount }
          : {}),
        forecastOverBudget: forecast > budget,
        group: app.group,
        userAuth: app.userAuth,
      };
    }),
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

// --- per-app threshold settings ---
const DEFAULT_CPU_THRESHOLD_GLOBAL = 80;
const DEFAULT_MEMORY_THRESHOLD_GLOBAL = 85;

/**
 * Load all DB threshold overrides in one query and return a Map<appId, {cpu, mem}>.
 * Numeric columns come back as strings from pg; parse them here.
 */
async function loadThresholdOverrides(): Promise<Map<string, { cpuThreshold: number; memoryThreshold: number }>> {
  const rows = await db.select().from(appThresholdsTable);
  const map = new Map<string, { cpuThreshold: number; memoryThreshold: number }>();
  for (const r of rows) {
    map.set(r.appId, {
      cpuThreshold: parseFloat(r.cpuThreshold),
      memoryThreshold: parseFloat(r.memoryThreshold),
    });
  }
  return map;
}

/** Resolve thresholds for an app: DB override → app record → global default. */
function resolveThresholds(app: AppRecord, override?: { cpuThreshold: number; memoryThreshold: number }) {
  return {
    cpuThreshold: override?.cpuThreshold ?? app.cpuThreshold ?? DEFAULT_CPU_THRESHOLD_GLOBAL,
    memoryThreshold: override?.memoryThreshold ?? app.memoryThreshold ?? DEFAULT_MEMORY_THRESHOLD_GLOBAL,
  };
}

router.get("/apps/:appId/thresholds", async (req, res) => {
  const app = findApp(req.params.appId);
  if (!app) {
    res.status(404).json({ error: "App not found" });
    return;
  }
  const [row] = await db
    .select()
    .from(appThresholdsTable)
    .where(eq(appThresholdsTable.appId, app.id));
  const override = row
    ? { cpuThreshold: parseFloat(row.cpuThreshold), memoryThreshold: parseFloat(row.memoryThreshold) }
    : undefined;
  const { cpuThreshold, memoryThreshold } = resolveThresholds(app, override);
  res.json(GetAppThresholdsResponse.parse({ appId: app.id, cpuThreshold, memoryThreshold }));
});

router.put("/apps/:appId/thresholds", requireEngineerOrAdmin, async (req, res) => {
  const app = findApp(req.params["appId"] as string);
  if (!app) {
    res.status(404).json({ error: "App not found" });
    return;
  }
  const parsed = UpdateAppThresholdsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.format() });
    return;
  }
  const { cpuThreshold, memoryThreshold } = parsed.data;
  const updatedBy = req.session.user?.userPrincipalName ?? "system";
  await db
    .insert(appThresholdsTable)
    .values({
      appId: app.id,
      cpuThreshold: String(cpuThreshold),
      memoryThreshold: String(memoryThreshold),
      updatedBy,
    })
    .onConflictDoUpdate({
      target: appThresholdsTable.appId,
      set: {
        cpuThreshold: String(cpuThreshold),
        memoryThreshold: String(memoryThreshold),
        updatedAt: new Date(),
        updatedBy,
      },
    });
  res.json(GetAppThresholdsResponse.parse({ appId: app.id, cpuThreshold, memoryThreshold }));
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

const REVENUE_SOURCE_LABELS = {
  stripe: "Stripe",
  app_store: "Apple App Store",
  play_store: "Google Play Store",
} as const;

// Only GrailBabe has a live Stripe integration today.
const STRIPE_SYNC_APPS = new Set(["grailbabe"]);
// Rate-limit Stripe syncs to once per 15 minutes per app to avoid
// hammering the Stripe API on every cost-route request.
const STRIPE_SYNC_TTL_MS = 15 * 60 * 1000;
const _stripeSyncTs = new Map<string, number>();

/**
 * Sync Stripe charges (rate-limited) then read current-month revenue from the
 * ledger for the given app. Non-Stripe channels (App Store, Play) are read
 * directly from ledger entries posted by their respective ingestion pipelines
 * when those come online.
 *
 * Returns zeroed object when no entries exist yet (before Stripe is configured
 * or before the app goes live), so revenue shows as $0 rather than stale mock
 * figures.
 */
async function syncAndReadRevenue(app: AppRecord): Promise<{ stripe: number; appStore: number; playStore: number }> {
  if (isStripeConfigured() && STRIPE_SYNC_APPS.has(app.id)) {
    const lastSync = _stripeSyncTs.get(app.id) ?? 0;
    if (Date.now() - lastSync > STRIPE_SYNC_TTL_MS) {
      _stripeSyncTs.set(app.id, Date.now());
      try {
        await syncStripeSales(app.id);
      } catch {
        // Non-fatal: the ledger still returns whatever was previously synced.
        _stripeSyncTs.delete(app.id); // allow retry next request
      }
    }
  }
  return getLedgerMonthRevenue(app.id);
}

function buildRevenueDto(r: { stripe: number; appStore: number; playStore: number }) {
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
  const [costWS, budgetWithSource, rev] = await Promise.all([
    fetchMonthToDateCostWithFallback(app, { bypassCache }),
    fetchBudgetForAppWithFallback(app, { bypassCache }),
    syncAndReadRevenue(app),
  ]);
  const liveCost = costWS?.result ?? null;
  const mtd = liveCost
    ? liveCost.monthToDate
    : Number((app.monthToDateCost + apiUsage.cost).toFixed(2));
  const byService = liveCost
    ? liveCost.byService
    : buildByServiceForApp(app, apiUsage);

  // Budget: prefer real Azure Budget resource or DB snapshot; fall back to 2× MTD formula.
  const budget = budgetWithSource?.result.amount ?? Number((mtd * 2.0).toFixed(2));
  // Forecast: prefer Azure Forecast API result or DB snapshot; fall back to 1.7× MTD formula.
  // In demo mode the Orbit app itself uses 2.3× to illustrate a budget-overrun warning.
  const forecastMultiplier = !budgetWithSource && app.id === "orbit" ? 2.3 : 1.7;
  const forecast = budgetWithSource?.result.forecastAmount ?? Number((mtd * forecastMultiplier).toFixed(2));
  const budgetDataSource = budgetWithSource?.source ?? "estimated";

  const data = GetCostResponse.parse({
    currency: "USD",
    monthToDate: mtd,
    forecast,
    budget,
    daily: makeDaily(app.id, 30, mtd / 18),
    byService,
    apiUsage,
    revenue: buildRevenueDto(rev),
    dataSource: costWS?.source ?? "mock",
    ...(liveCost ? { dataAsOf: liveCost.dataAsOf } : {}),
    budgetDataSource,
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

  // Fetch point-in-time summary, all five time-series, and top exceptions in
  // parallel. CPU and memory come only from Log Analytics (performanceCounters);
  // they are not available through the Azure Monitor Metrics API used by fetchAppMetrics.
  const [liveMetrics, liveRpmSeries, liveLatenSeries, liveErrSeries, liveCpuSeries, liveMemSeries, liveTopExceptions] =
    await Promise.all([
      fetchAppMetrics(app, { bypassCache }),
      fetchAppTimeSeries(app, "requests_per_min", 24, { bypassCache }),
      fetchAppTimeSeries(app, "p95_latency_ms", 24, { bypassCache }),
      fetchAppTimeSeries(app, "error_rate_pct", 24, { bypassCache }),
      fetchAppTimeSeries(app, "cpu_pct", 24, { bypassCache }),
      fetchAppTimeSeries(app, "memory_pct", 24, { bypassCache }),
      fetchTopExceptions(app, { hours: 24, limit: 5, bypassCache }),
    ]);

  // Derive current CPU / memory scalars from the last live series point.
  // When Monitor is not configured these remain undefined (optional fields).
  const lastPoint = (series: typeof liveCpuSeries) =>
    series && series.length > 0 ? series[series.length - 1]!.value : undefined;
  const liveCpuPct = lastPoint(liveCpuSeries);
  const liveMemPct = lastPoint(liveMemSeries);

  // Mock scalars (seeded, stable per-app) used as fallback when Monitor is off.
  const mockCpuPct = Number((20 + rand() * 60).toFixed(1));
  const mockMemPct = Number((30 + rand() * 50).toFixed(1));

  const isLive = Boolean(liveMetrics || liveCpuSeries || liveMemSeries || liveTopExceptions);

  const data = GetTelemetryResponse.parse({
    requestsPerMin: liveMetrics?.requestsPerMin ?? Number((400 + rand() * 1200).toFixed(0)),
    p95LatencyMs: liveMetrics?.p95LatencyMs ?? Number(((sick ? 800 : 220) + rand() * 200).toFixed(0)),
    errorRatePercent: liveMetrics?.errorRatePercent ?? Number(((sick ? 4.2 : 0.3) + rand() * 0.6).toFixed(2)),
    availabilityPercent: liveMetrics?.availabilityPercent ?? Number((sick ? 97.4 : 99.92).toFixed(2)),
    cpuPercent: liveCpuPct ?? (isLive ? undefined : mockCpuPct),
    memoryPercent: liveMemPct ?? (isLive ? undefined : mockMemPct),
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
      {
        ...makeSeries(app.id, "CPU %", "%", 24, sick ? 85 : 45, 25),
        points: liveCpuSeries ?? makeSeries(app.id, "CPU %", "%", 24, sick ? 85 : 45, 25).points,
      },
      {
        ...makeSeries(app.id, "Memory %", "%", 24, sick ? 88 : 60, 20),
        points: liveMemSeries ?? makeSeries(app.id, "Memory %", "%", 24, sick ? 88 : 60, 20).points,
      },
    ],
    topErrors: liveTopExceptions ?? [
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
    dataSource: isLive ? "live" : "mock",
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
  // Fetch live Azure cost, budgets, and ledger revenue for every app in parallel.
  const [costWithSourceResults, budgetWithSourceResults, revResults] = await Promise.all([
    Promise.all(APPS.map((a) => fetchMonthToDateCostWithFallback(a, { bypassCache }))),
    Promise.all(APPS.map((a) => fetchBudgetForAppWithFallback(a, { bypassCache }))),
    Promise.all(APPS.map((a) => syncAndReadRevenue(a))),
  ]);
  const liveCostByApp = new Map(APPS.map((a, i) => [a.id, costWithSourceResults[i]?.result ?? null] as const));
  const liveBudgetByApp = new Map(APPS.map((a, i) => [a.id, budgetWithSourceResults[i]?.result ?? null] as const));
  const revByApp = new Map(APPS.map((a, i) => [a.id, revResults[i]!] as const));

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
    const r = revByApp.get(a.id) ?? { stripe: 0, appStore: 0, playStore: 0 };
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

  const anyLive = costWithSourceResults.some((r) => r?.source === "live");
  const anyCached = costWithSourceResults.some((r) => r?.source === "cached");
  const resolvedCostResults = costWithSourceResults.map((r) => r?.result ?? null);
  const liveTimestamps = resolvedCostResults.filter((r) => r !== null).map((r) => r!.dataAsOf);
  const earliestDataAsOf = liveTimestamps.length > 0
    ? liveTimestamps.reduce((min, t) => (t < min ? t : min))
    : undefined;

  // Global budget: sum of per-app Azure Budget amounts (live or DB snapshot); fall back to 2× MTD formula.
  const anyRealBudget = APPS.some((a) => liveBudgetByApp.get(a.id) !== null);
  const globalBudget = anyRealBudget
    ? APPS.reduce((s, a) => {
        const b = liveBudgetByApp.get(a.id);
        const appCost = infraCostByApp.get(a.id)! + (apiByApp.get(a.id)?.cost ?? 0);
        return s + (b?.amount ?? appCost * 2.0);
      }, 0)
    : mtd * 2.0;
  // Global forecast: sum of per-app Azure Forecast amounts (live or DB snapshot); fall back to 1.65× MTD formula.
  const anyRealForecast = APPS.some((a) => liveBudgetByApp.get(a.id)?.forecastAmount != null);
  const globalForecast = anyRealForecast
    ? APPS.reduce((s, a) => {
        const b = liveBudgetByApp.get(a.id);
        const appCost = infraCostByApp.get(a.id)! + (apiByApp.get(a.id)?.cost ?? 0);
        return s + (b?.forecastAmount ?? appCost * 1.65);
      }, 0)
    : mtd * 1.65;

  // Determine the overall budget data source: if any app has a live result → "live";
  // else if any app fell back to a DB snapshot → "cached"; else → "estimated".
  const globalBudgetDataSource = (() => {
    if (budgetWithSourceResults.some((b) => b?.source === "live")) return "live" as const;
    if (budgetWithSourceResults.some((b) => b?.source === "cached")) return "cached" as const;
    return "estimated" as const;
  })();

  const data = GetGlobalCostSummaryResponse.parse({
    currency: "USD",
    monthToDate: Number(mtd.toFixed(2)),
    forecast: Number(globalForecast.toFixed(2)),
    budget: Number(globalBudget.toFixed(2)),
    daily: makeDaily("global", 30, mtd / 30),
    apiCalls,
    apiCost: Number(apiCost.toFixed(2)),
    dataSource: anyLive ? "live" : anyCached ? "cached" : "mock",
    ...(earliestDataAsOf ? { dataAsOf: earliestDataAsOf } : {}),
    budgetDataSource: globalBudgetDataSource,
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

// ---------------------------------------------------------------------------
// --- deployments (GitHub Actions) ---
router.get("/apps/:appId/deployments", async (req, res) => {
  const app = findApp(req.params.appId);
  if (!app) {
    res.status(404).json({ error: "App not found" });
    return;
  }
  const runs = await fetchDeployments(app.id, app.name, app.appRepo, app.environment);
  const data = ListDeploymentsResponse.parse(runs);
  res.json(data);
});

// --- activity log (Azure Activity Log) ---
router.get("/apps/:appId/activity", async (req, res) => {
  const app = findApp(req.params.appId);
  if (!app) {
    res.status(404).json({ error: "App not found" });
    return;
  }
  const entries = await fetchActivityLog(app.id, app.resourceGroup, app.subscriptionId);
  const data = ListActivityLogResponse.parse(entries);
  res.json(data);
});

// --- log search (KQL against centralised Log Analytics workspace) ---
// Returns [] when AZURE_LOG_ANALYTICS_WORKSPACE_ID is not set.
router.get("/apps/:appId/logs", async (req, res) => {
  const app = findApp(req.params.appId);
  if (!app) {
    res.status(404).json({ error: "App not found" });
    return;
  }
  if (!isMonitorConfigured()) {
    res.json([]);
    return;
  }
  const workspaceId = getLogAnalyticsWorkspaceId()!;
  const rawQ = req.query["q"];
  const q = typeof rawQ === "string" && rawQ.trim() ? rawQ.trim() : null;
  const limit = Math.min(parseInt(String(req.query["limit"] ?? "100"), 10), 500);

  const kql = q
    ? `${q} | limit ${limit}`
    : `AppTraces | where AppRoleName =~ '${app.id}' | order by TimeGenerated desc | limit ${limit}`;

  try {
    const credential = await import("@azure/identity").then((m) => new m.DefaultAzureCredential());
    const logsClient = new LogsQueryClient(credential);
    const result = await logsClient.queryWorkspace(workspaceId, kql, { duration: "P7D" });

    const lines: Array<{ id: string; timestamp: string; appId: string; level: string; message: string }> = [];
    if (result.status === "Success" && result.tables.length > 0) {
      const table = result.tables[0]!;
      const cols = table.columnDescriptors.map((c) => c.name ?? "");
      const timeIdx = cols.findIndex((c) => /time/i.test(c));
      const msgIdx = cols.findIndex((c) => /message|msg/i.test(c));
      const lvlIdx = cols.findIndex((c) => /level|severity/i.test(c));

      for (const row of table.rows) {
        const ts = timeIdx >= 0 ? String(row[timeIdx] ?? "") : new Date().toISOString();
        const msg = msgIdx >= 0 ? String(row[msgIdx] ?? "") : JSON.stringify(row);
        const lvlRaw = lvlIdx >= 0 ? String(row[lvlIdx] ?? "").toUpperCase() : "INFO";
        const level = ["ERROR", "WARN", "INFO"].includes(lvlRaw) ? lvlRaw : "INFO";
        lines.push({ id: `${app.id}-log-${lines.length}`, timestamp: ts, appId: app.id, level, message: msg });
      }
    }
    res.json(QueryLogsResponse.parse(lines));
  } catch {
    res.json([]);
  }
});

// --- global: service health ---
router.get("/global/service-health", async (_req, res) => {
  const events = await fetchServiceHealth();
  const data = ListServiceHealthResponse.parse(events);
  res.json(data);
});

// --- global: SLOs ---
// Derives SLO snapshot from Azure Monitor metrics for each app.
// Returns [] when Azure Monitor is not configured.

// Deterministic mock CPU/memory values per app (used when Monitor time-series
// are unavailable). Seeded from a simple djb2-style hash of the app id so
// the values are stable across requests without touching RNG state.
function mockInfraPct(appId: string, lo: number, hi: number): number {
  let h = 5381;
  for (let i = 0; i < appId.length; i++) {
    h = ((h << 5) + h) ^ appId.charCodeAt(i);
    h = h >>> 0;
  }
  return Number((lo + (h % 1000) / 1000 * (hi - lo)).toFixed(1));
}

function mockSloRows() {
  const CPU_THRESHOLD = 80;
  const MEMORY_THRESHOLD = 85;
  return APPS.map((app) => {
    const rand = seededRand(app.id + "slo");
    const cpuSeries = makeSeries(app.id, "CPU %", "%", 24, 45, 25).points;
    const memSeries = makeSeries(app.id, "Memory %", "%", 24, 60, 20).points;
    const cpuPct = mockInfraPct(app.id + "cpu", 18, 72);
    const memoryPct = mockInfraPct(app.id + "mem", 38, 82);
    const uptimePct = Number((99.5 + rand() * 0.5).toFixed(4));
    const errorRatePct = Number((rand() * 0.8).toFixed(4));
    const p95LatencyMs = Math.round(120 + rand() * 250);
    const errorTargetPct = 1.0;
    const p95TargetMs = 500;
    const errorBudgetRemainingPct = Math.max(
      0,
      Number((100 * (1 - errorRatePct / errorTargetPct)).toFixed(1)),
    );
    return {
      appId: app.id,
      appName: app.name,
      environment: app.environment,
      uptimePct,
      errorBudgetRemainingPct,
      p95LatencyMs,
      p95TargetMs,
      errorRatePct,
      errorTargetPct,
      cpuPct,
      cpuThreshold: CPU_THRESHOLD,
      memoryPct,
      memoryThreshold: MEMORY_THRESHOLD,
      cpuSeries,
      memorySeries: memSeries,
    };
  });
}

router.get("/global/slos", async (_req, res) => {
  if (!isAzureConfigured()) {
    res.json(ListSlosResponse.parse(mockSloRows()));
    return;
  }

  const [metricsResults, cpuSeriesResults, memSeriesResults, thresholdOverrides] = await Promise.all([
    Promise.all(APPS.map((a) => fetchAppMetrics(a, {}))),
    Promise.all(APPS.map((a) => fetchAppTimeSeries(a, "cpu_pct", 24))),
    Promise.all(APPS.map((a) => fetchAppTimeSeries(a, "memory_pct", 24))),
    loadThresholdOverrides(),
  ]);

  const rows = APPS.flatMap((app, i) => {
    const m = metricsResults[i];
    if (!m) return [];
    const errorTargetPct = 1.0;
    const p95TargetMs = 500;
    const errorBudgetRemainingPct = Math.max(
      0,
      Number((100 * (1 - m.errorRatePercent / errorTargetPct)).toFixed(1)),
    );

    // Take the last non-NaN point from each time-series, or fall back to a
    // deterministic mock so the column always has a value to display.
    const cpuSeries = cpuSeriesResults[i] ?? makeSeries(app.id, "CPU %", "%", 24, 45, 25).points;
    const memSeries = memSeriesResults[i] ?? makeSeries(app.id, "Memory %", "%", 24, 60, 20).points;
    const lastCpuPoint = [...cpuSeries].reverse().find((p) => Number.isFinite(p.value));
    const lastMemPoint = [...memSeries].reverse().find((p) => Number.isFinite(p.value));
    const lastCpu = lastCpuPoint?.value;
    const lastMem = lastMemPoint?.value;
    const cpuPct = lastCpu !== undefined ? Number(lastCpu.toFixed(1)) : mockInfraPct(app.id + "cpu", 18, 72);
    const memoryPct = lastMem !== undefined ? Number(lastMem.toFixed(1)) : mockInfraPct(app.id + "mem", 38, 82);

    const { cpuThreshold, memoryThreshold } = resolveThresholds(app, thresholdOverrides.get(app.id));

    return [{
      appId: app.id,
      appName: app.name,
      environment: app.environment,
      uptimePct: Number(m.availabilityPercent.toFixed(4)),
      errorBudgetRemainingPct,
      p95LatencyMs: Number(m.p95LatencyMs.toFixed(0)),
      p95TargetMs,
      errorRatePct: Number(m.errorRatePercent.toFixed(4)),
      errorTargetPct,
      cpuPct,
      cpuThreshold,
      memoryPct,
      memoryThreshold,
      cpuSeries,
      memorySeries: memSeries,
    }];
  });

  res.json(ListSlosResponse.parse(rows));
});

// --- global: network endpoints ---
// Aggregates endpoint health across all apps from Azure Network Watcher.
// Returns [] when Azure Monitor is not configured.
router.get("/global/endpoints", async (_req, res) => {
  if (!isAzureConfigured()) {
    res.json([]);
    return;
  }

  const endpointResults = await Promise.all(APPS.map((a) => fetchNetworkEndpoints(a, {})));

  const rows = APPS.flatMap((app, i) => {
    const endpoints = endpointResults[i];
    if (!endpoints) return [];
    return endpoints.map((ep) => ({
      id: `${app.id}-${ep.name}`,
      appId: app.id,
      appName: app.name,
      name: ep.name,
      region: ep.region,
      status: ep.status,
      latencyMs: ep.latencyMs,
      packetLossPercent: ep.packetLossPercent,
    }));
  });

  res.json(ListGlobalEndpointsResponse.parse(rows));
});

export default router;
