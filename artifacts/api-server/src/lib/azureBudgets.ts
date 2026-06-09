import { ConsumptionManagementClient } from "@azure/arm-consumption";
import { CostManagementClient } from "@azure/arm-costmanagement";
import { eq } from "drizzle-orm";
import { db, budgetSnapshotsTable } from "@workspace/db";
import { getAzureCredential, isAzureConfigured } from "./azure.js";
import { resolveSubscriptionId } from "./azureCost.js";
import type { AppRecord } from "../routes/orbit.js";
import { logger } from "./logger.js";

export type BudgetResult = {
  /** True when a real Azure budget was found. False = forecast-only (no budget defined). */
  hasBudget: boolean;
  /** Configured monthly budget cap, USD. Zero when hasBudget is false. */
  amount: number;
  /** Projected end-of-month spend, USD. Null if Azure couldn't compute it. */
  forecastAmount: number | null;
};

export type BudgetSource = "live" | "cached" | "estimated";

export type BudgetWithSource = {
  result: BudgetResult;
  source: BudgetSource;
};

// Cache: appId → { result, expiresAt }
const BUDGET_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour — budgets are manually set and rarely change
type BudgetCacheEntry = { result: BudgetResult; expiresAt: number };
export const _budgetCache = new Map<string, BudgetCacheEntry>();

// Cache of ConsumptionManagementClient per subscriptionId
const _consumptionClients = new Map<string, ConsumptionManagementClient>();
let _costClient: CostManagementClient | null = null;

/** Read the MCA billing account ID from env — set AZURE_BILLING_ACCOUNT_ID to enable billing-scope budget lookups. */
function getBillingAccountId(): string | null {
  return process.env.AZURE_BILLING_ACCOUNT_ID?.trim() || null;
}

/** Minimal shape of a budget resource returned by the ARM Consumption API. */
interface ArmBudget {
  id: string;
  name: string;
  properties: {
    amount?: number;
    currentSpend?: { amount?: number };
    forecastSpend?: { amount?: number };
    filter?: unknown;
  };
}

/**
 * Fetch all budgets at an MCA billing account scope via the ARM REST API.
 * The arm-consumption SDK only queries subscription scope; this REST path is
 * needed for budgets created under a billing account / billing profile.
 */
