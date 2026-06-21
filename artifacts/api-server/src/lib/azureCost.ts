import { CostManagementClient } from "@azure/arm-costmanagement";
import { ResourceGraphClient } from "@azure/arm-resourcegraph";
import { eq } from "drizzle-orm";
import { db, costSnapshotsTable } from "@workspace/db";
import {
  getAzureCredential,
  getSubscriptionIds,
  getBillingAccountId,
  isAzureConfigured,
} from "./azure.js";
import { normalizeResourceGraphRows } from "./azureNetwork.js";
import { logger } from "./logger.js";
import type { AppRecord } from "../routes/orbit.js";

export type CostByService = { service: string; amount: number; trend?: string };

export type DailyPoint = {
  timestamp: string;
  value: number;
  vsLastWeek?: number | null;
};

export type CostResult = {
  monthToDate: number;
  byService: CostByService[];
  /** 90-day daily totals across all services, sorted ascending. */
  daily: DailyPoint[];
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
export const _costCache = new Map<string, CostCacheEntry>();

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
    const rows = normalizeResourceGraphRows(result.data);
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
  {
    billingScope = "rg",
    bypassCache = false,
  }: { billingScope?: "rg" | "subscription"; bypassCache?: boolean } = {},
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

    const columns: string[] = (result.columns ?? []).map((c: { name?: string | null }) =>
      String(c.name ?? ""),
    );
    const rows = (result.rows ?? []) as unknown[][];
    const costIdx = columns.findIndex((c) => c.toLowerCase().includes("cost"));
    if (costIdx === -1 || rows.length === 0) return null;

    const total = Number(rows[0]?.[costIdx] ?? 0);
    _lastMonthCache.set(scope, { total, expiresAt: Date.now() + LAST_MONTH_CACHE_TTL_MS });
    return Number(total.toFixed(2));
  } catch (err) {
    logger.warn(
      { err, appId: app.id, scope, start, end },
      "Last-month comparable cost query failed",
    );
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
  {
    bypassCache = false,
    billingScope = "rg",
  }: { bypassCache?: boolean; billingScope?: "rg" | "subscription" } = {},
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
      timePeriod: {
        from: new Date(new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)),
        to: new Date(today()),
      },
      dataset: {
        granularity: "Daily",
        aggregation: {
          totalCost: { name: "PreTaxCost", function: "Sum" },
        },
        grouping: [{ type: "Dimension", name: "ServiceName" }],
      },
    });

    const columns: string[] = (result.columns ?? []).map((c: { name?: string | null }) =>
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
      logger.warn(
        { appId: app.id, columns },
        "Cost column not found in Azure Cost Management response",
      );
      return null;
    }

    // Compute cutoffs as integers (YYYYMMDD).
    const nowUtc = new Date();
    const todayInt = parseInt(nowUtc.toISOString().slice(0, 10).replace(/-/g, ""), 10);
    const d7 = new Date(nowUtc);
    d7.setUTCDate(d7.getUTCDate() - 7);
    const d7Int = parseInt(d7.toISOString().slice(0, 10).replace(/-/g, ""), 10);
    const d14 = new Date(nowUtc);
    d14.setUTCDate(d14.getUTCDate() - 14);
    const d14Int = parseInt(d14.toISOString().slice(0, 10).replace(/-/g, ""), 10);
    // Current month start — MTD and byService totals are scoped to this.
    const currentMonthStartInt = parseInt(monthStart().replace(/-/g, ""), 10);

    // Per-service daily buckets: service → { total (current month only), recent7, prior7 }
    const svcBuckets = new Map<string, { total: number; recent7: number; prior7: number }>();
    // Daily totals across all services for the full 90-day window: dateInt → amount
    const dailyTotals = new Map<number, number>();
    let grandTotal = 0;

    for (const row of rows) {
      const amount = Number(row[costIdx] ?? 0);
      const service = svcIdx !== -1 ? String(row[svcIdx] ?? "Other") : "Other";
      const dateInt = dateIdx !== -1 ? Number(row[dateIdx] ?? 0) : 0;

      // Daily series: accumulate all 90 days.
      if (dateInt > 0) {
        dailyTotals.set(dateInt, (dailyTotals.get(dateInt) ?? 0) + amount);
      }

      // Ensure the service bucket exists.
      let bucket = svcBuckets.get(service);
      if (!bucket) {
        bucket = { total: 0, recent7: 0, prior7: 0 };
        svcBuckets.set(service, bucket);
      }

      // MTD and byService.total: current month only.
      if (dateInt >= currentMonthStartInt) {
        grandTotal += amount;
        bucket.total += amount;
      }

      // WoW trend: last 14 days regardless of month boundary.
      if (dateInt >= d7Int && dateInt <= todayInt) bucket.recent7 += amount;
      else if (dateInt >= d14Int && dateInt < d7Int) bucket.prior7 += amount;
    }

    const byService: CostByService[] = [];
    for (const [service, b] of svcBuckets) {
      if (b.total === 0 && b.recent7 === 0 && b.prior7 === 0) continue;
      let trend: string | undefined;
      if (b.prior7 > 0.01) {
        const pct = ((b.recent7 - b.prior7) / b.prior7) * 100;
        trend = (pct >= 0 ? "+" : "") + pct.toFixed(1) + "%";
      }
      byService.push({ service, amount: Number(b.total.toFixed(2)), trend });
    }

    byService.sort((a, b) => b.amount - a.amount);

    // Build 90-day daily series sorted ascending with vsLastWeek.
    const daily: DailyPoint[] = [...dailyTotals.keys()]
      .sort((a, b) => a - b)
      .map((di) => {
        const value = dailyTotals.get(di) ?? 0;
        const ds = String(di);
        const timestamp = `${ds.slice(0, 4)}-${ds.slice(4, 6)}-${ds.slice(6, 8)}T00:00:00.000Z`;
        const priorDate = new Date(timestamp);
        priorDate.setUTCDate(priorDate.getUTCDate() - 7);
        const priorInt = parseInt(priorDate.toISOString().slice(0, 10).replace(/-/g, ""), 10);
        const priorValue = dailyTotals.get(priorInt);
        const vsLastWeek =
          priorValue != null && priorValue > 0.01
            ? Number((((value - priorValue) / priorValue) * 100).toFixed(1))
            : null;
        return { timestamp, value: Number(value.toFixed(4)), vsLastWeek };
      });

    const costResult: CostResult = {
      monthToDate: Number(grandTotal.toFixed(2)),
      byService,
      daily,
      dataAsOf: new Date().toISOString().replace(/Z$/, "+00:00"),
    };
    _costCache.set(app.id, { result: costResult, expiresAt: Date.now() + COST_CACHE_TTL_MS });
    return costResult;
  } catch (err) {
    logger.warn(
      { err, appId: app.id, scope },
      "Azure Cost Management query failed — falling back to cached/mock",
    );
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
      daily: [],
      dataAsOf: row.dataAsOf.toISOString().replace(/Z$/, "+00:00"),
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
export async function diagnoseCostForApp(
  app: AppRecord,
  scopeMode: "rg" | "subscription",
): Promise<{
  appId: string;
  scopeMode: string;
  subscriptionId: string | null;
  subError: string | null;
  queryScope: string | null;
  costQuery:
    | { ok: true; rowCount: number; columns: string[] }
    | { ok: false; error: string }
    | null;
  snapshotAge: string | null;
}> {
  let subscriptionId: string | null = null;
  let subError: string | null = null;
  try {
    subscriptionId = await resolveSubscriptionId(app);
  } catch (e) {
    subError = String(e);
  }

  const queryScope =
    subscriptionId == null
      ? null
      : scopeMode === "subscription"
        ? `/subscriptions/${subscriptionId}`
        : `/subscriptions/${subscriptionId}/resourceGroups/${app.resourceGroup}`;

  let costQuery:
    | { ok: true; rowCount: number; columns: string[] }
    | { ok: false; error: string }
    | null = null;
  if (queryScope) {
    try {
      const r = await getCostClient().query.usage(queryScope, {
        type: "Usage",
        timeframe: "MonthToDate",
        dataset: {
          granularity: "None",
          aggregation: { totalCost: { name: "PreTaxCost", function: "Sum" } },
        },
      });
      costQuery = {
        ok: true,
        rowCount: (r.rows ?? []).length,
        columns: (r.columns ?? []).map((c: { name?: string | null }) => c.name ?? ""),
      };
    } catch (e: unknown) {
      costQuery = { ok: false, error: String(e) };
    }
  }

  const snapshot = await readCostSnapshot(app.id);
  const snapshotAge = snapshot
    ? `${Math.round((Date.now() - new Date(snapshot.dataAsOf).getTime()) / 60_000)} min ago`
    : null;

  return { appId: app.id, scopeMode, subscriptionId, subError, queryScope, costQuery, snapshotAge };
}

/**
 * Maps Microsoft 365 billing product names (from the billing account scope query)
 * to Orbit / Grailbabe / Other cost centers. M365 charges cannot carry Azure resource
 * tags, so we infer the cost center from the product name. Returns null for Azure
 * infrastructure charges that are already captured via the subscription-scope query,
 * preventing double-counting.
 */
function m365ProductToCostCenter(productName: string): "Orbit" | "Grailbabe" | "Other" | null {
  const p = productName.toLowerCase();
  // Skip Azure infrastructure products — already in the subscription-scope query.
  if (
    p.includes("azure") ||
    p.includes("virtual machine") ||
    p.includes("storage") ||
    p.includes("bandwidth")
  ) {
    return null;
  }
  // Infer cost center from the product name when it names the entity directly.
  if (p.includes("orbit")) return "Orbit";
  if (p.includes("grailbabe")) return "Grailbabe";
  // All other M365 / Entra / Defender / Power Platform / GitHub SaaS charges are
  // untagged at the resource level, so bucket them as Other until explicitly mapped.
  return "Other";
}

/**
 * Query Azure Cost Management grouped by the `Application` tag across all configured
 * subscriptions. Returns an array of { application, monthToDate } sorted by spend desc.
 * Returns null when Azure is not configured or on any error.
 *
 * Results are cached for 30 minutes (same TTL as per-app cost).
 */
export type AppTagCostItem = {
  application: string;
  environment: string;
  monthToDate: number;
  wowTrend: string | null;
};

let _appTagCacheEntry: {
  result: AppTagCostItem[];
  expiresAt: number;
} | null = null;

/** Returns YYYY-MM-DD for N days ago (UTC). */
function daysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

/**
 * Normalize Azure tag values to the two canonical entities we track.
 * Anything that isn't exactly "Orbit" or "Grailbabe" (case-insensitive)
 * is bucketed as "Other" so the UI always shows a clean Orbit/Grailbabe split.
 */
function normalizeEntity(value: string): "Orbit" | "Grailbabe" | "Other" {
  const v = value.trim().toLowerCase();
  if (v === "orbit") return "Orbit";
  if (v === "grailbabe") return "Grailbabe";
  return "Other";
}

/** Extract the cost-center tag value from a tags object, case-insensitive. */
function extractCostCenterTag(tags: Record<string, unknown>): string | null {
  const lower = new Map(Object.entries(tags).map(([k, v]) => [k.toLowerCase(), v]));
  const cat = String(
    lower.get("costcenter") ??
      lower.get("cost center") ??
      lower.get("cost-category") ??
      lower.get("costcategory") ??
      lower.get("cost category") ??
      "",
  ).trim();
  return cat || null;
}

export async function fetchCostByApplicationTag({
  bypassCache = false,
}: { bypassCache?: boolean } = {}): Promise<AppTagCostItem[] | null> {
  if (!isAzureConfigured()) return null;

  if (!bypassCache && _appTagCacheEntry && _appTagCacheEntry.expiresAt > Date.now()) {
    return _appTagCacheEntry.result;
  }

  const subscriptionIds = getSubscriptionIds();
  if (subscriptionIds.length === 0) return null;

  const start = monthStart();
  const end = today();
  // Previous 7-day window for WoW: [14d ago, 7d ago]
  const prevStart = daysAgo(14);
  const prevEnd = daysAgo(8);
  // Current 7-day window: [7d ago, yesterday]
  const curStart = daysAgo(7);
  const curEnd = daysAgo(1);

  const appMap = new Map<string, number>();
  // key = application tag value
  const curWeekMap = new Map<string, number>();
  const prevWeekMap = new Map<string, number>();
  // Also track environment per application (last-seen wins)
  const envMap = new Map<string, string>();

  await Promise.all(
    subscriptionIds.map(async (subId) => {
      const scope = `/subscriptions/${subId}`;

      // Resolve tags (Application + Environment) for all resources in this sub once
      const resourceTagMap = new Map<string, { app: string; env: string }>();
      const buildTagMap = async (resourceIds: string[]) => {
        if (resourceIds.length === 0) return;
        try {
          const BATCH = 200;
          for (let i = 0; i < resourceIds.length; i += BATCH) {
            const batch = resourceIds.slice(i, i + BATCH);
            const idList = batch.map((id) => `'${id}'`).join(", ");
            const query = `resources | where tolower(id) in (${idList}) | project id, tags`;
            const graphResult = await getGraphClient().resources({ query, subscriptions: [subId] });
            const graphRows = normalizeResourceGraphRows(graphResult.data);
            for (const row of graphRows) {
              const rid = String(row["id"] ?? "").toLowerCase();
              const tags = row["tags"];
              const tagObj: Record<string, unknown> =
                tags && typeof tags === "object"
                  ? (tags as Record<string, unknown>)
                  : typeof tags === "string"
                    ? (() => {
                        try {
                          return JSON.parse(tags) as Record<string, unknown>;
                        } catch {
                          return {};
                        }
                      })()
                    : {};
              const lower = new Map(Object.entries(tagObj).map(([k, v]) => [k.toLowerCase(), v]));
              const app = String(lower.get("application") ?? "").trim();
              const env = String(lower.get("environment") ?? "").trim();
              if (app) resourceTagMap.set(rid, { app, env });
            }
          }
        } catch (err) {
          logger.warn({ err, subId }, "Resource Graph Application/Environment tag lookup failed");
        }
      };

      const queryCost = async (from: string, to: string) => {
        return getCostClient().query.usage(`/subscriptions/${subId}`, {
          type: "Usage",
          timeframe: "Custom",
          timePeriod: { from: new Date(from), to: new Date(to) },
          dataset: {
            granularity: "None",
            aggregation: { totalCost: { name: "PreTaxCost", function: "Sum" } },
            grouping: [{ type: "Dimension", name: "ResourceId" }],
          },
        });
      };

      try {
        const [mtdResult, curWeekResult, prevWeekResult] = await Promise.all([
          queryCost(start, end),
          queryCost(curStart, curEnd),
          queryCost(prevStart, prevEnd),
        ]);

        const extractRows = (r: typeof mtdResult) => {
          const cols = (r.columns ?? []).map((c: { name?: string | null }) => String(c.name ?? ""));
          const costIdx = cols.findIndex((c: string) => c.toLowerCase().includes("cost"));
          const idIdx = cols.findIndex((c: string) => c.toLowerCase().includes("resourceid"));
          return { rows: (r.rows ?? []) as unknown[][], costIdx, idIdx };
        };

        const mtd = extractRows(mtdResult);
        const cur = extractRows(curWeekResult);
        const prev = extractRows(prevWeekResult);

        // Collect all resource IDs across all three queries
        const allIds = new Set<string>();
        for (const { rows, idIdx } of [mtd, cur, prev]) {
          if (idIdx !== -1) {
            for (const r of rows) {
              const rid = String(r[idIdx] ?? "").toLowerCase();
              if (rid.startsWith("/subscriptions/")) allIds.add(rid);
            }
          }
        }
        await buildTagMap([...allIds]);

        // Accumulate MTD
        if (mtd.costIdx !== -1) {
          for (const row of mtd.rows) {
            const amount = Number(row[mtd.costIdx] ?? 0);
            const rid = mtd.idIdx !== -1 ? String(row[mtd.idIdx] ?? "").toLowerCase() : "";
            const info = resourceTagMap.get(rid);
            const app = normalizeEntity(info?.app ?? "Other");
            const env = info?.env ?? "";
            appMap.set(app, (appMap.get(app) ?? 0) + amount);
            if (env && !envMap.has(app)) envMap.set(app, env);
          }
        }

        // Accumulate current week
        if (cur.costIdx !== -1) {
          for (const row of cur.rows) {
            const amount = Number(row[cur.costIdx] ?? 0);
            const rid = cur.idIdx !== -1 ? String(row[cur.idIdx] ?? "").toLowerCase() : "";
            const app = normalizeEntity(resourceTagMap.get(rid)?.app ?? "Other");
            curWeekMap.set(app, (curWeekMap.get(app) ?? 0) + amount);
          }
        }

        // Accumulate previous week
        if (prev.costIdx !== -1) {
          for (const row of prev.rows) {
            const amount = Number(row[prev.costIdx] ?? 0);
            const rid = prev.idIdx !== -1 ? String(row[prev.idIdx] ?? "").toLowerCase() : "";
            const app = normalizeEntity(resourceTagMap.get(rid)?.app ?? "Other");
            prevWeekMap.set(app, (prevWeekMap.get(app) ?? 0) + amount);
          }
        }
      } catch (err) {
        logger.warn({ err, subId }, "Application tag cost query failed for subscription");
      }
    }),
  );

  if (appMap.size === 0) return null;

  const calcWow = (app: string): string | null => {
    const cur = curWeekMap.get(app) ?? 0;
    const prev = prevWeekMap.get(app) ?? 0;
    if (prev === 0 || cur === 0) return null;
    const pct = ((cur - prev) / prev) * 100;
    return (pct >= 0 ? "+" : "") + pct.toFixed(1) + "%";
  };

  const result: AppTagCostItem[] = [...appMap.entries()]
    .map(([application, total]) => ({
      application,
      environment: envMap.get(application) ?? "",
      monthToDate: Number(total.toFixed(2)),
      wowTrend: calcWow(application),
    }))
    .sort((a, b) => b.monthToDate - a.monthToDate);

  _appTagCacheEntry = { result, expiresAt: Date.now() + COST_CACHE_TTL_MS };
  return result;
}

/**
 * Query Azure Cost Management grouped by the `CostCategory` tag across all configured
 * subscriptions. Returns an array of { category, monthToDate } sorted by spend desc.
 * Returns null when Azure is not configured or on any error.
 *
 * Results are cached for 30 minutes (same TTL as per-app cost).
 */
let _categoryCacheEntry: {
  result: { category: string; monthToDate: number }[];
  expiresAt: number;
} | null = null;

export async function fetchCostByCostCategoryTag({
  bypassCache = false,
}: { bypassCache?: boolean } = {}): Promise<{ category: string; monthToDate: number }[] | null> {
  if (!isAzureConfigured()) return null;

  if (!bypassCache && _categoryCacheEntry && _categoryCacheEntry.expiresAt > Date.now()) {
    return _categoryCacheEntry.result;
  }

  const subscriptionIds = getSubscriptionIds();
  const billingAccountId = getBillingAccountId();

  if (subscriptionIds.length === 0 && !billingAccountId) return null;

  const start = monthStart();
  const end = today();

  // Accumulate results across all scopes.
  const catMap = new Map<string, number>();

  /** Parse rows from a Cost Management query response into the catMap. */
  function accumulateRows(
    columns: string[],
    rows: unknown[][],
    tagColumnHint: string,
    scopeLabel: string,
  ): void {
    const costIdx = columns.findIndex((c) => c.toLowerCase().includes("cost"));
    const tagIdx = columns.findIndex(
      (c) => c.toLowerCase() === tagColumnHint.toLowerCase() || c.toLowerCase() === "tag",
    );
    if (costIdx === -1) {
      logger.warn({ columns, scopeLabel }, "Cost column not found in Cost Management response");
      return;
    }
    for (const row of rows) {
      const amount = Number(row[costIdx] ?? 0);
      const raw = tagIdx !== -1 ? String(row[tagIdx] ?? "Other") || "Other" : "Other";
      const cat = normalizeEntity(raw);
      catMap.set(cat, (catMap.get(cat) ?? 0) + amount);
    }
  }

  // --- Subscription scope: two-step resource-level attribution ---
  // Step A: query cost grouped by ResourceId from Cost Management.
  // Step B: look up each ResourceId's CostCategory tag from Resource Graph.
  // This gives per-resource accuracy rather than per-RG approximation.
  await Promise.all(
    subscriptionIds.map(async (subId) => {
      const scope = `/subscriptions/${subId}`;
      try {
        // Step A: cost grouped by ResourceId
        const result = await getCostClient().query.usage(scope, {
          type: "Usage",
          timeframe: "Custom",
          timePeriod: { from: new Date(start), to: new Date(end) },
          dataset: {
            granularity: "None",
            aggregation: { totalCost: { name: "PreTaxCost", function: "Sum" } },
            grouping: [{ type: "Dimension", name: "ResourceId" }],
          },
        });
        const columns = (result.columns ?? []).map((c: { name?: string | null }) =>
          String(c.name ?? ""),
        );
        const rows = (result.rows ?? []) as unknown[][];
        const costIdx = columns.findIndex((c: string) => c.toLowerCase().includes("cost"));
        const idIdx = columns.findIndex(
          (c: string) => c.toLowerCase() === "resourceid" || c.toLowerCase().includes("resourceid"),
        );
        logger.info(
          { subId, columns, rowCount: rows.length, firstRow: rows[0] ?? null },
          "CostCategory by-ResourceId query result",
        );
        if (costIdx === -1 || rows.length === 0) return;

        // Step B: fetch CostCategory tag for all resource IDs from Resource Graph
        // Resource Graph uses lowercase IDs; Cost Management may use mixed case.
        const resourceIds = [
          ...new Set(
            rows
              .map((r) => String(r[idIdx] ?? "").toLowerCase())
              .filter((id) => id.startsWith("/subscriptions/")),
          ),
        ];

        const resourceTagMap = new Map<string, string>(); // resourceId.toLowerCase() → CostCategory
        // Build a resource group → CostCenter tag map so resources without a
        // resource-level tag can inherit from their resource group.
        const rgTagMap = new Map<string, string>();
        try {
          const rgQuery = `
            resourcecontainers
            | where type == 'microsoft.resources/subscriptions/resourcegroups'
            | project name=tolower(name), tags
          `;
          const rgResult = await getGraphClient().resources({
            query: rgQuery,
            subscriptions: [subId],
          });
          const rgRows = normalizeResourceGraphRows(rgResult.data);
          for (const row of rgRows) {
            const rgName = String(row["name"] ?? "").toLowerCase();
            const tags = row["tags"];
            const tagObj: Record<string, unknown> =
              tags && typeof tags === "object"
                ? (tags as Record<string, unknown>)
                : typeof tags === "string"
                  ? (() => {
                      try {
                        return JSON.parse(tags) as Record<string, unknown>;
                      } catch {
                        return {};
                      }
                    })()
                  : {};
            const cat = extractCostCenterTag(tagObj);
            if (cat) rgTagMap.set(rgName, cat);
          }
          logger.info(
            { subId, taggedGroups: rgTagMap.size },
            "Resource group CostCenter tag map built",
          );
        } catch (err) {
          logger.warn({ err, subId }, "Resource group CostCenter tag lookup failed");
        }

        if (resourceIds.length > 0) {
          try {
            // Resource Graph supports up to 1000 results; batch if needed
            const BATCH = 200;
            for (let i = 0; i < resourceIds.length; i += BATCH) {
              const batch = resourceIds.slice(i, i + BATCH);
              const idList = batch.map((id) => `'${id}'`).join(", ");
              const query = `
                resources
                | where tolower(id) in (${idList})
                | project id, resourceGroup, tags
              `;
              const graphResult = await getGraphClient().resources({
                query,
                subscriptions: [subId],
              });
              const graphRows = normalizeResourceGraphRows(graphResult.data);
              for (const row of graphRows) {
                const rid = String(row["id"] ?? "").toLowerCase();
                const tags = row["tags"];
                const tagObj: Record<string, unknown> =
                  tags && typeof tags === "object"
                    ? (tags as Record<string, unknown>)
                    : typeof tags === "string"
                      ? (() => {
                          try {
                            return JSON.parse(tags) as Record<string, unknown>;
                          } catch {
                            return {};
                          }
                        })()
                      : {};
                const cat = extractCostCenterTag(tagObj);
                if (cat) {
                  resourceTagMap.set(rid, cat);
                } else {
                  // Inherit from resource group tag if present.
                  const rgName = String(row["resourceGroup"] ?? "").toLowerCase();
                  const rgCat = rgTagMap.get(rgName);
                  if (rgCat) resourceTagMap.set(rid, rgCat);
                }
              }
            }
            logger.info(
              { subId, taggedCount: resourceTagMap.size, totalResources: resourceIds.length },
              "Resource→CostCenter tag map built",
            );
          } catch (err) {
            logger.warn(
              { err, subId },
              "Resource Graph tag lookup failed — costs will be Untagged",
            );
          }
        }

        // Step C: accumulate costs using resource tag, fall back to Other
        const subCategories = new Set<string>();
        for (const row of rows) {
          const amount = Number(row[costIdx] ?? 0);
          const rid = idIdx !== -1 ? String(row[idIdx] ?? "").toLowerCase() : "";
          const raw = resourceTagMap.get(rid);
          const cat = normalizeEntity(raw ?? "Other");
          if (raw) subCategories.add(cat);
          catMap.set(cat, (catMap.get(cat) ?? 0) + amount);
        }
        logger.info({ subId, categories: [...subCategories] }, "CostCenter aggregation complete");
      } catch (err) {
        logger.warn({ err, subId }, "CostCategory by-ResourceId query failed for subscription");
      }
    }),
  );

  // --- MCA Billing Account scope: captures M365 / non-Azure charges ---
  // Groups by ProductName since M365 products aren't ARM resources and can't
  // carry resource tags. We map known M365 product names to CostCategory values.
  if (billingAccountId) {
    const billingScope = `/providers/Microsoft.Billing/billingAccounts/${billingAccountId}`;
    try {
      const result = await getCostClient().query.usage(billingScope, {
        type: "Usage",
        timeframe: "Custom",
        timePeriod: { from: new Date(start), to: new Date(end) },
        dataset: {
          granularity: "None",
          aggregation: { totalCost: { name: "PreTaxCost", function: "Sum" } },
          grouping: [{ type: "Dimension", name: "ProductName" }],
        },
      });
      const columns: string[] = (result.columns ?? []).map((c: { name?: string | null }) =>
        String(c.name ?? ""),
      );
      const rows = (result.rows ?? []) as unknown[][];
      const costIdx = columns.findIndex((c: string) => c.toLowerCase().includes("cost"));
      const nameIdx = columns.findIndex(
        (c: string) => c.toLowerCase().includes("product") || c.toLowerCase() === "productname",
      );
      if (costIdx !== -1) {
        for (const row of rows) {
          const amount = Number(row[costIdx] ?? 0);
          const productName = nameIdx !== -1 ? String(row[nameIdx] ?? "") : "";
          // Map M365 product names to Orbit/Grailbabe/Other — skip charges already
          // captured via the subscription-scope query to avoid double-counting.
          const mapped = m365ProductToCostCenter(productName);
          if (mapped) {
            catMap.set(mapped, (catMap.get(mapped) ?? 0) + amount);
          }
        }
      }
    } catch (err) {
      logger.warn({ err, billingAccountId }, "Billing account cost query failed");
    }
  }

  if (catMap.size === 0) return null;

  const result = [...catMap.entries()]
    .map(([category, total]) => ({ category, monthToDate: Number(total.toFixed(2)) }))
    .sort((a, b) => b.monthToDate - a.monthToDate);

  _categoryCacheEntry = { result, expiresAt: Date.now() + COST_CACHE_TTL_MS };
  return result;
}

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
