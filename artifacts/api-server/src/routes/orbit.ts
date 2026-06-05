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
  ListAppThresholdsLogResponse,
} from "@workspace/api-zod";
import { db, appThresholdsTable, appThresholdsLogTable } from "@workspace/db";
import { eq, desc, sql } from "drizzle-orm";
import { requireEngineerOrAdmin } from "../middlewares/auth.js";
import { fetchResourcesByResourceGroup, fetchResourceGroupTags } from "../lib/azureResources.js";
import { fetchMonthToDateCostWithFallback } from "../lib/azureCost.js";
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
    activeAlerts: 0,
    monthToDateCost: 0,
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
    monthToDateCost: 0,
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
    monthToDateCost: 0,
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
// Billing scope config: "subscription" means the app owns its entire Azure
// subscription (query at sub scope for full cost coverage); "rg" means the app
// shares a subscription with others (query at resource-group scope only).
// ---------------------------------------------------------------------------
const APP_BILLING_SCOPE: Record<string, "rg" | "subscription"> = {
  grailbabe: "subscription", // mg-GrailBabeProd — dedicated subscription 01390551
  orbit: "rg",               // shares sub-sharedplatf 893689ff with Kinisis Labs
  "kinisis-labs": "rg",      // shares sub-sharedplatf 893689ff with Orbit
};

function billingScope(appId: string): "rg" | "subscription" {
  return APP_BILLING_SCOPE[appId] ?? "rg";
}

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


