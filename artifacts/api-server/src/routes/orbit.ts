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
  ListDeploymentsResponse,
  ListActivityLogResponse,
  QueryLogsResponse,
  ListServiceHealthResponse,
  ListSlosResponse,
  ListGlobalEndpointsResponse,
  GetAppThresholdsResponse,
  UpdateAppThresholdsBody,
  ListAppThresholdsLogResponse,
  GetGlobalCostSummaryResponse,
} from "@workspace/api-zod";
import { db, appThresholdsTable, appThresholdsLogTable } from "@workspace/db";
import { eq, desc, sql } from "drizzle-orm";
import { requireEngineerOrAdmin } from "../middlewares/auth.js";
import { fetchResourcesByResourceGroup, fetchResourceGroupTags, getResourcesFetchedAt } from "../lib/azureResources.js";
import { fetchMonthToDateCostWithFallback, fetchLastMonthComparableCostTotal } from "../lib/azureCost.js";
import { fetchBudgetForAppWithFallback } from "../lib/azureBudgets.js";
import { fetchSubscriptionNames } from "../lib/azureSubscriptions.js";
import {
  fetchAppMetrics,
  fetchAppTimeSeries,
  fetchTopExceptions,
  isMonitorConfigured,
  getLogAnalyticsWorkspaceId,
  resolveAppInsightsResourceId,
  getMetricsFetchedAt,
} from "../lib/azureMonitor.js";
import { isAzureConfigured } from "../lib/azure.js";
import { fetchActiveAlerts } from "../lib/azureAlerts.js";
import { fetchNetworkEndpoints } from "../lib/azureNetwork.js";
import { fetchDeployments } from "../lib/github.js";
import { fetchActivityLog } from "../lib/azureActivity.js";
import { fetchServiceHealth } from "../lib/azureServiceHealth.js";
import { resolveEnvCpuThreshold, resolveEnvMemoryThreshold } from "../lib/alertThresholds.js";
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
    appleAppId: "6741234567",
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
    subscriptionId: process.env.AZURE_SUB_ORBIT ?? "a1f4-shared-platform",
    description: "Kinisis admin center — Azure ops dashboard for internal staff.",
    tags: {
      workload: "Orbit",
      environment: "prod",
      owner: "Ryan Gutridge",
      "cost-center": "CC-Platform",
      criticality: "high",
    },
    owners: ["Ryan Gutridge"],
    userAuth: "entra",
    appRepo: "Orbit-Admin-Ctr",
    group: "Platform",
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
  "kinisis-labs": "rg",      // shares sub-sharedplatf 893689ff with platform subscription
};

