import { ConsumptionManagementClient } from "@azure/arm-consumption";
import { CostManagementClient } from "@azure/arm-costmanagement";
import { eq } from "drizzle-orm";
import { db, budgetSnapshotsTable } from "@workspace/db";
import { getAzureCredential, isAzureConfigured } from "./azure.js";
import { resolveSubscriptionId } from "./azureCost.js";
import type { AppRecord } from "../routes/orbit.js";
import { logger } from "./logger.js";

export type BudgetResult = {
  /** Configured monthly budget cap, USD. */
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
        if (typeof budget.amount === "number" && budget.amount > 0) {
          budgetAmount = budget.amount;
          if (typeof budget.forecastSpend?.amount === "number") {
            forecastFromBudget = budget.forecastSpend.amount;
          }
        }
      } catch {
        // Budget not found or API error — fall through to list-scan below
      }
    }

    if (budgetAmount === null) {
      // 1. Try RG-scope budgets (most specific)
      for await (const budget of consumptionClient.budgets.list(rgScope)) {
        if (typeof budget.amount === "number" && budget.amount > 0) {
          budgetAmount = budget.amount;
          if (typeof budget.forecastSpend?.amount === "number") {
            forecastFromBudget = budget.forecastSpend.amount;
          }
          break;
        }
      }
    }

    // 2. Fall back to subscription-scope budgets
    if (budgetAmount === null) {
      for await (const budget of consumptionClient.budgets.list(subScope)) {
        if (typeof budget.amount === "number" && budget.amount > 0) {
          budgetAmount = budget.amount;
          if (typeof budget.forecastSpend?.amount === "number") {
            forecastFromBudget = budget.forecastSpend.amount;
          }
          break;
        }
      }
    }
  } catch {
    return null;
  }

  if (budgetAmount === null) return null;

  // 3. Get forecast from Cost Management Forecast API if budget didn't include it
  let forecastAmount: number | null = forecastFromBudget;
  if (forecastAmount === null) {
    try {
      const forecastResult = await getCostClient().forecast.usage(rgScope, {
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
    } catch {
      // Forecast API unavailable — leave as null, caller uses formula
    }
  }

  const result: BudgetResult = {
    amount: Number(budgetAmount.toFixed(2)),
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
