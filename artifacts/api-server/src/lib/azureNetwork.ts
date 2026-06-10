import { ResourceGraphClient } from "@azure/arm-resourcegraph";
import { getAzureCredential, getSubscriptionIds, isAzureConfigured } from "./azure.js";
import { logger } from "./logger.js";
import type { AppRecord } from "../routes/orbit.js";

/** A UUID-shaped GUID (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx). */
function isGuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

/**
 * Returns the shared-platform subscription ID from AZURE_SUB_SHAREDPLATFORM if it is set
 * and is a valid GUID; otherwise returns null.
 *
 * Used to include the shared-platform subscription (which hosts the Orbit Container App
 * `ca-orbit-prod-v2`, Front Door `afd-shared-prod`, and associated VNets/Network Watchers)
 * in every network Resource Graph query regardless of which app is being queried.
 */
export function getSharedInfraSubscriptionId(): string | null {
  const val = process.env.AZURE_SUB_SHAREDPLATFORM;
  if (val && isGuid(val)) return val;
  return null;
}

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
    // Table format: { columns: [{name,type},...], rows: [[val,...],...] }
    if (Array.isArray(d["rows"]) && Array.isArray(d["columns"])) {
      const columns = (d["columns"] as Array<{ name: string }>).map((c) => c.name);
      return (d["rows"] as unknown[][]).map((row) =>
        Object.fromEntries(columns.map((col, i) => [col, row[i]])),
      );
    }
    // Numeric-keyed object format: { "0": {...}, "1": {...} }
    // The Azure SDK sometimes deserialises the result this way instead of as an array.
    const keys = Object.keys(d);
    if (keys.length > 0 && keys.every((k) => /^\d+$/.test(k))) {
      return keys
        .sort((a, b) => parseInt(a) - parseInt(b))
        .map((k) => d[k] as Record<string, unknown>);
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
  // Build the subscription list first — it may come from any combination of:
  //   1. AZURE_SUBSCRIPTION_IDS (global comma-separated list)
  //   2. The app's own subscriptionId env var (AZURE_SUB_GRAILBABE, AZURE_SUB_SHAREDPLATFORM, etc.)
  //      — only included when it is a valid GUID (guards against placeholder fallbacks like
  //        "a1f4-shared-platform" which would cause Resource Graph to throw).
  //   3. AZURE_SUB_SHAREDPLATFORM — shared-platform subscription hosting Front Door, Container
  //      Apps env, and shared VNets/Network Watchers; included in every app's query.
  //   Deduplicated so each subscription is queried exactly once.
  //
  // NOTE: We intentionally do NOT gate on isAzureConfigured() here because that only checks
  // AZURE_SUBSCRIPTION_IDS.  Users may configure only per-app subscription vars without setting
  // the global list — in that case we should still attempt the query.
  const globalSubs = getSubscriptionIds();
  const sharedInfraSub = getSharedInfraSubscriptionId();
  const appSub = app.subscriptionId && isGuid(app.subscriptionId) ? app.subscriptionId : null;

  const subscriptionIds = [
    ...new Set([
      ...globalSubs,
      ...(appSub ? [appSub] : []),
      ...(sharedInfraSub ? [sharedInfraSub] : []),
    ]),
  ];

  // If no valid subscription IDs could be assembled from any source, Azure is not
  // configured for this environment — return null so callers show the "not configured" state.
  if (subscriptionIds.length === 0) return null;

  if (!bypassCache) {
    const entry = _networkCache.get(app.id);
    if (entry && entry.expiresAt > Date.now()) {
      return entry.result;
    }
  }

  // Query subscription-wide — shared resources (Front Door, Container Apps Envs) live
  // in different RGs from the compute RG.  Container Apps is the primary source of truth
  // here since these deployments use managed networking (no customer-owned VNets).
  const query = `
    resources
    | where type in~ (
        'microsoft.app/containerapps',
        'microsoft.app/managedenvironments',
        'microsoft.network/frontdoors',
        'microsoft.cdn/profiles',
        'microsoft.network/applicationgateways',
        'microsoft.network/networksecuritygroups',
        'microsoft.network/publicipaddresses',
        'microsoft.network/loadbalancers',
        'microsoft.network/networkwatchers',
        'microsoft.network/virtualnetworks',
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

      if (type === "microsoft.app/containerapps") {
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

      if (type.includes("virtualnetworks")) {
        return [{ name: `VNet — ${resourceName}`, status, latencyMs: 0, packetLossPercent: 0, region: location }];
      }

      if (type.includes("dnszones") || type.includes("privatednszones")) {
        // DNS zones have no operationalState; existence == operational.
        // Treat any non-failed provisioningState (including empty) as healthy.
        const dnsStatus: NetworkEndpoint["status"] = provisioningState.toLowerCase() === "failed" ? "unhealthy" : "healthy";
        const zoneLabel = type.includes("privatednszones") ? `Private DNS — ${resourceName}` : `DNS — ${resourceName}`;
        return [{ name: zoneLabel, status: dnsStatus, latencyMs: 1, packetLossPercent: 0, region: location }];
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
