import { ResourceGraphClient } from "@azure/arm-resourcegraph";
import { getAzureCredential, getSubscriptionIds, isAzureConfigured } from "./azure.js";
import type { AppRecord } from "../routes/orbit.js";

export type ResourceEntry = {
  id: string;
  name: string;
  type: string;
  status: string;
  location: string;
  cpuPercent?: number;
  memoryPercent?: number;
};

export type ResourcesResult = {
  resources: ResourceEntry[];
};

let _client: ResourceGraphClient | null = null;

function getClient(): ResourceGraphClient {
  if (!_client) {
    _client = new ResourceGraphClient(getAzureCredential());
  }
  return _client;
}

/** Normalize Azure resource types to friendly display names. */
function normalizeType(raw: string): string {
  return raw
    .replace(/microsoft\./i, "Microsoft.")
    .split("/")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join("/");
}

/** Map Azure power/provisioning state to the dashboard status enum. */
function mapStatus(
  provisioningState: string | undefined,
  powerState: string | undefined,
): "healthy" | "degraded" | "unhealthy" | "unknown" {
  const ps = (provisioningState ?? "").toLowerCase();
  const pw = (powerState ?? "").toLowerCase();
  if (ps === "succeeded" || ps === "running" || pw === "running") return "healthy";
  if (ps === "updating" || ps === "scaling" || pw === "stopping") return "degraded";
  if (ps === "failed" || pw === "stopped" || pw === "deallocated") return "unhealthy";
  return "unknown";
}

// Cache: app id → { result, expiresAt }
const RESOURCES_CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
type ResourcesCacheEntry = { result: ResourceEntry[]; expiresAt: number };
const _resourcesCache = new Map<string, ResourcesCacheEntry>();

/**
 * Fetch resources in the app's resource group from Azure Resource Graph.
 * Returns an array of resource entries in the standard dashboard shape.
 *
 * Results are cached in-process for RESOURCES_CACHE_TTL_MS (15 min). Pass
 * `bypassCache: true` to skip the cache and force a fresh API call (the fresh
 * result is still written back to the cache).
 *
 * Falls back to null on error so the route can use the mock.
 */
export async function fetchResourcesByResourceGroup(
  app: AppRecord,
  { bypassCache = false }: { bypassCache?: boolean } = {},
): Promise<ResourceEntry[] | null> {
  if (!isAzureConfigured()) return null;

  if (!bypassCache) {
    const entry = _resourcesCache.get(app.id);
    if (entry && entry.expiresAt > Date.now()) {
      return entry.result;
    }
  }

  const subscriptionIds = getSubscriptionIds();
  const rg = app.resourceGroup.toLowerCase();

  const query = `
    resources
    | where resourceGroup =~ '${rg}'
    | project id, name, type,
              provisioningState = tostring(properties.provisioningState),
              powerState = tostring(properties.instanceView.statuses[1].displayStatus),
              location
    | order by type asc
    | limit 50
  `;

  try {
    const result = await getClient().resources({
      query,
      subscriptions: subscriptionIds,
    });

    const rows = (result.data as Record<string, unknown>[]) ?? [];
    const resources = rows.map((row) => ({
      id: String(row["id"] ?? ""),
      name: String(row["name"] ?? ""),
      type: normalizeType(String(row["type"] ?? "")),
      status: mapStatus(
        row["provisioningState"] as string | undefined,
        row["powerState"] as string | undefined,
      ),
      location: String(row["location"] ?? app.region),
    }));

    _resourcesCache.set(app.id, { result: resources, expiresAt: Date.now() + RESOURCES_CACHE_TTL_MS });
    return resources;
  } catch {
    return null;
  }
}
