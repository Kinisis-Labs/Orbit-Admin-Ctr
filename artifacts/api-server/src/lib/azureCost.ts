import { CostManagementClient } from "@azure/arm-costmanagement";
import { ResourceGraphClient } from "@azure/arm-resourcegraph";
import { eq } from "drizzle-orm";
import { db, costSnapshotsTable } from "@workspace/db";
import { getAzureCredential, getSubscriptionIds, isAzureConfigured } from "./azure.js";
import { logger } from "./logger.js";
import type { AppRecord } from "../routes/orbit.js";

export type CostByService = { service: string; amount: number; trend?: string };

export type CostResult = {
  monthToDate: number;
  byService: CostByService[];
  dataAsOf: string;
};

export type CostSource = "live" | "cached";

export type CostWithSource = {
  result: CostResult;
  source: CostSource;
};

let _costClient: CostManagementClient | null = null;
let _graphClient: ResourceGraphClient | null = null;

function getCostClient(): CostManagementClient {
  if (!_costClient) {
    _costClient = new CostManagementClient(getAzureCredential());
  }
  return _costClient;
}

function getGraphClient(): ResourceGraphClient {
  if (!_graphClient) {
    _graphClient = new ResourceGraphClient(getAzureCredential());
  }
  return _graphClient;
}

