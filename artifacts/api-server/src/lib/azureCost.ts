import { CostManagementClient } from "@azure/arm-costmanagement";
import { ResourceGraphClient } from "@azure/arm-resourcegraph";
import { getAzureCredential, getSubscriptionIds, isAzureConfigured } from "./azure.js";
import type { AppRecord } from "../routes/orbit.js";

export type CostByService = { service: string; amount: number };

export type CostResult = {
  monthToDate: number;
  byService: CostByService[];
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

/** A UUID-shaped GUID (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx). */
function isGuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

// Cache: RG name (lowercase) → subscriptionId
const _rgSubCache = new Map<string, string>();

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
async function resolveSubscriptionId(app: AppRecord): Promise<string | null> {
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
    const rows = (result.data as Record<string, unknown>[]) ?? [];
    const subId = rows[0]?.["subscriptionId"] as string | undefined;
    if (subId && isGuid(subId)) {
      _rgSubCache.set(rgKey, subId);
      return subId;
    }
  } catch {
    // fall through
  }

  // Last resort: use the first configured subscription (same-sub deployments).
  return subscriptionIds[0] ?? null;
}

/**
 * Fetch month-to-date cost for the app's resource group from Cost Management.
 * Groups by ServiceName so we can surface a service breakdown.
 * Returns null when not configured or on any error (caller falls back to mock).
 */
export async function fetchMonthToDateCost(
  app: AppRecord,
): Promise<CostResult | null> {
  if (!isAzureConfigured()) return null;

  const subscriptionId = await resolveSubscriptionId(app);
  if (!subscriptionId) return null;

  const scope = `/subscriptions/${subscriptionId}/resourceGroups/${app.resourceGroup}`;

  try {
    const result = await getCostClient().query.usage(scope, {
      type: "Usage",
      timeframe: "Custom",
      timePeriod: { from: new Date(monthStart()), to: new Date(today()) },
      dataset: {
        granularity: "None",
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

    const costIdx = columns.findIndex((c) =>
      c.toLowerCase().includes("cost"),
    );
    const svcIdx = columns.findIndex((c) =>
      c.toLowerCase().includes("service"),
    );

    if (costIdx === -1) return null;

    let total = 0;
    const byService: CostByService[] = [];

    for (const row of rows) {
      const amount = Number(row[costIdx] ?? 0);
      const service =
        svcIdx !== -1 ? String(row[svcIdx] ?? "Other") : "Other";
      total += amount;
      byService.push({ service, amount: Number(amount.toFixed(2)) });
    }

    byService.sort((a, b) => b.amount - a.amount);

    return { monthToDate: Number(total.toFixed(2)), byService };
  } catch {
    return null;
  }
}