export function billingScope(appId: string): "rg" | "subscription" {
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
router.get("/apps", async (req, res) => {
  const bypassCache = req.query["refresh"] === "true";
  // Fetch live cost, alert counts, budgets, and subscription names for all apps in parallel.
  // Falls back to static inventory values when Azure is unconfigured.
  // Pass bypassCache when the caller supplies ?refresh=true so cost/budget figures
  // reflect the latest data instead of serving from the in-process cache.
  const [alertResults, costWithSourceResults, budgetWithSourceResults] = await Promise.all([
    Promise.all(APPS.map((a) => fetchActiveAlerts(a, {}))),
    Promise.all(APPS.map((a) => fetchMonthToDateCostWithFallback(a, { bypassCache, billingScope: billingScope(a.id) }))),
    Promise.all(APPS.map((a) => fetchBudgetForAppWithFallback(a, { bypassCache }))),
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
        costDataSource: costWS?.source ?? "mock",
        ...(budget !== null ? { budget } : {}),
        ...(forecast !== null ? { forecast } : {}),
        ...(forecast !== null && budget !== null ? { forecastOverBudget: forecast > budget } : {}),
        group: app.group,
        userAuth: app.userAuth,
        ...(app.androidPackage ? { androidPackage: app.androidPackage } : {}),
        ...(app.iosBundle ? { iosBundle: app.iosBundle } : {}),
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
  const [liveTags, subNameMap] = await Promise.all([
    fetchResourceGroupTags(app, { bypassCache }),
    fetchSubscriptionNames([app.subscriptionId]),
  ]);
  const subName = subNameMap.get(app.subscriptionId.toLowerCase());
  const data = GetAppResponse.parse({
    ...app,
    tags: liveTags ?? app.tags,
    ...(subName ? { subscriptionName: subName } : {}),
  });
  res.json(data);
});

// --- per-app threshold settings ---

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

/**
 * Resolve thresholds for an app using the four-tier order:
 *   1. DB override (operator-set via Orbit UI — appThresholdsTable)
 *   2. Per-app env var (e.g. ALERT_CPU_THRESHOLD_PCT__GRAILBABE)
 *   3. APPS inventory baseline (app.cpuThreshold / app.memoryThreshold)
 *   4. Global env var / hardcoded default (resolveEnvCpuThreshold fallback)
 */
function resolveThresholds(app: AppRecord, override?: { cpuThreshold: number; memoryThreshold: number }) {
  return {
    cpuThreshold: override?.cpuThreshold ?? resolveEnvCpuThreshold(app.id, app.cpuThreshold),
    memoryThreshold: override?.memoryThreshold ?? resolveEnvMemoryThreshold(app.id, app.memoryThreshold),
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
  const [liveResources, liveCpuSeries, liveMemSeries, liveDiskIopsSeries] = await Promise.all([
    fetchResourcesByResourceGroup(app, { bypassCache }),
    fetchAppTimeSeries(app, "cpu_pct", 24, { bypassCache }),
    fetchAppTimeSeries(app, "memory_pct", 24, { bypassCache }),
    fetchAppTimeSeries(app, "disk_iops", 24, { bypassCache }),
  ]);
  const resources = liveResources ?? [];
  const seriesAll = liveResources ? [
    { name: "CPU %", unit: "%", points: liveCpuSeries ?? [] },
    { name: "Memory %", unit: "%", points: liveMemSeries ?? [] },
    { name: "Disk IOPS", unit: "ops/s", points: liveDiskIopsSeries ?? [] },
  ] : [];
  const series = seriesAll.filter((s) => s.points.length > 0);
  const resourcesFetchedAt = getResourcesFetchedAt(app.id);
  const infraCachedAt = liveResources && resourcesFetchedAt ? new Date(resourcesFetchedAt).toISOString() : undefined;
  const data = GetInfrastructureResponse.parse({ resources, series, dataSource: liveResources ? "live" : "mock", ...(infraCachedAt ? { cachedAt: infraCachedAt } : {}) });
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
  const [liveEndpoints, liveIngressSeries, liveEgressSeries] = await Promise.all([
    fetchNetworkEndpoints(app, { bypassCache }),
    fetchAppTimeSeries(app, "network_ingress_mbps", 24, { bypassCache }),
    fetchAppTimeSeries(app, "network_egress_mbps", 24, { bypassCache }),
  ]);
  const endpoints = liveEndpoints ?? [];
  const throughputAll: { name: string; unit: string; points: { timestamp: string; value: number }[] }[] =
    liveIngressSeries || liveEgressSeries
      ? [
          { name: "Ingress", unit: "MB/s", points: liveIngressSeries ?? [] },
          { name: "Egress", unit: "MB/s", points: liveEgressSeries ?? [] },
        ]
      : [];
  const throughput = throughputAll.filter((s) => s.points.length > 0);
  const dataSource = (liveIngressSeries !== null || liveEgressSeries !== null) ? "live" : "mock";
  const endpointsDataSource = liveEndpoints !== null ? "live" : "mock";
  const data = GetNetworkResponse.parse({ endpoints, throughput, dataSource, endpointsDataSource });
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

/**
 * Compute the month-over-month spend change percentage for an app.
 *
 * **Live / cached mode:** compares current MTD against the prior month's cost
 * over the same elapsed day-of-month window (fetched from Azure Cost Management
 * via `fetchLastMonthComparableCostTotal`). Returns null when either figure is
 * zero or unavailable so the UI can suppress a misleading indicator.
 *
 * **Mock mode:** derives a stable value from the app ID hash so the indicator
 * always renders the same reading per app during dev/preview (no Azure config).
 *
 * @param appId        App identifier (used for the mock fallback hash).
 * @param mtd          Current month-to-date spend in USD.
 * @param dataSource   Whether data came from a live Azure query, a cached DB
 *                     snapshot, or the mock formula path.
 * @param priorMonthTotal  Prior month comparable cost (May 1–N if today is
 *                         June N), fetched from Azure; null when unavailable.
 */
function computeMomChangePct(
  appId: string,
  mtd: number,
  dataSource: "live" | "cached" | "mock",
  priorMonthTotal: number | null = null,
): number | null {
  if (dataSource !== "mock") {
    // With real Azure data: require both figures to be non-trivial.
    if (mtd <= 0) return null;
    if (priorMonthTotal === null || priorMonthTotal <= 0) return null;
    const pct = ((mtd - priorMonthTotal) / priorMonthTotal) * 100;
    return Math.round(pct * 10) / 10; // 1 decimal place
  }
  // Mock mode: deterministic hash of the app ID → a percentage in [-25, +35].
  let h = 0;
  for (let i = 0; i < appId.length; i++) h = (h * 31 + appId.charCodeAt(i)) & 0xffffffff;
  const normalized = (h >>> 0) / 0xffffffff; // 0..1
  return Math.round((normalized * 60 - 25) * 10) / 10; // -25 .. +35, 1 dp
}

/**
 * Generates a 30-day daily cost series for mock mode.
 *
 * GrailBabe gets a realistic baseline (~$48-58/day) with a synthetic spike 2
 * days ago that reliably triggers detectRecentAnomaly (>mean+2σ), so the amber
 * badge is always visible in the dev preview without needing Azure configured.
 * Other apps get a stable baseline with no spike so only GrailBabe lights up.
 */
function mockDailySeries(
  appId: string,
  today = new Date(),
): { timestamp: string; value: number }[] {
  // Small deterministic jitter pattern (index 0 = oldest day).
  const JITTER = [2, -3, 1, 4, -2, 3, -1, 2, -4, 3, 1, -2, 4, -3, 2, 1, -1, 3, -2, 4, 2, -3, 1, -1, 3, -4, 2, 1, 3, -2];

  const baseByApp: Record<string, number> = {
    grailbabe: 52,
    orbit: 18,
    "kinisis-labs": 4,
  };
  const base = baseByApp[appId] ?? 30;

  const series: { timestamp: string; value: number }[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const timestamp = d.toISOString().slice(0, 10) + "T00:00:00Z";
    const dayIndex = 29 - i; // 0 = oldest, 29 = today

    let value = base + JITTER[dayIndex % JITTER.length]!;

    // GrailBabe: inject a ~2.2× spike 2 days ago so it falls inside the
    // 3-day recency window and is >mean+2σ across the 30-day window.
    if (appId === "grailbabe" && i === 2) {
      value = Math.round(base * 2.25);
    }

    series.push({ timestamp, value: Math.max(0, value) });
  }
  return series;
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
  // bypassCache is a no-op in mock mode (Azure unconfigured) because
  // fetchMonthToDateCost and fetchBudgetForApp short-circuit to null before
  // touching the in-process cache.  In live mode it evicts the cached cost and
  // budget entries so force-refresh always pulls fresh Azure Cost Management
  // data rather than serving a stale 30-min (cost) or 1-hour (budget) snapshot.
  const bypassCache = req.query["refresh"] === "true";
  const scope = billingScope(app.id);
  const [costWS, budgetWithSource, rev, priorMonthTotal] = await Promise.all([
    fetchMonthToDateCostWithFallback(app, { bypassCache, billingScope: scope }),
    fetchBudgetForAppWithFallback(app, { bypassCache }),
    syncAndReadRevenue(app),
    // Fetch the prior month's comparable MTD cost for the real MoM calculation.
    // In mock mode (Azure unconfigured) this short-circuits to null immediately.
    // In live/cached mode it queries Cost Management for the same elapsed
    // day-of-month window last month (e.g. May 1–8 when today is June 8).
    fetchLastMonthComparableCostTotal(app, { bypassCache, billingScope: scope }),
  ]);
  const liveCost = costWS?.result ?? null;
  const mtd = liveCost?.monthToDate ?? 0;
  const byService = liveCost?.byService ?? [];
  const budget = budgetWithSource?.result.amount ?? 0;
  const forecast = budgetWithSource?.result.forecastAmount ?? 0;
  const budgetDataSource = budgetWithSource?.source ?? "estimated";

  // Month-over-month percentage change.
  // Live / cached mode: compares current MTD against priorMonthTotal (the
  // Azure Cost Management query for the same elapsed day-of-month last month).
  // Returns null when either figure is zero so the UI can hide the indicator.
  // Mock mode (Azure unconfigured): deterministic hash of the app ID so the
  // indicator renders a consistent reading per app in the Replit dev preview.
  const momChangePct = computeMomChangePct(app.id, mtd, costWS?.source ?? "mock", priorMonthTotal);

  // costWS is null when Azure Cost Management is not configured (mock mode).
  // Serve a synthetic daily series so anomaly badges render in the dev preview.
  const daily = costWS == null ? mockDailySeries(app.id) : [];

  const data = GetCostResponse.parse({
    currency: "USD",
    monthToDate: mtd,
    forecast,
    budget,
    daily,
    byService,
    apiUsage: { totalCalls: 0, costPerMillion: 0, cost: 0, byApi: [] },
    revenue: buildRevenueDto(rev),
    dataSource: costWS?.source ?? "mock",
    ...(liveCost ? { dataAsOf: liveCost.dataAsOf } : {}),
    budgetDataSource,
    momChangePct,
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

  // Resolve App Insights resource ID for deep-link construction on the frontend.
  // Uses the in-process cache populated by the parallel fetches above, so this
  // is effectively free when Monitor is configured (cache hit), and a single
  // Resource Graph query otherwise.
  const appInsightsResourceId = await resolveAppInsightsResourceId(app);

  const lastPoint = (series: typeof liveCpuSeries) =>
    series && series.length > 0 ? series[series.length - 1]!.value : undefined;
  const liveCpuPct = lastPoint(liveCpuSeries);
  const liveMemPct = lastPoint(liveMemSeries);
  const isLive = Boolean(liveMetrics || liveCpuSeries || liveMemSeries || liveTopExceptions);

  const metricsFetchedAt = getMetricsFetchedAt(app.id);
  const telemetryCachedAt = isLive && metricsFetchedAt ? new Date(metricsFetchedAt).toISOString() : undefined;
  const data = GetTelemetryResponse.parse({
    requestsPerMin: liveMetrics?.requestsPerMin ?? 0,
    p95LatencyMs: liveMetrics?.p95LatencyMs ?? 0,
    p95LatencyIsReal: liveMetrics?.p95LatencyIsReal ?? false,
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
    ...(telemetryCachedAt ? { cachedAt: telemetryCachedAt } : {}),
    ...(appInsightsResourceId ? { appInsightsResourceId } : {}),
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
router.get("/global/health", async (_req, res) => {
  const [costResults, lastMonthResults] = await Promise.all([
    Promise.all(APPS.map((a) => fetchMonthToDateCostWithFallback(a, { billingScope: billingScope(a.id) }))),
    Promise.all(APPS.map((a) => fetchLastMonthComparableCostTotal(a, { billingScope: billingScope(a.id) }))),
  ]);

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

  const monthToDateCost = costResults.reduce((sum, ws) => sum + (ws?.result.monthToDate ?? 0), 0);

  // Derive aggregate data source: live > cached > mock
  const sources = costResults.map((ws) => ws?.source ?? "mock");
  const costDataSource: "live" | "cached" | "mock" = sources.every((s) => s === "live")
    ? "live"
    : sources.some((s) => s === "live" || s === "cached")
    ? "cached"
    : "mock";

  // Compute MoM trend only when Azure Cost Management returned live/cached data.
  // Omit (undefined) for mock so the frontend knows not to render the badge.
  let momTrendPct: number | undefined;
  if (costDataSource !== "mock") {
    const lastMonthTotal = lastMonthResults.reduce<number | null>((sum, v) => {
      if (v === null) return null; // any null → whole trend is unavailable
      if (sum === null) return null;
      return sum + v;
    }, 0);
    if (lastMonthTotal !== null && lastMonthTotal > 0.01) {
      momTrendPct = Number((((monthToDateCost - lastMonthTotal) / lastMonthTotal) * 100).toFixed(1));
    }
  }

  const data = GetGlobalHealthResponse.parse({
    ...totals,
    activeAlerts: 0,
    monthToDateCost,
    costDataSource,
    ...(momTrendPct !== undefined ? { momTrendPct } : {}),
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

// ---------------------------------------------------------------------------
// --- deployments (GitHub Actions) ---
router.get("/apps/:appId/deployments", async (req, res) => {
  const app = findApp(req.params.appId);
  if (!app) {
    res.status(404).json({ error: "App not found" });
    return;
  }
  const result = await fetchDeployments(app.id, app.name, app.appRepo, app.environment);
  const data = ListDeploymentsResponse.parse({
    deployments: result.runs,
    dataSource: result.dataSource,
    ...(result.fetchedAt ? { fetchedAt: result.fetchedAt } : {}),
  });
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

router.get("/global/slos", async (_req, res) => {
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
      p95LatencyIsReal: m.p95LatencyIsReal,
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

  const slosDataSource = isMonitorConfigured() ? "live" : "mock";
  res.json(ListSlosResponse.parse({
    rows,
    dataSource: slosDataSource,
    ...(slosDataSource === "live" ? { dataAsOf: new Date().toISOString() } : {}),
  }));
});

// --- global: cost summary ---
// Deterministic mock WoW trend per app (used when Azure cost data is unavailable).
// Values are stable across requests so the UI doesn't flicker.
const MOCK_APP_TRENDS: Record<string, string> = {
  "grailbabe": "+5.2%",
  "orbit": "-2.1%",
  "kinisis-labs": "+0.8%",
};

/**
 * Derive a WoW trend string from an app's per-service cost data.
 * When at least one service has a trend, compute the spend-weighted average.
 * Falls back to null when no service trends are available (e.g. first week of month).
 */
function deriveTrendFromServices(byService: Array<{ service: string; amount: number; trend?: string | null }>): string | null {
  let totalAmount = 0;
  let weightedPct = 0;
  let hasAny = false;
  for (const svc of byService) {
    if (!svc.trend) continue;
    const pct = parseFloat(svc.trend.replace("%", ""));
    if (!Number.isFinite(pct)) continue;
    totalAmount += svc.amount;
    weightedPct += pct * svc.amount;
    hasAny = true;
  }
  if (!hasAny || totalAmount === 0) return null;
  const avg = weightedPct / totalAmount;
  return (avg >= 0 ? "+" : "") + avg.toFixed(1) + "%";
}

router.get("/global/cost-summary", async (_req, res) => {
  const costResults = await Promise.all(
    APPS.map((a) => fetchMonthToDateCostWithFallback(a, { billingScope: billingScope(a.id) })),
  );

  let overallSource: "live" | "cached" | "mock" = "mock";
  let latestDataAsOf: string | null = null;

  const byApp = APPS.map((app, i) => {
    const costWS = costResults[i];
    const mtd = costWS?.result.monthToDate ?? 0;
    const byService = costWS?.result.byService ?? [];

    // Track the most precise data source across all apps.
    if (costWS?.source === "live") overallSource = "live";
    else if (costWS?.source === "cached" && overallSource === "mock") overallSource = "cached";

    // Track the most recent dataAsOf across apps.
    if (costWS?.result.dataAsOf) {
      if (!latestDataAsOf || costWS.result.dataAsOf > latestDataAsOf) {
        latestDataAsOf = costWS.result.dataAsOf;
      }
    }

    // Trend: derive from live/cached service data if available, otherwise use mock.
    let trend: string | null = null;
    if (costWS) {
      trend = deriveTrendFromServices(byService);
      if (trend === null) {
        // Live data but no service trends yet (e.g. first week of month) — use mock.
        trend = MOCK_APP_TRENDS[app.id] ?? null;
      }
    } else {
      trend = MOCK_APP_TRENDS[app.id] ?? null;
    }

    return {
      appId: app.id,
      appName: app.name,
      environment: app.environment,
      monthToDate: mtd,
      trend,
    };
  });

  const total = byApp.reduce((sum, r) => sum + r.monthToDate, 0);

  res.json(GetGlobalCostSummaryResponse.parse({
    total: Number(total.toFixed(2)),
    currency: "USD",
    byApp,
    dataSource: overallSource,
    ...(latestDataAsOf ? { dataAsOf: latestDataAsOf } : {}),
  }));
});

// --- global: network endpoints ---
// Aggregates endpoint health across all apps from Azure Resource Graph.
router.get("/global/endpoints", async (_req, res) => {
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

  // dataSource = "live" if we found real resources, "mock" if Azure is configured but returned nothing
  const anyLive = endpointResults.some((r) => r !== null && r.length > 0);
  const dataSource = anyLive ? "live" : "mock";

  res.json(ListGlobalEndpointsResponse.parse({
    endpoints: rows,
    liveEnabled: true,
    dataSource,
    ...(anyLive ? { dataAsOf: new Date().toISOString() } : {}),
  }));
});

export default router;