/** First day of the current UTC month in YYYY-MM-DD format. */
function monthStart(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

/** Today in YYYY-MM-DD format. */
function today(): string {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

/**
 * Returns the [start, end] dates for the same elapsed period last month.
 * e.g. if today is June 8, returns ["YYYY-05-01", "YYYY-05-08"].
 * Clamps end to the last day of last month when today > last month's length.
 */
function lastMonthComparablePeriod(): { start: string; end: string } {
  const now = new Date();
  const dayOfMonth = now.getUTCDate();
  const thisMonth = now.getUTCMonth(); // 0-indexed
  const thisYear = now.getUTCFullYear();

  const lastMonth = thisMonth === 0 ? 11 : thisMonth - 1;
  const lastMonthYear = thisMonth === 0 ? thisYear - 1 : thisYear;

  // Last day of last month
  const lastDayOfLastMonth = new Date(Date.UTC(lastMonthYear, lastMonth + 1, 0)).getUTCDate();
  const endDay = Math.min(dayOfMonth, lastDayOfLastMonth);

  const mm = String(lastMonth + 1).padStart(2, "0");
  const dd = String(endDay).padStart(2, "0");

  return {
    start: `${lastMonthYear}-${mm}-01`,
    end: `${lastMonthYear}-${mm}-${dd}`,
  };
}

/** A UUID-shaped GUID (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx). */
function isGuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

// Cache: RG name (lowercase) → subscriptionId
const _rgSubCache = new Map<string, string>();

// Cache: app id → { result, expiresAt }
const COST_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
type CostCacheEntry = { result: CostResult; expiresAt: number };
const _costCache = new Map<string, CostCacheEntry>();

/** Evict all cached cost entries (e.g. for a forced refresh). */
export function clearCostCache(): void {
  _costCache.clear();
}

/** Evict the cached cost entry for a single app. */
export function clearCostCacheForApp(appId: string): void {
  _costCache.delete(appId);
}

/** Evict all cached last-month comparable cost entries. */
export function clearLastMonthCache(): void {
  _lastMonthCache.clear();
}

/** Evict the cached last-month cost entry for a single billing scope. */
export function clearLastMonthCacheForScope(scope: string): void {
  _lastMonthCache.delete(scope);
}

/**
 * Resolve the Azure subscription ID for an app's resource group.
 *
 * Priority:
 *   1. Use app.subscriptionId directly if it is a valid GUID (fastest path,
 *      works in production once AppRecord is updated with real GUIDs).
 *   2. Check the local cache (avoids repeated Resource Graph lookups per request).
 *   3. Query resourcecontainers via Resource Graph to find which subscription
 *      actually owns this resource group name — correct for multi-subscription
 *      environments regardless of which subscription is listed first in
 *      AZURE_SUBSCRIPTION_IDS.
 */
export async function resolveSubscriptionId(app: AppRecord): Promise<string | null> {
  if (isGuid(app.subscriptionId)) return app.subscriptionId;

  const rgKey = app.resourceGroup.toLowerCase();
  const cached = _rgSubCache.get(rgKey);
  if (cached) return cached;

  const subscriptionIds = getSubscriptionIds();
  if (subscriptionIds.length === 0) return null;

  // Query resourcecontainers for the RG to discover its real subscription ID.
  const query = `
    resourcecontainers
    | where type =~ 'microsoft.resources/subscriptions/resourcegroups'
    | where name =~ '${rgKey}'
    | project subscriptionId
    | limit 1
  `;

  try {
    const result = await getGraphClient().resources({
      query,
      subscriptions: subscriptionIds,
    });
    const rows = (result.data as unknown as Record<string, unknown>[]) ?? [];
    const subId = rows[0]?.["subscriptionId"] as string | undefined;
    if (subId && isGuid(subId)) {
      _rgSubCache.set(rgKey, subId);
      return subId;
    }
    logger.warn(
      { appId: app.id, rg: rgKey, searchedSubs: subscriptionIds },
      "Resource Graph could not locate RG in any configured subscription — set AZURE_SUB_<APPID> or add the subscription to AZURE_SUBSCRIPTION_IDS",
    );
  } catch (err) {
    logger.warn({ err, appId: app.id, rg: rgKey }, "Resource Graph RG lookup failed");
  }

  return null;
}

// Cache: app id → { total, expiresAt } (keyed per month-year so stale entries auto-expire)
const LAST_MONTH_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
type LastMonthCacheEntry = { total: number; expiresAt: number };
const _lastMonthCache = new Map<string, LastMonthCacheEntry>();

/**
 * Fetch the aggregate cost for an app over the comparable elapsed period last month.
 * e.g. if today is June 8, fetches May 1–May 8.
 * Returns null when Azure is not configured or on any error.
 *
 * Results are cached for 1 hour keyed by the resolved billing scope path
 * (e.g. `/subscriptions/{id}` or `/subscriptions/{id}/resourceGroups/{rg}`).
 * Keying on the scope path rather than the app ID means multiple apps that
 * share the same billing scope (e.g. two apps queried at subscription scope for
 * the same subscription) share a single cached value and a single Azure API
 * call, avoiding redundant Cost Management requests.
 *
 * Pass `bypassCache: true` to evict the cached entry and force a fresh API
 * call (e.g. when the cost route receives a refresh=true query param).
 */
export async function fetchLastMonthComparableCostTotal(
  app: AppRecord,
  { billingScope = "rg", bypassCache = false }: { billingScope?: "rg" | "subscription"; bypassCache?: boolean } = {},
): Promise<number | null> {
  if (!isAzureConfigured()) return null;

  // Resolve subscription ID first so we can build the canonical scope path,
  // which is the cache key.  _rgSubCache makes repeated calls cheap.
  const subscriptionId = await resolveSubscriptionId(app);
  if (!subscriptionId) return null;

  const scope =
    billingScope === "subscription"
      ? `/subscriptions/${subscriptionId}`
      : `/subscriptions/${subscriptionId}/resourceGroups/${app.resourceGroup}`;

  if (bypassCache) {
    _lastMonthCache.delete(scope);
  }

  // Cache by scope path: apps sharing the same billing scope reuse this entry.
  const entry = _lastMonthCache.get(scope);
  if (entry && entry.expiresAt > Date.now()) return entry.total;

  const { start, end } = lastMonthComparablePeriod();

  try {
    const result = await getCostClient().query.usage(scope, {
      type: "Usage",
      timeframe: "Custom",
      timePeriod: { from: new Date(start), to: new Date(end) },
      dataset: {
        granularity: "None",
        aggregation: {
          totalCost: { name: "PreTaxCost", function: "Sum" },
        },
      },
    });

    const columns: string[] = (result.columns ?? []).map((c) => String(c.name ?? ""));
    const rows = (result.rows ?? []) as unknown[][];
    const costIdx = columns.findIndex((c) => c.toLowerCase().includes("cost"));
    if (costIdx === -1 || rows.length === 0) return null;

    const total = Number(rows[0]?.[costIdx] ?? 0);
    _lastMonthCache.set(scope, { total, expiresAt: Date.now() + LAST_MONTH_CACHE_TTL_MS });
    return Number(total.toFixed(2));
  } catch (err) {
    logger.warn({ err, appId: app.id, scope, start, end }, "Last-month comparable cost query failed");
    return null;
  }
}

/**
 * Fetch month-to-date cost for the app's resource group from Cost Management.
 * Groups by ServiceName so we can surface a service breakdown.
 * Returns null when not configured or on any error (caller falls back to mock).
 *
 * Results are cached in-process for COST_CACHE_TTL_MS (30 min). Pass
 * `bypassCache: true` to skip the cache and force a fresh API call (the fresh
 * result is still written back to the cache).
 */
export async function fetchMonthToDateCost(
  app: AppRecord,
  { bypassCache = false, billingScope = "rg" }: { bypassCache?: boolean; billingScope?: "rg" | "subscription" } = {},
): Promise<CostResult | null> {
  // Evict before the configuration gate so a force-refresh always clears the
  // stale entry, even when Azure is temporarily unconfigured.
  if (bypassCache) {
    _costCache.delete(app.id);
  }

  if (!isAzureConfigured()) return null;

  // Return cached result if still fresh.
  if (!bypassCache) {
    const entry = _costCache.get(app.id);
    if (entry && entry.expiresAt > Date.now()) {
      return entry.result;
    }
  }

  const subscriptionId = await resolveSubscriptionId(app);
  if (!subscriptionId) return null;

  // Use subscription scope for apps with a dedicated subscription (all costs in that
  // sub are attributable to this app).  Use resource-group scope for apps that share
  // a subscription with other apps so we only count their portion of the bill.
  const scope =
    billingScope === "subscription"
      ? `/subscriptions/${subscriptionId}`
      : `/subscriptions/${subscriptionId}/resourceGroups/${app.resourceGroup}`;

  try {
    const result = await getCostClient().query.usage(scope, {
      type: "Usage",
      timeframe: "Custom",
      timePeriod: { from: new Date(monthStart()), to: new Date(today()) },
      dataset: {
        granularity: "Daily",
        aggregation: {
          totalCost: { name: "PreTaxCost", function: "Sum" },
        },
        grouping: [{ type: "Dimension", name: "ServiceName" }],
      },
    });

    const columns: string[] = (result.columns ?? []).map((c) =>
      String(c.name ?? ""),
    );
    const rows = (result.rows ?? []) as unknown[][];

    logger.info(
      { appId: app.id, scope, columns, rowCount: rows.length, firstRow: rows[0] ?? null },
      "Azure Cost Management response received",
    );

    const costIdx = columns.findIndex((c) => c.toLowerCase().includes("cost"));
    const svcIdx = columns.findIndex((c) => c.toLowerCase().includes("service"));
    const dateIdx = columns.findIndex(
      (c) => c.toLowerCase().includes("date") || c.toLowerCase() === "usagedate",
    );

    if (costIdx === -1) {
      logger.warn({ appId: app.id, columns }, "Cost column not found in Azure Cost Management response");
      return null;
    }

    // Compute WoW trend cutoffs as integers (YYYYMMDD).
    const nowUtc = new Date();
    const todayInt = parseInt(nowUtc.toISOString().slice(0, 10).replace(/-/g, ""), 10);
    const d7 = new Date(nowUtc);
    d7.setUTCDate(d7.getUTCDate() - 7);
    const d7Int = parseInt(d7.toISOString().slice(0, 10).replace(/-/g, ""), 10);
    const d14 = new Date(nowUtc);
    d14.setUTCDate(d14.getUTCDate() - 14);
    const d14Int = parseInt(d14.toISOString().slice(0, 10).replace(/-/g, ""), 10);

    // Per-service daily buckets: service → { total, recent7, prior7 }
    const svcBuckets = new Map<string, { total: number; recent7: number; prior7: number }>();
    let grandTotal = 0;

    for (const row of rows) {
      const amount = Number(row[costIdx] ?? 0);
      const service = svcIdx !== -1 ? String(row[svcIdx] ?? "Other") : "Other";
      const dateInt = dateIdx !== -1 ? Number(row[dateIdx] ?? 0) : 0;

      grandTotal += amount;

      let bucket = svcBuckets.get(service);
      if (!bucket) {
        bucket = { total: 0, recent7: 0, prior7: 0 };
        svcBuckets.set(service, bucket);
      }
      bucket.total += amount;
      if (dateInt >= d7Int && dateInt <= todayInt) bucket.recent7 += amount;
      else if (dateInt >= d14Int && dateInt < d7Int) bucket.prior7 += amount;
    }

    const byService: CostByService[] = [];
    for (const [service, b] of svcBuckets) {
      let trend: string | undefined;
      if (b.prior7 > 0.01) {
        const pct = ((b.recent7 - b.prior7) / b.prior7) * 100;
        trend = (pct >= 0 ? "+" : "") + pct.toFixed(1) + "%";
      }
      byService.push({ service, amount: Number(b.total.toFixed(2)), trend });
    }

    byService.sort((a, b) => b.amount - a.amount);

    const costResult: CostResult = {
      monthToDate: Number(grandTotal.toFixed(2)),
      byService,
      dataAsOf: new Date().toISOString(),
    };
    _costCache.set(app.id, { result: costResult, expiresAt: Date.now() + COST_CACHE_TTL_MS });
    return costResult;
  } catch (err) {
    logger.warn({ err, appId: app.id, scope }, "Azure Cost Management query failed — falling back to cached/mock");
    return null;
  }
}

/**
 * Persist a successfully-fetched cost snapshot to the database.
 * Write failures are non-fatal — the live result is already in hand.
 */
async function writeCostSnapshot(appId: string, result: CostResult): Promise<void> {
  try {
    const now = new Date();
    await db
      .insert(costSnapshotsTable)
      .values({
        appId,
        monthToDate: result.monthToDate.toFixed(2),
        byService: result.byService,
        dataAsOf: new Date(result.dataAsOf),
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: costSnapshotsTable.appId,
        set: {
          monthToDate: result.monthToDate.toFixed(2),
          byService: result.byService,
          dataAsOf: new Date(result.dataAsOf),
          updatedAt: now,
        },
      });
  } catch (err) {
    logger.warn({ err, appId }, "cost snapshot write failed (non-fatal)");
  }
}

/**
 * Read the last persisted cost snapshot for an app from the database.
 * Returns null if no snapshot exists or the DB is unavailable.
 */
async function readCostSnapshot(appId: string): Promise<CostResult | null> {
  try {
    const row = await db.query.costSnapshotsTable.findFirst({
      where: eq(costSnapshotsTable.appId, appId),
    });
    if (!row) return null;
    return {
      monthToDate: Number(row.monthToDate),
      byService: row.byService as CostByService[],
      dataAsOf: row.dataAsOf.toISOString(),
    };
  } catch (err) {
    logger.warn({ err, appId }, "cost snapshot read failed (non-fatal)");
    return null;
  }
}

/**
 * Fetch month-to-date cost for an app with a three-tier fallback strategy:
 *
 *   1. **live**   — Azure Cost Management succeeded; result is written through to DB.
 *   2. **cached** — Azure unavailable; last-known value from the DB snapshot is used.
 *   3. (returns null) — No DB snapshot; caller should apply formula estimates and report
 *                        dataSource = "mock".
 *
 * Use this in routes that need to surface the cost data source to the client.
 */
export async function fetchMonthToDateCostWithFallback(
  app: AppRecord,
  opts: { bypassCache?: boolean; billingScope?: "rg" | "subscription" } = {},
): Promise<CostWithSource | null> {
  const live = await fetchMonthToDateCost(app, opts);

  if (live !== null) {
    await writeCostSnapshot(app.id, live);
    return { result: live, source: "live" };
  }

  const snapshot = await readCostSnapshot(app.id);
  if (snapshot !== null) {
    return { result: snapshot, source: "cached" };
  }

  return null;
}
