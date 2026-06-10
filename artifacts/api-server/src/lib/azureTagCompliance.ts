import { ResourceGraphClient } from "@azure/arm-resourcegraph";
import { getAzureCredential, getSubscriptionIds, isAzureConfigured } from "./azure.js";
import { normalizeResourceGraphRows } from "./azureNetwork.js";
import { logger } from "./logger.js";

/**
 * Azure tag compliance — scan subscriptions, resource groups, and individual
 * resources across all monitored subscriptions and report which of the five
 * required Kinisis tag keys are absent.
 *
 * Required tags: workload, environment, owner, cost-center, criticality.
 * Cache: 15 minutes in-process.
 * Config-gated: returns unavailable sentinel when AZURE_SUBSCRIPTION_IDS is not set.
 */

export const REQUIRED_TAGS = [
  "workload",
  "environment",
  "owner",
  "cost-center",
  "criticality",
] as const;

export type TagComplianceEntry = {
  id: string;
  name: string;
  type: string;
  scope: "subscription" | "resource-group" | "resource";
  subscriptionId: string;
  resourceGroup?: string;
  missingTags: string[];
};

export type TagComplianceResult = {
  scannedAt: string;
  totalScanned: number;
  nonCompliantCount: number;
  entries: TagComplianceEntry[];
  dataSource: "live" | "unavailable" | "error";
  errorMessage?: string;
};

const CACHE_TTL_MS = 15 * 60 * 1000;
type CacheEntry = { data: TagComplianceResult; fetchedAt: number };
let _cache: CacheEntry | null = null;
let _client: ResourceGraphClient | null = null;

function getClient(): ResourceGraphClient {
  if (!_client) {
    _client = new ResourceGraphClient(getAzureCredential());
  }
  return _client;
}

function missingTagsFor(tags: Record<string, unknown> | null | undefined): string[] {
  if (!tags) return [...REQUIRED_TAGS];
  return REQUIRED_TAGS.filter((t) => {
    const v = tags[t];
    return v === undefined || v === null || String(v).trim() === "";
  });
}

function scopeOf(type: string): TagComplianceEntry["scope"] {
  const t = type.toLowerCase();
  if (t === "microsoft.resources/subscriptions") return "subscription";
  if (t === "microsoft.resources/subscriptions/resourcegroups") return "resource-group";
  return "resource";
}

const UNAVAILABLE: TagComplianceResult = {
  scannedAt: new Date(0).toISOString(),
  totalScanned: 0,
  nonCompliantCount: 0,
  entries: [],
  dataSource: "unavailable",
};

export async function fetchTagCompliance(): Promise<TagComplianceResult> {
  if (!isAzureConfigured()) return UNAVAILABLE;

  if (_cache && Date.now() - _cache.fetchedAt < CACHE_TTL_MS) {
    return _cache.data;
  }

  const subscriptionIds = getSubscriptionIds();
  if (subscriptionIds.length === 0) return UNAVAILABLE;

  try {
    const client = getClient();

    // Single union query across the three scope levels.
    // resourcecontainers covers subscriptions + resource groups;
    // resources covers all deployed resources within those.
    const query = `
      union
        (resourcecontainers
          | where type =~ 'microsoft.resources/subscriptions'
          | project id, name, type, subscriptionId, resourceGroup='', tags),
        (resourcecontainers
          | where type =~ 'microsoft.resources/subscriptions/resourcegroups'
          | project id, name, type, subscriptionId, resourceGroup=name, tags),
        (resources
          | project id, name, type, subscriptionId, resourceGroup, tags)
      | project id, name, type, subscriptionId, resourceGroup, tags
      | limit 500
    `;

    const result = await client.resources({ query, subscriptions: subscriptionIds });
    const rows = normalizeResourceGraphRows(result.data);

    let totalScanned = 0;
    const entries: TagComplianceEntry[] = [];

    for (const row of rows) {
      totalScanned++;
      const tags = (row["tags"] as Record<string, unknown> | null) ?? null;
      const missing = missingTagsFor(tags);
      if (missing.length === 0) continue;

      const type = String(row["type"] ?? "");
      const rg = row["resourceGroup"] ? String(row["resourceGroup"]) : undefined;
      entries.push({
        id: String(row["id"] ?? ""),
        name: String(row["name"] ?? ""),
        type,
        scope: scopeOf(type),
        subscriptionId: String(row["subscriptionId"] ?? ""),
        ...(rg ? { resourceGroup: rg } : {}),
        missingTags: missing,
      });
    }

    const data: TagComplianceResult = {
      scannedAt: new Date().toISOString(),
      totalScanned,
      nonCompliantCount: entries.length,
      entries,
      dataSource: "live",
    };

    _cache = { data, fetchedAt: Date.now() };
    logger.info(
      { totalScanned, nonCompliantCount: entries.length },
      "fetchTagCompliance complete",
    );
    return data;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "fetchTagCompliance error");
    return {
      ...UNAVAILABLE,
      dataSource: "error",
      errorMessage: msg,
    };
  }
}
