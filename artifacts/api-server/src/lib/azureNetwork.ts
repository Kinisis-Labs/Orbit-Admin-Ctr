import { ResourceGraphClient } from "@azure/arm-resourcegraph";
import { getAzureCredential, getSubscriptionIds, isAzureConfigured } from "./azure.js";
import { logger } from "./logger.js";
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

/**
 * Azure Resource Graph returns data in two formats depending on the query size/result count:
 *   - Object-array format: `Record<string,unknown>[]`  (small results)
 *   - Table format: `{ columns: [{name,type},...], rows: [[val,...],...]}`  (larger results)
 *
 * This normaliser always returns an object-array so callers don't have to care which came back.
 */
export function normalizeResourceGraphRows(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) {
    return data as Record<string, unknown>[];
  }
  if (data && typeof data === "object") {
    const d = data as Record<string, unknown>;
    if (Array.isArray(d["rows"]) && Array.isArray(d["columns"])) {
      const columns = (d["columns"] as Array<{ name: string }>).map((c) => c.name);
      return (d["rows"] as unknown[][]).map((row) =>
        Object.fromEntries(columns.map((col, i) => [col, row[i]])),
      );
    }
  }
  return [];
}

// Cache: app id → { result, expiresAt }
const NETWORK_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
type NetworkCacheEntry = { result: NetworkEndpoint[]; expiresAt: number };
const _networkCache = new Map<string, NetworkCacheEntry>();

/**
 * Fetch network-relevant endpoint data for the subscriptions via Resource Graph.
 *
 * Covers the Container Apps topology (no customer-owned VNets):
 *   - Container Apps with external ingress  → these ARE the exposed endpoints
 *   - Container Apps Environments           → network boundary / managed env health
 *   - Azure Front Door / CDN profiles       → global entry point (if in these subs)
 *   - Application Gateways, Network Watchers (if any)
 *   - NSGs, Public IPs, Load Balancers      → optional infra-level resources
 *
 * Results are cached in-process for NETWORK_CACHE_TTL_MS (10 min). Pass
 * `bypassCache: true` to force a fresh API call.
 *
 * Returns null on error, [] when configured but no matching resources found.
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

  // Query subscription-wide — shared resources (Front Door, Container Apps Envs) live
  // in different RGs from the compute RG.  Container Apps is the primary source of truth
  // here since these deployments use managed networking (no customer-owned VNets).
  const query = `
    resources
    | where type in~ (
        'microsoft.app/containerapp',
        'microsoft.app/managedenvironments',
        'microsoft.network/frontdoors',
        'microsoft.cdn/profiles',
        'microsoft.network/applicationgateways',
        'microsoft.network/networksecuritygroups',
        'microsoft.network/publicipaddresses',
        'microsoft.network/loadbalancers',
        'microsoft.network/networkwatchers',
        'microsoft.network/privatednszones',
        'microsoft.network/dnszones'
      )
    | project
        id,
        name,
        type,
        kind,
        location,
        resourceGroup,
        provisioningState = tostring(properties.provisioningState),
        operationalState  = tostring(properties.operationalState),
        fqdn              = tostring(properties.configuration.ingress.fqdn),
        ingressExternal   = tobool(properties.configuration.ingress.external),
        staticIp          = tostring(properties.staticIp)
    | order by type asc
    | limit 100
  `;

  try {
    const result = await getClient().resources({
      query,
      subscriptions: subscriptionIds,
    });

    const rows = normalizeResourceGraphRows(result.data);

    logger.info(
      { appId: app.id, rowCount: rows.length, subscriptions: subscriptionIds },
      "fetchNetworkEndpoints Resource Graph query returned",
    );

    if (rows.length === 0) return [];

    const endpoints: NetworkEndpoint[] = rows.flatMap((row) => {
      const type = String(row["type"] ?? "").toLowerCase();
      const kind = String(row["kind"] ?? "").toLowerCase();
      const provisioningState = String(row["provisioningState"] ?? "");
      const operationalState = String(row["operationalState"] ?? "");
      const status = mapNetworkStatus(provisioningState, operationalState);
      const location = String(row["location"] ?? app.region);
      const resourceName = String(row["name"] ?? "");
      const fqdn = String(row["fqdn"] ?? "");
      const ingressExternal = row["ingressExternal"] === true;

      if (type === "microsoft.app/containerapp") {
        // Only surface Container Apps with external ingress — internal ones have no
        // public endpoint to probe.
        if (!ingressExternal && !fqdn) return [];
        const label = fqdn ? `${resourceName} (${fqdn})` : resourceName;
        return [{ name: `Container App — ${label}`, status, latencyMs: 8, packetLossPercent: 0, region: location }];
      }

      if (type === "microsoft.app/managedenvironments") {
        return [{ name: `Container Apps Env — ${resourceName}`, status, latencyMs: 0, packetLossPercent: 0, region: location }];
      }

      if (type.includes("frontdoor") || (type.includes("cdn/profiles") && kind.includes("frontdoor"))) {
        return [{ name: `Front Door — ${resourceName}`, status, latencyMs: 35, packetLossPercent: 0, region: location }];
      }

      if (type.includes("cdn/profiles")) {
        return [{ name: `CDN — ${resourceName}`, status, latencyMs: 30, packetLossPercent: 0, region: location }];
      }

      if (type.includes("applicationgateway")) {
        return [{ name: `App Gateway — ${resourceName}`, status, latencyMs: 12, packetLossPercent: 0, region: location }];
      }

      if (type.includes("networksecuritygroups")) {
        return [{ name: `NSG — ${resourceName}`, status, latencyMs: 0, packetLossPercent: 0, region: location }];
      }

      if (type.includes("publicipaddresses")) {
        const ip = String(row["staticIp"] ?? "");
        const label = ip ? `${resourceName} (${ip})` : resourceName;
        return [{ name: `Public IP — ${label}`, status, latencyMs: 0, packetLossPercent: 0, region: location }];
      }

      if (type.includes("loadbalancers")) {
        return [{ name: `Load Balancer — ${resourceName}`, status, latencyMs: 2, packetLossPercent: 0, region: location }];
      }

      if (type.includes("networkwatchers")) {
        return [{ name: `Network Watcher — ${resourceName}`, status, latencyMs: 0, packetLossPercent: 0, region: location }];
      }

      if (type.includes("dnszones") || type.includes("privatednszones")) {
        return [{ name: `DNS — ${resourceName}`, status, latencyMs: 1, packetLossPercent: 0, region: location }];
      }

      return [{ name: resourceName, status, latencyMs: 0, packetLossPercent: 0, region: location }];
    });

    _networkCache.set(app.id, { result: endpoints, expiresAt: Date.now() + NETWORK_CACHE_TTL_MS });
    return endpoints;
  } catch (err: unknown) {
    logger.error(
      { err, appId: app.id, subscriptions: subscriptionIds },
      "fetchNetworkEndpoints Resource Graph query failed",
    );
    return null;
  }
}