async function listBudgetsAtBillingScope(billingAccountId: string): Promise<ArmBudget[]> {
  const tokenResponse = await getAzureCredential().getToken("https://management.azure.com/.default");
  if (!tokenResponse) throw new Error("getToken returned null — credential not available");
  const scope = `providers/Microsoft.Billing/billingAccounts/${billingAccountId}`;
  const url = `https://management.azure.com/${scope}/providers/Microsoft.Consumption/budgets?api-version=2021-10-01`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${tokenResponse.token}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status}: ${text.slice(0, 300)}`);
  }
  const data = (await res.json()) as { value?: ArmBudget[] };
  return data.value ?? [];
}

/**
 * Returns true if an ARM budget applies to the given subscription.
 * Budgets with no SubscriptionId filter in their conditions apply broadly.
 */
function budgetMatchesSubscription(budget: ArmBudget, subscriptionId: string): boolean {
  const filter = budget.properties.filter as Record<string, unknown> | undefined;
  if (!filter) return true;

  const conditions: unknown[] = Array.isArray(filter["and"])
    ? (filter["and"] as unknown[])
    : [filter];

  for (const cond of conditions) {
    const c = cond as Record<string, unknown>;
    const dims = c["dimensions"] as { name?: string; values?: string[] } | undefined;
    if (dims?.name === "SubscriptionId" && Array.isArray(dims.values)) {
      return dims.values.some((v) => v.toLowerCase() === subscriptionId.toLowerCase());
    }
  }
  return true; // no subscription dimension filter → applies to all
}

function getConsumptionClient(subscriptionId: string): ConsumptionManagementClient {
  let client = _consumptionClients.get(subscriptionId);
  if (!client) {
    client = new ConsumptionManagementClient(getAzureCredential(), subscriptionId);
    _consumptionClients.set(subscriptionId, client);
  }
  return client;
}

function getCostClient(): CostManagementClient {
  if (!_costClient) {
    _costClient = new CostManagementClient(getAzureCredential());
  }
  return _costClient;
}

/** First day of the current UTC month as a Date. */
function monthStartDate(): Date {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

/** Last day of the current UTC month as a Date. */
function monthEndDate(): Date {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
}

/** Evict all cached budget entries. */
export function clearBudgetCache(): void {
  _budgetCache.clear();
}

/** Evict the cached budget entry for a single app. */
export function clearBudgetCacheForApp(appId: string): void {
  _budgetCache.delete(appId);
}

/**
 * Fetch the Azure Budget configured for this app's resource group.
 *
 * Strategy:
 *   1. Try RG-scope budgets first (most specific).
 *   2. Fall back to subscription-scope budgets.
 *   3. For forecast, use the budget's forecastSpend.amount if populated.
 *      Otherwise call the Cost Management Forecast API.
 *
 * Returns null when unconfigured or on any error — caller falls back to formulas.
 */
export async function fetchBudgetForApp(
  app: AppRecord,
  { bypassCache = false, budgetScope = "rg" }: { bypassCache?: boolean; budgetScope?: "subscription" | "rg" } = {},
): Promise<BudgetResult | null> {
  // Evict before the configuration gate so a force-refresh always clears the
  // stale entry, even when Azure is temporarily unconfigured.
  if (bypassCache) {
    _budgetCache.delete(app.id);
  }

  if (!isAzureConfigured()) return null;

  if (!bypassCache) {
    const entry = _budgetCache.get(app.id);
    if (entry && entry.expiresAt > Date.now()) return entry.result;
  }

  const subscriptionId = await resolveSubscriptionId(app);
  if (!subscriptionId) return null;

  const rgScope = `/subscriptions/${subscriptionId}/resourceGroups/${app.resourceGroup}`;
  const subScope = `/subscriptions/${subscriptionId}`;

  let budgetAmount: number | null = null;
  let forecastFromBudget: number | null = null;

  try {
    const consumptionClient = getConsumptionClient(subscriptionId);

    if (app.budgetName) {
      // Named budget: fetch directly by name. Scope determined by the budgetScope
      // parameter passed by the caller (avoids a circular import back to orbit.ts).
      const scope = budgetScope === "subscription" ? subScope : rgScope;
      try {
        const budget = await consumptionClient.budgets.get(scope, app.budgetName);
        logger.debug({ appId: app.id, scope, budgetName: app.budgetName, amount: budget.amount }, "budget named-get succeeded");
        if (typeof budget.amount === "number" && budget.amount > 0) {
          budgetAmount = budget.amount;
          if (typeof budget.forecastSpend?.amount === "number") {
            forecastFromBudget = budget.forecastSpend.amount;
          }
        }
      } catch (err) {
        logger.warn({ err, appId: app.id, scope, budgetName: app.budgetName }, "budget named-get failed — falling through to list-scan");
      }
    }

    if (budgetAmount === null) {
      // 1. Try RG-scope budgets (most specific)
      try {
        for await (const budget of consumptionClient.budgets.list(rgScope)) {
          if (typeof budget.amount === "number" && budget.amount > 0) {
            budgetAmount = budget.amount;
            if (typeof budget.forecastSpend?.amount === "number") {
              forecastFromBudget = budget.forecastSpend.amount;
            }
            break;
          }
        }
      } catch (err) {
        logger.warn({ err, appId: app.id, rgScope }, "budget RG-scope list failed");
      }
    }

    // 2. Fall back to subscription-scope budgets
    if (budgetAmount === null) {
      try {
        for await (const budget of consumptionClient.budgets.list(subScope)) {
          if (typeof budget.amount === "number" && budget.amount > 0) {
            budgetAmount = budget.amount;
            if (typeof budget.forecastSpend?.amount === "number") {
              forecastFromBudget = budget.forecastSpend.amount;
            }
            break;
          }
        }
      } catch (err) {
        logger.warn({ err, appId: app.id, subScope }, "budget sub-scope list failed");
      }
    }

    // 3. Try MCA billing account scope — budgets created via Cost Management at
    //    billing account level don't appear at subscription scope via arm-consumption.
    //    Requires AZURE_BILLING_ACCOUNT_ID env var + Billing Account Reader RBAC on
    //    the managed identity.
    if (budgetAmount === null) {
      const billingAccountId = getBillingAccountId();
      if (billingAccountId) {
        try {
          const allBudgets = await listBudgetsAtBillingScope(billingAccountId);
          for (const budget of allBudgets) {
            if (!budgetMatchesSubscription(budget, subscriptionId)) continue;
            if (app.budgetName && budget.name !== app.budgetName) continue;
            const amount = budget.properties.amount;
            if (typeof amount === "number" && amount > 0) {
              budgetAmount = amount;
              const forecastAmt = budget.properties.forecastSpend?.amount;
              if (typeof forecastAmt === "number") {
                forecastFromBudget = forecastAmt;
              }
              logger.debug({ appId: app.id, billingAccountId, budgetName: budget.name, amount }, "billing-scope budget found");
              break;
            }
          }
          if (budgetAmount === null) {
            logger.debug({ appId: app.id, billingAccountId, subscriptionId }, "billing-scope list returned no matching budget");
          }
        } catch (err) {
          logger.warn({ err, appId: app.id, billingAccountId }, "billing-scope budget list failed");
        }
      }
    }

    if (budgetAmount === null) {
      logger.warn({ appId: app.id, subscriptionId, budgetName: app.budgetName, rgScope, subScope }, "no budget found after all lookup strategies");
    }
  } catch (err) {
    logger.warn({ err, appId: app.id, subscriptionId }, "budget fetch outer error");
    return null;
  }

  // 3. Get forecast from Cost Management Forecast API.
  // Run unconditionally — we want forecast even when no budget is defined.
  const forecastScope = budgetScope === "subscription" ? subScope : rgScope;
  let forecastAmount: number | null = forecastFromBudget;
  if (forecastAmount === null) {
    try {
      const forecastResult = await getCostClient().forecast.usage(forecastScope, {
        type: "ActualCost",
        timeframe: "Custom",
        timePeriod: { from: monthStartDate(), to: monthEndDate() },
        dataset: {
          granularity: "Monthly",
          aggregation: {
            totalCost: { name: "PreTaxCost", function: "Sum" },
          },
        },
        includeActualCost: false,
        includeFreshPartialCost: false,
      });

      const cols: string[] = (forecastResult.columns ?? []).map((c) => String(c.name ?? ""));
      const costIdx = cols.findIndex((c) => c.toLowerCase().includes("cost"));
      const rows = (forecastResult.rows ?? []) as unknown[][];
      if (costIdx !== -1 && rows.length > 0) {
        let total = 0;
        for (const row of rows) total += Number(row[costIdx] ?? 0);
        forecastAmount = Number(total.toFixed(2));
      }
    } catch (err) {
      logger.warn({ err, appId: app.id, forecastScope }, "budget forecast API failed — will use null forecast");
    }
  }

  // When no budget is defined but forecast is available, return a forecast-only result.
  // hasBudget: false signals to callers that amount = 0 is a sentinel (not a real $0 budget).
  if (budgetAmount === null && forecastAmount === null) {
    logger.warn({ appId: app.id }, "no budget and no forecast available — returning null");
    return null;
  }

  const hasBudget = budgetAmount !== null;
  if (hasBudget) {
    logger.info({ appId: app.id, subscriptionId, budgetAmount, forecastAmount }, "budget fetch succeeded");
  } else {
    logger.info({ appId: app.id, subscriptionId, forecastAmount }, "no budget defined; forecast-only result");
  }

  const result: BudgetResult = {
    hasBudget,
    amount: hasBudget ? Number(budgetAmount!.toFixed(2)) : 0,
    forecastAmount: forecastAmount !== null ? Number(forecastAmount.toFixed(2)) : null,
  };

  _budgetCache.set(app.id, { result, expiresAt: Date.now() + BUDGET_CACHE_TTL_MS });
  return result;
}

/**
 * Persist a successfully-fetched budget snapshot to the database.
 * Write failures are non-fatal — the live result is already in hand.
 */
async function writeBudgetSnapshot(appId: string, result: BudgetResult): Promise<void> {
  // Only persist real budget snapshots — forecast-only results (hasBudget: false)
  // are not worth caching since budget=0 in the DB would be indistinguishable from
  // a real $0 budget cap.
  if (!result.hasBudget) return;
  try {
    const now = new Date();
    await db
      .insert(budgetSnapshotsTable)
      .values({
        appId,
        amount: result.amount.toFixed(2),
        forecastAmount: result.forecastAmount !== null ? result.forecastAmount.toFixed(2) : null,
        fetchedAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: budgetSnapshotsTable.appId,
        set: {
          amount: result.amount.toFixed(2),
          forecastAmount: result.forecastAmount !== null ? result.forecastAmount.toFixed(2) : null,
          fetchedAt: now,
          updatedAt: now,
        },
      });
  } catch (err) {
    logger.warn({ err, appId }, "budget snapshot write failed (non-fatal)");
  }
}

/**
 * Read the last persisted budget snapshot for an app from the database.
 * Returns null if no snapshot exists or the DB is unavailable.
 */
async function readBudgetSnapshot(appId: string): Promise<BudgetResult | null> {
  try {
    const row = await db.query.budgetSnapshotsTable.findFirst({
      where: eq(budgetSnapshotsTable.appId, appId),
    });
    if (!row) return null;
    return {
      hasBudget: true, // only real budget snapshots are persisted
      amount: Number(row.amount),
      forecastAmount: row.forecastAmount !== null ? Number(row.forecastAmount) : null,
    };
  } catch (err) {
    logger.warn({ err, appId }, "budget snapshot read failed (non-fatal)");
    return null;
  }
}

/**
 * Fetch the budget for an app with a three-tier fallback strategy:
 *
 *   1. **live**      — Azure Budgets API succeeded; result is written through to DB.
 *   2. **cached**    — Azure unavailable; last-known value from the DB snapshot is used.
 *   3. (returns null) — No DB snapshot; caller should apply formula estimates and report
 *                       budgetDataSource = "estimated".
 *
 * Use this in routes that need to surface the budget data source to the client.
 */
export async function fetchBudgetForAppWithFallback(
  app: AppRecord,
  opts: { bypassCache?: boolean; budgetScope?: "subscription" | "rg" } = {},
): Promise<BudgetWithSource | null> {
  const live = await fetchBudgetForApp(app, opts);

  if (live !== null) {
    await writeBudgetSnapshot(app.id, live);
    return { result: live, source: "live" };
  }

  const snapshot = await readBudgetSnapshot(app.id);
  if (snapshot !== null) {
    return { result: snapshot, source: "cached" };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Diagnostics — returns a structured probe of every budget API strategy for
// an app, surfacing raw errors so callers can identify RBAC / naming issues.
// ---------------------------------------------------------------------------
export type BudgetDiagnosticEntry = {
  strategy: string;
  scope: string;
  budgetName?: string;
  outcome: "found" | "not_found" | "error";
  amount?: number;
  forecastAmount?: number | null;
  error?: string;
};

export async function diagnoseBudgetsForApp(
  app: AppRecord,
  budgetScope: "subscription" | "rg" = "rg",
): Promise<{ appId: string; subscriptionId: string | null; entries: BudgetDiagnosticEntry[] }> {
  const entries: BudgetDiagnosticEntry[] = [];

  if (!isAzureConfigured()) {
    return { appId: app.id, subscriptionId: null, entries: [{ strategy: "pre-check", scope: "n/a", outcome: "error", error: "isAzureConfigured() = false" }] };
  }

  const subscriptionId = await resolveSubscriptionId(app);
  if (!subscriptionId) {
    return { appId: app.id, subscriptionId: null, entries: [{ strategy: "resolveSubscriptionId", scope: "n/a", outcome: "error", error: "resolveSubscriptionId returned null — check AZURE_SUB_* env vars and Resource Graph RBAC" }] };
  }

  const rgScope = `/subscriptions/${subscriptionId}/resourceGroups/${app.resourceGroup}`;
  const subScope = `/subscriptions/${subscriptionId}`;
  const client = getConsumptionClient(subscriptionId);

  // 1. Named get
  if (app.budgetName) {
    const namedScope = budgetScope === "subscription" ? subScope : rgScope;
    try {
      const b = await client.budgets.get(namedScope, app.budgetName);
      entries.push({ strategy: "named-get", scope: namedScope, budgetName: app.budgetName, outcome: "found", amount: b.amount ?? undefined, forecastAmount: b.forecastSpend?.amount ?? null });
    } catch (err: unknown) {
      const e = err as { message?: string; code?: string; statusCode?: number };
      entries.push({ strategy: "named-get", scope: namedScope, budgetName: app.budgetName, outcome: "error", error: `${e.code ?? e.statusCode ?? "?"}: ${e.message ?? String(err)}` });
    }
  }

  // 2. RG-scope list
  try {
    const found: BudgetDiagnosticEntry[] = [];
    for await (const b of client.budgets.list(rgScope)) {
      found.push({ strategy: "rg-list", scope: rgScope, budgetName: b.name ?? undefined, outcome: "found", amount: b.amount ?? undefined, forecastAmount: b.forecastSpend?.amount ?? null });
    }
    if (found.length === 0) entries.push({ strategy: "rg-list", scope: rgScope, outcome: "not_found", error: "empty list" });
    else entries.push(...found);
  } catch (err: unknown) {
    const e = err as { message?: string; code?: string; statusCode?: number };
    entries.push({ strategy: "rg-list", scope: rgScope, outcome: "error", error: `${e.code ?? e.statusCode ?? "?"}: ${e.message ?? String(err)}` });
  }

  // 3. Sub-scope list
  try {
    const found: BudgetDiagnosticEntry[] = [];
    for await (const b of client.budgets.list(subScope)) {
      found.push({ strategy: "sub-list", scope: subScope, budgetName: b.name ?? undefined, outcome: "found", amount: b.amount ?? undefined, forecastAmount: b.forecastSpend?.amount ?? null });
    }
    if (found.length === 0) entries.push({ strategy: "sub-list", scope: subScope, outcome: "not_found", error: "empty list" });
    else entries.push(...found);
  } catch (err: unknown) {
    const e = err as { message?: string; code?: string; statusCode?: number };
    entries.push({ strategy: "sub-list", scope: subScope, outcome: "error", error: `${e.code ?? e.statusCode ?? "?"}: ${e.message ?? String(err)}` });
  }

  // 4. Billing account scope (MCA) — direct ARM REST API call
  const billingAccountId = getBillingAccountId();
  if (billingAccountId) {
    try {
      const allBudgets = await listBudgetsAtBillingScope(billingAccountId);
      const matching = allBudgets.filter((b) => budgetMatchesSubscription(b, subscriptionId));
      if (matching.length === 0) {
        entries.push({ strategy: "billing-scope-list", scope: `billingAccounts/${billingAccountId}`, outcome: "not_found", error: `empty list (${allBudgets.length} total budgets, 0 match subscriptionId ${subscriptionId})` });
      } else {
        for (const b of matching) {
          entries.push({
            strategy: "billing-scope-list",
            scope: `billingAccounts/${billingAccountId}`,
            budgetName: b.name,
            outcome: "found",
            amount: b.properties.amount ?? undefined,
            forecastAmount: b.properties.forecastSpend?.amount ?? null,
          });
        }
      }
    } catch (err: unknown) {
      const e = err as { message?: string; code?: string; statusCode?: number };
      entries.push({ strategy: "billing-scope-list", scope: `billingAccounts/${billingAccountId}`, outcome: "error", error: `${e.code ?? e.statusCode ?? "?"}: ${e.message ?? String(err)}` });
    }
  } else {
    entries.push({ strategy: "billing-scope-list", scope: "n/a", outcome: "error", error: "AZURE_BILLING_ACCOUNT_ID not set — skipped" });
  }

  // 5. Forecast probe (independent of budget lookup)
  try {
    const forecastScope = budgetScope === "subscription" ? subScope : rgScope;
    const forecastResult = await getCostClient().forecast.usage(forecastScope, {
      type: "ActualCost",
      timeframe: "Custom",
      timePeriod: { from: monthStartDate(), to: monthEndDate() },
      dataset: { granularity: "Monthly", aggregation: { totalCost: { name: "PreTaxCost", function: "Sum" } } },
      includeActualCost: false,
      includeFreshPartialCost: false,
    });
    const cols: string[] = (forecastResult.columns ?? []).map((c) => String(c.name ?? ""));
    const costIdx = cols.findIndex((c) => c.toLowerCase().includes("cost"));
    const rows = (forecastResult.rows ?? []) as unknown[][];
    let total = 0;
    if (costIdx !== -1) for (const row of rows) total += Number(row[costIdx] ?? 0);
    entries.push({ strategy: "forecast-api", scope: forecastScope, outcome: "found", forecastAmount: Number(total.toFixed(2)) });
  } catch (err: unknown) {
    const e = err as { message?: string; code?: string; statusCode?: number };
    entries.push({ strategy: "forecast-api", scope: subScope, outcome: "error", error: `${e.code ?? e.statusCode ?? "?"}: ${e.message ?? String(err)}` });
  }

  return { appId: app.id, subscriptionId, entries };
}
