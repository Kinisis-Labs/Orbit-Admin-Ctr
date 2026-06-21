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
  CreateOpsCostItemBody,
  UpdateOpsCostItemBody,
} from "@workspace/api-zod";
import { db, appThresholdsTable, appThresholdsLogTable } from "@workspace/db";
import { eq, desc, sql } from "drizzle-orm";
import { requireEngineerOrAdmin, requireAuth } from "../middlewares/auth.js";
import {
  fetchResourcesByResourceGroup,
  fetchResourceGroupTags,
  getResourcesFetchedAt,
} from "../lib/azureResources.js";
import {
  fetchMonthToDateCostWithFallback,
  fetchLastMonthComparableCostTotal,
  fetchCostByCostCategoryTag,
  fetchCostByApplicationTag,
} from "../lib/azureCost.js";
import { fetchThirdPartyUsage } from "../lib/thirdPartyUsage.js";
import {
  fetchOpsCostSummary,
  listOpsCostItems,
  createOpsCostItem,
  updateOpsCostItem,
  deleteOpsCostItem,
} from "../lib/businessOpsCosts.js";
import { fetchBudgetForAppWithFallback, diagnoseBudgetsForApp } from "../lib/azureBudgets.js";
import { diagnoseActivityLog } from "../lib/azureActivity.js";
import { fetchSubscriptionNames } from "../lib/azureSubscriptions.js";
import {
  fetchAppMetrics,
  fetchAppTimeSeries,
  fetchTopExceptions,
  fetchBrowserTelemetry,
  isMonitorConfigured,
  getLogAnalyticsWorkspaceId,
  resolveAppInsightsResourceId,
  getMetricsFetchedAt,
} from "../lib/azureMonitor.js";
import { isAzureConfigured } from "../lib/azure.js";
import { fetchActiveAlerts } from "../lib/azureAlerts.js";
import { fetchNetworkEndpoints, fetchConnectionMonitorPacketLoss } from "../lib/azureNetwork.js";
import { fetchDeployments } from "../lib/github.js";
import { fetchActivityLog } from "../lib/azureActivity.js";
import { fetchServiceHealth } from "../lib/azureServiceHealth.js";
import { resolveEnvCpuThreshold, resolveEnvMemoryThreshold } from "../lib/alertThresholds.js";
import { isStripeConfigured } from "../lib/stripeClient.js";
import { syncStripeSales } from "../lib/stripeSync.js";
import { getLedgerMonthRevenue } from "../lib/ledger.js";
import { LogsQueryClient } from "@azure/monitor-query";

const router: IRouter = Router();

/** Convert a Z-suffix ISO string to +00:00 offset format required by Zod datetime({offset:true}). */
function toOffsetIso(iso: string): string {
  return iso.endsWith("Z") ? iso.slice(0, -1) + "+00:00" : iso;
}

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
    resourceGroup: "rg-grailbabedprod-compute-prod-eus2",
    status: "healthy",
    activeAlerts: 0,
    monthToDateCost: 0,
    subscriptionId: process.env.AZURE_SUB_GRAILBABE || "",
    subscriptionName: "sub-GrailBabe-Prod",
    description: "Consumer marketplace for limited-edition collectibles.",
    tags: {
      CostCategory: "WebApp",
      Application: "GrailBabe",
      Environment: "prod",
      Owner: "Ryan Gutridge",
      workload: "GrailBabeProd",
      environment: "prod",
      owner: "Ryan Gutridge",
      "cost-center": "CC-GrailBabeProd",
      criticality: "mission-critical",
    },
    owners: ["Ryan Gutridge"],
    userAuth: "clerk",
    androidPackage: "com.grailbabe.app",
    playAppId: "placeholder-update-when-live",
    iosBundle: "com.kinisislabs.grailbabe",
    appleAppId: "6775650384",
    appRepo: "GrailBabe",
    cpuThreshold: 75,
    memoryThreshold: 80,
    budgetName: "bgt-grailbabe-prod",
  },
  {
    id: "kinisis-labs",
    name: "Business Ops",
    environment: "prod",
    region: "eastus2",
    resourceGroup: "rg-kinisislabs-platform-shared-prod-eus2",
    status: "healthy",
    activeAlerts: 0,
    monthToDateCost: 0,
    subscriptionId:
      process.env.AZURE_SUB_SHAREDPLATFORM || process.env.AZURE_SUB_KINISIS_LABS || "",
    subscriptionName: "Shared Platform Production",
    description:
      "Kinisis platform — Orbit admin center and kinisislabs.com, sharing the platform subscription (sub-sharedplatform-prod).",
    tags: {
      CostCategory: "BusinessOps",
      Application: "Orbit",
      Environment: "prod",
      Owner: "Ryan Gutridge",
      workload: "Platform",
      environment: "prod",
      owner: "Ryan Gutridge",
      "cost-center": "CC-Platform",
      criticality: "high",
    },
    owners: ["Ryan Gutridge"],
    userAuth: "entra",
    appRepo: "Orbit-Admin-Ctr",
    group: "Platform",
    budgetName: "bgt-sharedplatform-prd",
  },
];

