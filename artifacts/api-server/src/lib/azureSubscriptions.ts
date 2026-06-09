import { ResourceGraphClient } from "@azure/arm-resourcegraph";
import { getAzureCredential, getSubscriptionIds, isAzureConfigured } from "./azure.js";
import { normalizeResourceGraphRows } from "./azureNetwork.js";

// Cache: subscriptionId (lowercase) → display name
const SUB_NAME_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours — subscription names rarely change
type SubNameCacheEntry = { name: string; expiresAt: number };
const _subNameCache = new Map<string, SubNameCacheEntry>();

let _graphClient: ResourceGraphClient | null = null;

function getGraphClient(): ResourceGraphClient {
  if (!_graphClient) {
    _graphClient = new ResourceGraphClient(getAzureCredential());
  }
  return _graphClient;
}

/** Evict all cached subscription name entries. */
export function clearSubscriptionNameCache(): void {
  _subNameCache.clear();
}

/**
 * Fetch human-readable display names for the given Azure subscription IDs.
 *
 * Uses Resource Graph (`resourcecontainers | where type =~ 'microsoft.resources/subscriptions'`)
 * so no extra package is required beyond the already-installed @azure/arm-resourcegraph.
 *
 * Returns a Map from subscriptionId (lowercase) → displayName.
 * Returns an empty map when Azure is unconfigured or on any error.
 * Results are cached for 6 hours.
 */
export async function fetchSubscriptionNames(
  subscriptionIds: string[],
): Promise<Map<string, string>> {
  if (!isAzureConfigured() || subscriptionIds.length === 0) return new Map();

  const now = Date.now();
  const result = new Map<string, string>();
  const missing: string[] = [];

  for (const id of subscriptionIds) {
    const key = id.toLowerCase();
    const cached = _subNameCache.get(key);
    if (cached && cached.expiresAt > now) {
      result.set(key, cached.name);
    } else {
      missing.push(id);
    }
  }

  if (missing.length === 0) return result;

  try {
    const query = `
      resourcecontainers
      | where type =~ 'microsoft.resources/subscriptions'
      | project subscriptionId, name
    `;
    const response = await getGraphClient().resources({
      query,
      subscriptions: missing,
    });

    const rows = normalizeResourceGraphRows(response.data);
    for (const row of rows) {
      const subId = (row["subscriptionId"] as string | undefined) ?? "";
      const name = (row["name"] as string | undefined) ?? "";
      if (subId && name) {
        const key = subId.toLowerCase();
        _subNameCache.set(key, { name, expiresAt: now + SUB_NAME_CACHE_TTL_MS });
        result.set(key, name);
      }
    }
  } catch {
    // Resource Graph unavailable — return whatever we have from cache
  }

  return result;
}

/**
 * Fetch the display name for a single subscription ID.
 * Returns undefined when unconfigured, not found, or on error.
 */
export async function fetchSubscriptionName(subscriptionId: string): Promise<string | undefined> {
  const names = await fetchSubscriptionNames([subscriptionId]);
  return names.get(subscriptionId.toLowerCase());
}