// --- /apps ---
router.get("/apps", async (_req, res) => {
  // Fetch live cost, alert counts, budgets, and subscription names for all apps in parallel.
  // Falls back to static inventory values when Azure is unconfigured.
  const [alertResults, costWithSourceResults, budgetWithSourceResults] = await Promise.all([
    Promise.all(APPS.map((a) => fetchActiveAlerts(a, {}))),
    Promise.all(APPS.map((a) => fetchMonthToDateCostWithFallback(a, { billingScope: billingScope(a.id) }))),
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
      const mtd = costWS?.result.monthToDate ?? 0;
      const budget = budgetWS?.result.amount ?? null;
      const forecast = budgetWS?.result.forecastAmount ?? null;
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
        activeAlerts: liveAlerts ? liveAlerts.filter((a) => a.status === "active").length : 0,
        monthToDateCost: mtd,
        ...(budget !== null ? { budget } : {}),
        ...(forecast !== null ? { forecast } : {}),
        ...(forecast !== null && budget !== null ? { forecastOverBudget: forecast > budget } : {}),
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
  res.json(
    GetAppThresholdsResponse.parse({
      appId: app.id,
      cpuThreshold,
      memoryThreshold,
      updatedBy: row?.updatedBy ?? "system",
      updatedAt: row?.updatedAt?.toISOString() ?? undefined,
    }),
  );
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

  // Read current values for the audit log (null when no row exists yet)
  const [existing] = await db
    .select()
    .from(appThresholdsTable)
    .where(eq(appThresholdsTable.appId, app.id));

  await db.transaction(async (tx) => {
    // Upsert the live thresholds
    await tx
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

    // Append an immutable audit-log row
    await tx.insert(appThresholdsLogTable).values({
      appId: app.id,
      oldCpuThreshold: existing ? existing.cpuThreshold : null,
      newCpuThreshold: String(cpuThreshold),
      oldMemoryThreshold: existing ? existing.memoryThreshold : null,
      newMemoryThreshold: String(memoryThreshold),
      changedBy: updatedBy,
    });
  });

  const now = new Date();
  res.json(
    GetAppThresholdsResponse.parse({
      appId: app.id,
      cpuThreshold,
      memoryThreshold,
      updatedBy,
      updatedAt: now.toISOString(),
    }),
  );
});

router.get("/apps/:appId/thresholds/log", requireEngineerOrAdmin, async (req, res) => {
  const app = findApp(req.params["appId"] as string);
  if (!app) {
    res.status(404).json({ error: "App not found" });
    return;
  }
  const rawLimit = parseInt((req.query["limit"] as string | undefined) ?? "50", 10);
  const rawOffset = parseInt((req.query["offset"] as string | undefined) ?? "0", 10);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 200) : 50;
  const offset = Number.isFinite(rawOffset) && rawOffset >= 0 ? rawOffset : 0;

  const [rows, countRows] = await Promise.all([
    db
      .select()
      .from(appThresholdsLogTable)
      .where(eq(appThresholdsLogTable.appId, app.id))
      .orderBy(desc(appThresholdsLogTable.changedAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(appThresholdsLogTable)
      .where(eq(appThresholdsLogTable.appId, app.id)),
  ]);

  const total = countRows[0]?.count ?? 0;
  res.json(
    ListAppThresholdsLogResponse.parse({
      items: rows.map((r) => ({
        id: r.id,
        appId: r.appId,
        oldCpuThreshold: r.oldCpuThreshold !== null ? parseFloat(r.oldCpuThreshold) : null,
        newCpuThreshold: parseFloat(r.newCpuThreshold),
        oldMemoryThreshold: r.oldMemoryThreshold !== null ? parseFloat(r.oldMemoryThreshold) : null,
        newMemoryThreshold: parseFloat(r.newMemoryThreshold),
        changedBy: r.changedBy,
        changedAt: r.changedAt.toISOString(),
      })),
      total,
    }),
  );
});

// --- infrastructure ---
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
  const resources = liveResources ?? [];
  const series = liveResources ? [
    { name: "CPU %", unit: "%", points: liveCpuSeries ?? [] },
    { name: "Memory %", unit: "%", points: liveMemSeries ?? [] },
  ] : [];
  const data = GetInfrastructureResponse.parse({ resources, series, dataSource: liveResources ? "live" : "mock" });
  res.json(data);
});

// --- network ---
router.get("/apps/:appId/network", async (req, res) => {
  const app = findApp(req.params.appId);
  if (!app) {
    res.status(404).json({ error: "App not found" });
    return;
  }
  const bypassCache = req.query["refresh"] === "true";
  const liveEndpoints = await fetchNetworkEndpoints(app, { bypassCache });
  const endpoints = liveEndpoints ?? [];
  const throughput: { name: string; unit: string; points: { timestamp: string; value: number }[] }[] = [];
  const data = GetNetworkResponse.parse({ endpoints, throughput });
  res.json(data);
});

// --- cost ---

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
  try {
    return await getLedgerMonthRevenue(app.id);
  } catch {
    // Non-fatal: ledger table may not exist yet in a fresh environment.
    return { stripe: 0, appStore: 0, playStore: 0 };
  }
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

router.get("/apps/:appId/cost", async (req, res) => {
  const app = findApp(req.params.appId);
  if (!app) {
    res.status(404).json({ error: "App not found" });
    return;
  }
  const bypassCache = req.query["refresh"] === "true";
  const [costWS, budgetWithSource, rev] = await Promise.all([
    fetchMonthToDateCostWithFallback(app, { bypassCache, billingScope: billingScope(app.id) }),
    fetchBudgetForAppWithFallback(app, { bypassCache }),
    syncAndReadRevenue(app),
  ]);
  const liveCost = costWS?.result ?? null;
  const mtd = liveCost?.monthToDate ?? 0;
  const byService = liveCost?.byService ?? [];
  const budget = budgetWithSource?.result.amount ?? 0;
  const forecast = budgetWithSource?.result.forecastAmount ?? 0;
  const budgetDataSource = budgetWithSource?.source ?? "estimated";

  const data = GetCostResponse.parse({
    currency: "USD",
    monthToDate: mtd,
    forecast,
    budget,
    daily: [],
    byService,
    apiUsage: { totalCalls: 0, costPerMillion: 0, cost: 0, byApi: [] },
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

  const lastPoint = (series: typeof liveCpuSeries) =>
    series && series.length > 0 ? series[series.length - 1]!.value : undefined;
  const liveCpuPct = lastPoint(liveCpuSeries);
  const liveMemPct = lastPoint(liveMemSeries);
  const isLive = Boolean(liveMetrics || liveCpuSeries || liveMemSeries || liveTopExceptions);

  const data = GetTelemetryResponse.parse({
    requestsPerMin: liveMetrics?.requestsPerMin ?? 0,
    p95LatencyMs: liveMetrics?.p95LatencyMs ?? 0,
    errorRatePercent: liveMetrics?.errorRatePercent ?? 0,
    availabilityPercent: liveMetrics?.availabilityPercent ?? 0,
    cpuPercent: liveCpuPct,
    memoryPercent: liveMemPct,
    series: isLive ? [
      { name: "Requests / min", unit: "rpm", points: liveRpmSeries ?? [] },
      { name: "P95 latency (ms)", unit: "ms", points: liveLatenSeries ?? [] },
      { name: "Error rate (%)", unit: "%", points: liveErrSeries ?? [] },
      { name: "CPU %", unit: "%", points: liveCpuSeries ?? [] },
      { name: "Memory %", unit: "%", points: liveMemSeries ?? [] },
    ] : [],
    topErrors: liveTopExceptions ?? [],
    dataSource: isLive ? "live" : "mock",
  });
  res.json(data);
});

// --- alerts ---
router.get("/apps/:appId/alerts", async (req, res) => {
  const app = findApp(req.params.appId);
  if (!app) {
    res.status(404).json({ error: "App not found" });
    return;
  }
  const bypassCache = req.query["refresh"] === "true";
  const liveAlerts = await fetchActiveAlerts(app, { bypassCache });
  const data = GetAppAlertsResponse.parse(liveAlerts ?? []);
  res.json(data);
});

// --- global ---
router.get("/global/health", (_req, res) => {
  const totals = APPS.reduce(
    (acc, a) => {
      acc.totalApps += 1;
      if (a.status === "healthy") acc.healthy += 1;
      else if (a.status === "degraded") acc.degraded += 1;
      else if (a.status === "unhealthy") acc.unhealthy += 1;
      return acc;
    },
    { totalApps: 0, healthy: 0, degraded: 0, unhealthy: 0 },
  );
  const data = GetGlobalHealthResponse.parse({
    ...totals,
    activeAlerts: 0,
    monthToDateCost: 0,
    currency: "USD",
  });
  res.json(data);
});

router.get("/global/alerts", async (_req, res) => {
  const alertResults = await Promise.all(APPS.map((a) => fetchActiveAlerts(a, {})));
  const all = alertResults
    .flatMap((alerts) => alerts ?? [])
    .sort((a, b) => (a.firedAt < b.firedAt ? 1 : -1));
  const data = ListGlobalAlertsResponse.parse(all);
  res.json(data);
});

router.get("/global/cost-summary", async (req, res) => {
  const bypassCache = req.query["refresh"] === "true";
  const [costWithSourceResults, budgetWithSourceResults, revResults] = await Promise.all([
    Promise.all(APPS.map((a) => fetchMonthToDateCostWithFallback(a, { bypassCache, billingScope: billingScope(a.id) }))),
    Promise.all(APPS.map((a) => fetchBudgetForAppWithFallback(a, { bypassCache }))),
    Promise.all(APPS.map((a) => syncAndReadRevenue(a))),
  ]);
  const liveCostByApp = new Map(APPS.map((a, i) => [a.id, costWithSourceResults[i]?.result ?? null] as const));
  const liveBudgetByApp = new Map(APPS.map((a, i) => [a.id, budgetWithSourceResults[i]?.result ?? null] as const));
  const revByApp = new Map(APPS.map((a, i) => [a.id, revResults[i]!] as const));

  // Per-app infra cost: real Azure data only, 0 when unavailable.
  const infraCostByApp = new Map(
    APPS.map((a) => [a.id, liveCostByApp.get(a.id)?.monthToDate ?? 0] as const),
  );
  const mtd = APPS.reduce((s, a) => s + infraCostByApp.get(a.id)!, 0);

  const revenueByApp = APPS.map((a) => {
    const r = revByApp.get(a.id) ?? { stripe: 0, appStore: 0, playStore: 0 };
    const total = Number((r.stripe + r.appStore + r.playStore).toFixed(2));
    const cost = Number((infraCostByApp.get(a.id)!).toFixed(2));
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

  // Aggregate byService from live Azure cost data only; skip apps with no live data.
  const byResourceMap = new Map<string, { amount: number; weightedTrendSum: number; trendWeight: number }>();
  for (const a of APPS) {
    const live = liveCostByApp.get(a.id);
    if (!live) continue;
    for (const line of live.byService) {
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
      byResourceMap.set(line.service, { amount: existing.amount + line.amount, weightedTrendSum, trendWeight });
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

  // Global budget/forecast: sum of real Azure Budget amounts only; 0 when unavailable.
  const globalBudget = APPS.reduce((s, a) => s + (liveBudgetByApp.get(a.id)?.amount ?? 0), 0);
  const globalForecast = APPS.reduce((s, a) => s + (liveBudgetByApp.get(a.id)?.forecastAmount ?? 0), 0);
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
    daily: [],
    apiCalls: 0,
    apiCost: 0,
    dataSource: anyLive ? "live" : anyCached ? "cached" : "mock",
    ...(earliestDataAsOf ? { dataAsOf: earliestDataAsOf } : {}),
    budgetDataSource: globalBudgetDataSource,
    byApp: APPS.map((a) => ({
      appId: a.id,
      appName: a.name,
      amount: Number(infraCostByApp.get(a.id)!.toFixed(2)),
    })),
    byResource,
    apiByApp: [],
    apiByName: [],
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
  const liveEnabled = isAzureConfigured();
  const data = ListServiceHealthResponse.parse({
    events,
    liveEnabled,
    dataSource: liveEnabled ? "live" : "mock",
  });
  res.json(data);
});

// --- global: SLOs ---
// Derives SLO snapshot from Azure Monitor metrics for each app.
// Returns empty rows when Azure Monitor is not configured.

router.get("/global/slos", async (_req, res) => {
  if (!isAzureConfigured()) {
    res.json(ListSlosResponse.parse({ rows: [], dataSource: "mock" }));
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

    const cpuSeries = cpuSeriesResults[i] ?? [];
    const memSeries = memSeriesResults[i] ?? [];
    const lastCpuPoint = [...cpuSeries].reverse().find((p) => Number.isFinite(p.value));
    const lastMemPoint = [...memSeries].reverse().find((p) => Number.isFinite(p.value));
    const cpuPct = lastCpuPoint !== undefined ? Number(lastCpuPoint.value.toFixed(1)) : 0;
    const memoryPct = lastMemPoint !== undefined ? Number(lastMemPoint.value.toFixed(1)) : 0;

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

  res.json(ListSlosResponse.parse({ rows, dataSource: isMonitorConfigured() ? "live" : "mock" }));
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