// ---------------------------------------------------------------------------
// Billing scope config: "subscription" means the app owns its entire Azure
// subscription (query at sub scope for full cost coverage); "rg" means the app
// shares a subscription with others (query at resource-group scope only).
// ---------------------------------------------------------------------------
const APP_BILLING_SCOPE: Record<string, "rg" | "subscription"> = {
  grailbabe: "subscription", // mg-GrailBabeProd — dedicated subscription 01390551
  "kinisis-labs": "subscription", // sub-sharedplatform-prod — owns the full platform sub (Orbit + kinisislabs.com)
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
    Promise.all(
      APPS.map((a) =>
        fetchMonthToDateCostWithFallback(a, { bypassCache, billingScope: billingScope(a.id) }),
      ),
    ),
    Promise.all(
      APPS.map((a) =>
        fetchBudgetForAppWithFallback(a, { bypassCache, budgetScope: billingScope(a.id) }),
      ),
    ),
  ]);

  // Resolve subscription names from Azure once (cached; returns empty map in mock mode).
  const uniqueSubIds = [...new Set(APPS.map((a) => a.subscriptionId))];
  const subNames = await fetchSubscriptionNames(uniqueSubIds);

  const data = ListAppsResponse.parse(
    APPS.map((app, i) => {
      const liveAlerts = alertResults[i];
      const costWS = costWithSourceResults[i];
      const budgetWS = budgetWithSourceResults[i];
      const subName = subNames.get(app.subscriptionId.toLowerCase()) ?? app.subscriptionName;
      const mtd = costWS?.result.monthToDate ?? 0;
      const hasBudget = budgetWS?.result.hasBudget ?? false;
      const budget = hasBudget ? (budgetWS?.result.amount ?? null) : null;
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
  const subName = subNameMap.get(app.subscriptionId.toLowerCase()) ?? app.subscriptionName;
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
async function loadThresholdOverrides(): Promise<
  Map<string, { cpuThreshold: number; memoryThreshold: number }>
> {
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
function resolveThresholds(
  app: AppRecord,
  override?: { cpuThreshold: number; memoryThreshold: number },
) {
  return {
    cpuThreshold: override?.cpuThreshold ?? resolveEnvCpuThreshold(app.id, app.cpuThreshold),
    memoryThreshold:
      override?.memoryThreshold ?? resolveEnvMemoryThreshold(app.id, app.memoryThreshold),
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
    ? {
        cpuThreshold: parseFloat(row.cpuThreshold),
        memoryThreshold: parseFloat(row.memoryThreshold),
      }
    : undefined;
  const { cpuThreshold, memoryThreshold } = resolveThresholds(app, override);
  res.json(
    GetAppThresholdsResponse.parse({
      appId: app.id,
      cpuThreshold,
      memoryThreshold,
      updatedBy: row?.updatedBy ?? "system",
      updatedAt: row?.updatedAt ? toOffsetIso(row.updatedAt.toISOString()) : undefined,
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
      updatedAt: toOffsetIso(now.toISOString()),
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
        changedAt: toOffsetIso(r.changedAt.toISOString()),
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
  const seriesAll = liveResources
    ? [
        { name: "CPU %", unit: "%", points: liveCpuSeries ?? [] },
        { name: "Memory %", unit: "%", points: liveMemSeries ?? [] },
        { name: "Disk IOPS", unit: "ops/s", points: liveDiskIopsSeries ?? [] },
      ]
    : [];
  const series = seriesAll.filter((s) => s.points.length > 0);
  const resourcesFetchedAt = getResourcesFetchedAt(app.id);
  const infraCachedAt =
    liveResources && resourcesFetchedAt
      ? toOffsetIso(new Date(resourcesFetchedAt).toISOString())
      : undefined;
  // Only mark dataSource "live" when we actually have live metric series — if
  // resources are fetched but Log Analytics is unconfigured, series is empty
  // and we want the generic "no data" UI (not the "Log Analytics returned nothing" message).
  const metricsDataSource = series.length > 0 ? "live" : "mock";
  const data = GetInfrastructureResponse.parse({
    resources,
    series,
    dataSource: metricsDataSource,
    ...(infraCachedAt ? { cachedAt: infraCachedAt } : {}),
  });
  res.json(data);
});

// --- network ---
router.get("/apps/:appId/network", async (req, res) => {
  const app = findApp(req.params.appId);
  if (!app) {
    res.status(404).json({ error: "App not found" });
    return;
  }
  const bypassAll = req.query["refresh"] === "true";
  const bypassEndpoints = bypassAll || req.query["refreshEndpoints"] === "true";
  const bypassThroughput = bypassAll || req.query["refreshThroughput"] === "true";
  const [liveEndpoints, packetLossMap, liveIngressSeries, liveEgressSeries] = await Promise.all([
    fetchNetworkEndpoints(app, { bypassCache: bypassEndpoints }),
    fetchConnectionMonitorPacketLoss(app),
    fetchAppTimeSeries(app, "network_ingress_mbps", 24, { bypassCache: bypassThroughput }),
    fetchAppTimeSeries(app, "network_egress_mbps", 24, { bypassCache: bypassThroughput }),
  ]);
  const endpoints = (liveEndpoints ?? []).map((ep) => {
    if (packetLossMap.size === 0) return ep;
    const epKey = ep.name.toLowerCase();
    for (const [testName, loss] of packetLossMap) {
      if (epKey.includes(testName) || testName.includes(epKey)) {
        return { ...ep, packetLossPercent: loss };
      }
    }
    return ep;
  });
  const throughputAll: {
    name: string;
    unit: string;
    points: { timestamp: string; value: number }[];
  }[] =
    liveIngressSeries || liveEgressSeries
      ? [
          { name: "Ingress", unit: "MB/s", points: liveIngressSeries ?? [] },
          { name: "Egress", unit: "MB/s", points: liveEgressSeries ?? [] },
        ]
      : [];
  const throughput = throughputAll.filter((s) => s.points.length > 0);
  const dataSource = liveIngressSeries !== null || liveEgressSeries !== null ? "live" : "mock";
  const endpointsDataSource = liveEndpoints !== null ? "live" : "mock";
  const data = GetNetworkResponse.parse({ endpoints, throughput, dataSource, endpointsDataSource });
  res.json(data);
});

// --- cost ---

/**
 * Deterministic mock API usage breakdown per app.
 * These figures represent realistic Azure API Management (APIM) consumption
 * operation rows — shown in the "Cost by API Name" table when live APIM
 * billing data is not yet wired.
 *
 * Numbers are pro-rated to roughly 10 days into a 30-day month (June 2026
 * baseline) so MTD figures look proportional to the full-month budget.
 */
function mockApiUsageForApp(appId: string): {
  totalCalls: number;
  costPerMillion: number;
  cost: number;
  byApi: { name: string; totalCalls: number; cost: number }[];
} {
  if (appId === "grailbabe") {
    const byApi = [
      { name: "GET /v1/products", totalCalls: 68_400, cost: 0.72 },
      { name: "GET /v1/search", totalCalls: 42_300, cost: 0.44 },
      { name: "GET /v1/users/{id}", totalCalls: 28_500, cost: 0.3 },
      { name: "POST /v1/orders", totalCalls: 19_800, cost: 0.21 },
      { name: "POST /v1/media/upload", totalCalls: 9_200, cost: 0.1 },
      { name: "POST /v1/notifications", totalCalls: 8_100, cost: 0.07 },
    ];
    const totalCalls = byApi.reduce((s, r) => s + r.totalCalls, 0);
    const cost = Number(byApi.reduce((s, r) => s + r.cost, 0).toFixed(2));
    const costPerMillion = Number((cost / (totalCalls / 1_000_000)).toFixed(2));
    return { totalCalls, costPerMillion, cost, byApi };
  }

  if (appId === "kinisis-labs") {
    const byApi = [
      { name: "GET /api/apps", totalCalls: 3_420, cost: 0.12 },
      { name: "POST /api/webhooks/clerk/{appId}", totalCalls: 2_380, cost: 0.08 },
      { name: "GET /api/apps/{id}/cost", totalCalls: 2_140, cost: 0.07 },
      { name: "GET /api/auth/me", totalCalls: 1_290, cost: 0.04 },
    ];
    const totalCalls = byApi.reduce((s, r) => s + r.totalCalls, 0);
    const cost = Number(byApi.reduce((s, r) => s + r.cost, 0).toFixed(2));
    const costPerMillion = Number((cost / (totalCalls / 1_000_000)).toFixed(2));
    return { totalCalls, costPerMillion, cost, byApi };
  }

  return { totalCalls: 0, costPerMillion: 0, cost: 0, byApi: [] };
}

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
async function syncAndReadRevenue(
  app: AppRecord,
): Promise<{ stripe: number; appStore: number; playStore: number }> {
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
 * @param mtd          Current month-to-date spend in USD.
 * @param priorMonthTotal  Prior month comparable cost (May 1–N if today is
 *                         June N), fetched from Azure; null when unavailable.
 */
function computeMomChangePct(mtd: number, priorMonthTotal: number | null = null): number | null {
  if (mtd <= 0) return null;
  if (priorMonthTotal === null || priorMonthTotal <= 0) return null;
  const pct = ((mtd - priorMonthTotal) / priorMonthTotal) * 100;
  return Math.round(pct * 10) / 10; // 1 decimal place
}

function buildRevenueDto(r: { stripe: number; appStore: number; playStore: number }) {
  const bySource = [
    {
      source: "stripe" as const,
      label: REVENUE_SOURCE_LABELS.stripe,
      amount: Number(r.stripe.toFixed(2)),
    },
    {
      source: "app_store" as const,
      label: REVENUE_SOURCE_LABELS.app_store,
      amount: Number(r.appStore.toFixed(2)),
    },
    {
      source: "play_store" as const,
      label: REVENUE_SOURCE_LABELS.play_store,
      amount: Number(r.playStore.toFixed(2)),
    },
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
  // bypassCache evicts the cached cost and budget entries so force-refresh
  // always pulls fresh Azure Cost Management data rather than serving a stale
  // 30-min (cost) or 1-hour (budget) snapshot.
  const bypassCache = req.query["refresh"] === "true";
  const scope = billingScope(app.id);
  const [costWS, budgetWithSource, rev, priorMonthTotal, thirdPartyUsage, opsCosts] =
    await Promise.all([
      fetchMonthToDateCostWithFallback(app, { bypassCache, billingScope: scope }),
      fetchBudgetForAppWithFallback(app, { bypassCache, budgetScope: scope }),
      syncAndReadRevenue(app),
      // Fetch the prior month's comparable MTD cost for the MoM calculation.
      // Queries Cost Management for the same elapsed day-of-month window last
      // month (e.g. May 1–8 when today is June 8). Returns null when Azure is
      // not yet configured.
      fetchLastMonthComparableCostTotal(app, { bypassCache, billingScope: scope }),
      // Third-party API spend (OpenAI, Replicate). Live when env vars are set;
      // falls back to deterministic placeholder values otherwise.
      fetchThirdPartyUsage(app.id),
      // Non-Azure operational costs (website ops, network ops, M365 licenses).
      // Only populated for the Business Ops app; returns an empty summary for others.
      app.id === "kinisis-labs" ? fetchOpsCostSummary(app.id) : Promise.resolve(null),
    ]);
  const liveCost = costWS?.result ?? null;
  const mtd = liveCost?.monthToDate ?? 0;
  const byService = liveCost?.byService ?? [];
  const hasBudget = budgetWithSource?.result.hasBudget ?? false;
  const budget = hasBudget ? (budgetWithSource?.result.amount ?? 0) : 0;
  const forecast = budgetWithSource?.result.forecastAmount ?? 0;
  const budgetDataSource = budgetWithSource
    ? hasBudget
      ? budgetWithSource.source
      : "estimated"
    : "estimated";

  // Month-over-month percentage change: compares current MTD against the
  // prior month's comparable cost. Returns null when either figure is zero
  // or unavailable so the UI can suppress a misleading indicator.
  const momChangePct = computeMomChangePct(mtd, priorMonthTotal);

  // Daily cost series for the 30-day chart. Populated from Azure Cost
  // Management when configured; empty otherwise.
  const daily = liveCost?.daily ?? [];

  // For apps that use third-party AI APIs (GrailBabe: OpenAI + Replicate),
  // use the fetched usage; fall back to the internal mock for other apps.
  const apiUsage = thirdPartyUsage.byApi.length > 0 ? thirdPartyUsage : mockApiUsageForApp(app.id);

  const data = GetCostResponse.parse({
    currency: "USD",
    monthToDate: mtd,
    forecast,
    budget,
    daily,
    byService,
    apiUsage,
    revenue: buildRevenueDto(rev),
    dataSource: costWS?.source ?? "mock",
    ...(liveCost ? { dataAsOf: liveCost.dataAsOf } : {}),
    budgetDataSource,
    momChangePct,
    ...(opsCosts ? { opsCosts } : {}),
  });
  res.json(data);
});

// --- ops costs (Business Ops only) ---
router.get("/apps/:appId/ops-costs", requireEngineerOrAdmin, async (req, res) => {
  const app = findApp(req.params.appId as string);
  if (!app) {
    res.status(404).json({ error: "App not found" });
    return;
  }
  const items = await listOpsCostItems(app.id);
  res.json(items);
});

router.post("/apps/:appId/ops-costs", requireEngineerOrAdmin, async (req, res) => {
  const app = findApp(req.params.appId as string);
  if (!app) {
    res.status(404).json({ error: "App not found" });
    return;
  }
  const parsed = CreateOpsCostItemBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
    return;
  }
  const item = await createOpsCostItem(
    app.id,
    parsed.data as Parameters<typeof createOpsCostItem>[1],
  );
  res.status(201).json(item);
});

router.patch("/apps/:appId/ops-costs/:itemId", requireEngineerOrAdmin, async (req, res) => {
  const app = findApp(req.params.appId as string);
  if (!app) {
    res.status(404).json({ error: "App not found" });
    return;
  }
  const parsed = UpdateOpsCostItemBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
    return;
  }
  const item = await updateOpsCostItem(
    app.id,
    req.params.itemId as string,
    parsed.data as Parameters<typeof updateOpsCostItem>[2],
  );
  if (!item) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  res.json(item);
});

router.delete("/apps/:appId/ops-costs/:itemId", requireEngineerOrAdmin, async (req, res) => {
  const app = findApp(req.params.appId as string);
  if (!app) {
    res.status(404).json({ error: "App not found" });
    return;
  }
  const deleted = await deleteOpsCostItem(app.id, req.params.itemId as string);
  if (!deleted) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  res.status(204).send();
});

// --- telemetry ---
router.get("/apps/:appId/telemetry", async (req, res) => {
  const app = findApp(req.params.appId);
  if (!app) {
    res.status(404).json({ error: "App not found" });
    return;
  }
  const bypassCache = req.query["refresh"] === "true";

  const [
    liveMetrics,
    liveRpmSeries,
    liveLatenSeries,
    liveErrSeries,
    liveCpuSeries,
    liveMemSeries,
    liveTopExceptions,
    liveBrowserTelemetry,
    liveBrowserLoadSeries,
    liveBrowserExcSeries,
    liveBrowserPageViewSeries,
  ] = await Promise.all([
    fetchAppMetrics(app, { bypassCache }),
    fetchAppTimeSeries(app, "requests_per_min", 24, { bypassCache }),
    fetchAppTimeSeries(app, "p95_latency_ms", 24, { bypassCache }),
    fetchAppTimeSeries(app, "error_rate_pct", 24, { bypassCache }),
    fetchAppTimeSeries(app, "cpu_pct", 24, { bypassCache }),
    fetchAppTimeSeries(app, "memory_pct", 24, { bypassCache }),
    fetchTopExceptions(app, { hours: 24, limit: 5, bypassCache }),
    fetchBrowserTelemetry(app, { bypassCache }),
    fetchAppTimeSeries(app, "browser_page_load_p95", 24, { bypassCache }),
    fetchAppTimeSeries(app, "browser_exception_rate", 24, { bypassCache }),
    fetchAppTimeSeries(app, "browser_page_views", 24, { bypassCache }),
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
  const telemetryCachedAt =
    isLive && metricsFetchedAt ? toOffsetIso(new Date(metricsFetchedAt).toISOString()) : undefined;
  const fixPoints = (pts: { timestamp: string; value: number }[] | null) =>
    (pts ?? []).map((p) => ({ ...p, timestamp: toOffsetIso(p.timestamp) }));
  const data = GetTelemetryResponse.parse({
    requestsPerMin: liveMetrics?.requestsPerMin ?? 0,
    p95LatencyMs: liveMetrics?.p95LatencyMs ?? 0,
    p95LatencyIsReal: liveMetrics?.p95LatencyIsReal ?? false,
    errorRatePercent: liveMetrics?.errorRatePercent ?? 0,
    availabilityPercent: liveMetrics?.availabilityPercent ?? 0,
    cpuPercent: liveCpuPct,
    memoryPercent: liveMemPct,
    series: isLive
      ? [
          { name: "Requests / min", unit: "rpm", points: fixPoints(liveRpmSeries) },
          { name: "P95 latency (ms)", unit: "ms", points: fixPoints(liveLatenSeries) },
          { name: "Error rate (%)", unit: "%", points: fixPoints(liveErrSeries) },
          { name: "CPU %", unit: "%", points: fixPoints(liveCpuSeries) },
          { name: "Memory %", unit: "%", points: fixPoints(liveMemSeries) },
        ]
      : [],
    topErrors: (liveTopExceptions ?? []).map((e) => ({ ...e, lastSeen: toOffsetIso(e.lastSeen) })),
    dataSource: isLive ? "live" : "mock",
    ...(telemetryCachedAt ? { cachedAt: telemetryCachedAt } : {}),
    ...(appInsightsResourceId ? { appInsightsResourceId } : {}),
    ...(liveBrowserTelemetry
      ? {
          browserTelemetry: {
            ...liveBrowserTelemetry,
            series: [
              {
                name: "Browser page load P95 (ms)",
                unit: "ms",
                points: fixPoints(liveBrowserLoadSeries),
              },
              {
                name: "Browser exceptions / hour",
                unit: "/h",
                points: fixPoints(liveBrowserExcSeries),
              },
              {
                name: "Browser page views / hour",
                unit: "/h",
                points: fixPoints(liveBrowserPageViewSeries),
              },
            ],
          },
        }
      : {}),
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
    Promise.all(
      APPS.map((a) => fetchMonthToDateCostWithFallback(a, { billingScope: billingScope(a.id) })),
    ),
    Promise.all(
      APPS.map((a) => fetchLastMonthComparableCostTotal(a, { billingScope: billingScope(a.id) })),
    ),
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
      momTrendPct = Number(
        (((monthToDateCost - lastMonthTotal) / lastMonthTotal) * 100).toFixed(1),
      );
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
  const bypassCache = req.query["refresh"] === "true";
  const entries = await fetchActivityLog(app.id, app.resourceGroup, app.subscriptionId, {
    bypassCache,
  });
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

    const lines: Array<{
      id: string;
      timestamp: string;
      appId: string;
      level: string;
      message: string;
    }> = [];
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
        lines.push({
          id: `${app.id}-log-${lines.length}`,
          timestamp: ts,
          appId: app.id,
          level,
          message: msg,
        });
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
  const [metricsResults, cpuSeriesResults, memSeriesResults, thresholdOverrides] =
    await Promise.all([
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

    const { cpuThreshold, memoryThreshold } = resolveThresholds(
      app,
      thresholdOverrides.get(app.id),
    );

    return [
      {
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
      },
    ];
  });

  const slosDataSource = isMonitorConfigured() ? "live" : "mock";
  res.json(
    ListSlosResponse.parse({
      rows,
      dataSource: slosDataSource,
      ...(slosDataSource === "live" ? { dataAsOf: toOffsetIso(new Date().toISOString()) } : {}),
    }),
  );
});

// --- global: cost summary ---

/**
 * Derive a WoW trend string from an app's per-service cost data.
 * When at least one service has a trend, compute the spend-weighted average.
 * Falls back to null when no service trends are available (e.g. first week of month).
 */
function deriveTrendFromServices(
  byService: Array<{ service: string; amount: number; trend?: string | null }>,
): string | null {
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
  const [costResults, byCategory, byApplicationTag] = await Promise.all([
    Promise.all(APPS.map((a) => fetchMonthToDateCostWithFallback(a, { billingScope: billingScope(a.id) }))),
    fetchCostByCostCategoryTag(),
    fetchCostByApplicationTag(),
  ]);

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

    // Trend: derive from live/cached service data when available.
    // Returns null when Azure isn't configured or no per-service trend data
    // exists yet (e.g. first week of month).
    const trend: string | null = costWS ? deriveTrendFromServices(byService) : null;

    return {
      appId: app.id,
      appName: app.name,
      environment: app.environment,
      monthToDate: mtd,
      trend,
    };
  });

  const total = byApp.reduce((sum, r) => sum + r.monthToDate, 0);

  // Compute a spend-weighted global WoW trend from per-app trends.
  // Falls back to a simple average when all apps have zero/negligible MTD spend (e.g. mock mode).
  let globalWowTrend: string | null = null;
  {
    let weightedPct = 0;
    let totalWeight = 0;
    let simpleSum = 0;
    let simpleCount = 0;
    for (const item of byApp) {
      if (!item.trend) continue;
      const pct = parseFloat(item.trend.replace(/[^0-9.\-+]/g, ""));
      if (!Number.isFinite(pct)) continue;
      weightedPct += pct * item.monthToDate;
      totalWeight += item.monthToDate;
      simpleSum += pct;
      simpleCount += 1;
    }
    if (totalWeight > 0.01) {
      const avg = weightedPct / totalWeight;
      globalWowTrend = (avg >= 0 ? "+" : "") + avg.toFixed(1) + "%";
    } else if (simpleCount > 0) {
      const avg = simpleSum / simpleCount;
      globalWowTrend = (avg >= 0 ? "+" : "") + avg.toFixed(1) + "%";
    }
  }

  res.json(
    GetGlobalCostSummaryResponse.parse({
      total: Number(total.toFixed(2)),
      currency: "USD",
      byApp,
      ...(byCategory ? { byCategory } : {}),
      ...(byApplicationTag ? { byApplicationTag } : {}),
      dataSource: overallSource,
      ...(latestDataAsOf ? { dataAsOf: latestDataAsOf } : {}),
      ...(globalWowTrend !== null ? { wowTrend: globalWowTrend } : {}),
    }),
  );
});

// --- global: Azure Service Health ---
router.get("/global/service-health", async (_req, res) => {
  const events = await fetchServiceHealth();
  const liveEnabled = isAzureConfigured();
  res.json(
    ListServiceHealthResponse.parse({
      events,
      liveEnabled,
      dataSource: liveEnabled ? "live" : "mock",
    }),
  );
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

  res.json(
    ListGlobalEndpointsResponse.parse({
      endpoints: rows,
      liveEnabled: true,
      dataSource,
      ...(anyLive ? { dataAsOf: toOffsetIso(new Date().toISOString()) } : {}),
    }),
  );
});

export default router;

// ---------------------------------------------------------------------------
// Public debug router — mounted WITHOUT requireAuth so it can be hit directly
// in a browser (useful for diagnosing budget/forecast issues from production).
// Exported separately so routes/index.ts can mount it outside the auth guard.
// ---------------------------------------------------------------------------
export const debugRouter = Router();

debugRouter.get("/debug/azure-cost", async (_req, res) => {
  const { isAzureConfigured } = await import("../lib/azure.js");
  const { diagnoseCostForApp } = await import("../lib/azureCost.js");

  const results = await Promise.all(
    APPS.map((app) => diagnoseCostForApp(app, billingScope(app.id))),
  );

  res.json({ isAzureConfigured: isAzureConfigured(), results });
});

debugRouter.get("/debug/azure-budgets", async (_req, res) => {
  const results = await Promise.all(
    APPS.map((app) => diagnoseBudgetsForApp(app, billingScope(app.id))),
  );
  res.json({ results });
});

debugRouter.get("/debug/azure-activity", async (_req, res) => {
  const results = await Promise.all(
    APPS.map((app) => diagnoseActivityLog(app.id, app.resourceGroup, app.subscriptionId)),
  );
  res.json({ results });
});

debugRouter.get("/debug/azure-network", async (_req, res) => {
  const { getSubscriptionIds, isAzureConfigured } = await import("../lib/azure.js");
  const { getSharedInfraSubscriptionId, fetchNetworkEndpoints } =
    await import("../lib/azureNetwork.js");

  const isConfigured = isAzureConfigured();
  const globalSubs = getSubscriptionIds();
  const sharedInfraSub = getSharedInfraSubscriptionId();

  const perApp = APPS.map((app) => {
    const appSub =
      app.subscriptionId &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(app.subscriptionId)
        ? app.subscriptionId
        : null;
    const subscriptionIds = [
      ...new Set([
        ...globalSubs,
        ...(appSub ? [appSub] : []),
        ...(sharedInfraSub ? [sharedInfraSub] : []),
      ]),
    ];
    return { appId: app.id, appSub, subscriptionIds };
  });

  // Attempt a live query to confirm auth + RBAC are working.
  let liveTest: unknown = null;
  if (APPS.length > 0) {
    try {
      const result = await fetchNetworkEndpoints(APPS[0], { bypassCache: true });
      liveTest = { endpoints: result?.length ?? null, error: null };
    } catch (err: unknown) {
      liveTest = { endpoints: null, error: String(err) };
    }
  }

  res.json({
    isAzureConfigured: isConfigured,
    AZURE_CLIENT_ID: process.env.AZURE_CLIENT_ID ? "set" : "MISSING",
    AZURE_TENANT_ID: process.env.AZURE_TENANT_ID ? "set" : "MISSING",
    globalSubs,
    sharedInfraSub,
    perApp,
    liveTest,
  });
});
