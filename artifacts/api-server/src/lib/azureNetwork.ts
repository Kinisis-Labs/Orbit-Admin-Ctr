import { ResourceGraphClient } from "./resourceGraph.js";
import { getAzureCredential, getSubscriptionIds, isAzureConfigured } from "./azure.js";
import type { AppRecord } from "../routes/orbit.js";

export type NetworkEndpoint = {
  name: string;
  status: "healthy" | "degraded" | "unhealthy" | "unknown";
  latencyMs: number;
  packetLossPercent: number;
  region: string;
};

export type NetworkResult = {
  endpoints: NetworkEndpoint[];
};

let _client: ResourceGraphClient | null = null;

function getClient(): ResourceGraphClient {
  if (!_client) {
    _client = new ResourceGraphClient(getAzureCredential());
  }
  return _client;
}

/** Map Azure provisioning/operational state to dashboard status. */
function mapNetworkStatus(
  provisioningState: string | undefined,
  operationalState: string | undefined,
): "healthy" | "degraded" | "unhealthy" | "unknown" {
  const ps = (provisioningState ?? "").toLowerCase();
  const os = (operationalState ?? "").toLowerCase();
  if (ps === "succeeded" && (os === "running" || os === "enabled" || os === "")) return "healthy";
  if (ps === "updating" || os === "degraded" || os === "stopped") return "degraded";
  if (ps === "failed" || os === "failed" || os === "disabled") return "unhealthy";
  if (ps === "succeeded") return "healthy";
  return "unknown";
}

// Cache: app id → { result, expiresAt }
const NETWORK_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
type NetworkCacheEntry = { result: NetworkEndpoint[]; expiresAt: number };
const _networkCache = new Map<string, NetworkCacheEntry>();

/**
 * Fetch networking resource health for the app's resource group via Resource Graph.
 * Queries for Front Door profiles, Application Gateways, Virtual Networks, and
 * Private DNS zones in the RG, then maps them to the dashboard endpoint shape.
 *
 * Results are cached in-process for NETWORK_CACHE_TTL_MS (10 min). Pass
 * `bypassCache: true` to skip the cache and force a fresh API call (the fresh
 * result is still written back to the cache).
 *
 * Returns null when not configured or on any error (caller falls back to mock).
 */
export async function fetchNetworkEndpoints(
  app: AppRecord,
  { bypassCache = false }: { bypassCache?: boolean } = {},
): Promise<NetworkEndpoint[] | null> {
  if (!isAzureConfigured()) return null;

  if (!bypassCache) {
    const entry = _networkCache.get(app.id);
    if (entry && entry.expiresAt > Date.now()) {
      return entry.result;
    }
  }

  const subscriptionIds = getSubscriptionIds();

  // Query networking resources subscription-wide (not scoped to the app's compute RG)
  // because shared resources like Front Door and DNS zones live in different RGs.
  const query = `
    resources
    | where type in~ (
        'microsoft.network/frontdoors',
        'microsoft.cdn/profiles',
        'microsoft.network/applicationgateways',
        'microsoft.network/virtualnetworks',
        'microsoft.network/privatednszones',
        'microsoft.network/dnszones'
      )
    | project
        id,
        name,
        type,
        location,
        provisioningState = tostring(properties.provisioningState),
        operationalState  = tostring(properties.operationalState)
    | order by type asc
    | limit 20
  `;

  try {
    const result = await getClient().resources({
      query,
      subscriptions: subscriptionIds,
    });

    const rows = (result.data as Record<string, unknown>[]) ?? [];

    if (rows.length === 0) return null;

    const endpoints: NetworkEndpoint[] = rows.map((row) => {
      const type = String(row["type"] ?? "").toLowerCase();
      const provisioningState = String(row["provisioningState"] ?? "");
      const operationalState = String(row["operationalState"] ?? "");
      const status = mapNetworkStatus(provisioningState, operationalState);
      const location = String(row["location"] ?? app.region);

      // Derive a friendly name and typical latency range by resource type.
      let displayName: string;
      let baseLatency: number;

      if (type.includes("frontdoor") || type.includes("cdn/profiles")) {
        displayName = "Front Door";
        baseLatency = 35;
      } else if (type.includes("applicationgateway")) {
        displayName = "Application Gateway";
        baseLatency = 12;
      } else if (type.includes("virtualnetwork")) {
        displayName = "Origin VNet Link";
        baseLatency = 4;
      } else if (type.includes("privatednszones") || type.includes("dnszones")) {
        displayName = "Private DNS";
        baseLatency = 1;
      } else {
        displayName = String(row["name"] ?? "Network Resource");
        baseLatency = 10;
      }

      return {
        name: displayName,
        status,
        latencyMs: baseLatency,
        packetLossPercent: status === "healthy" ? 0 : 0.5,
        region: location,
      };
    });

    _networkCache.set(app.id, { result: endpoints, expiresAt: Date.now() + NETWORK_CACHE_TTL_MS });
    return endpoints;
  } catch {
    return null;
  }
}
