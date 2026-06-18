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

/** Returns ISO-8601 with +00:00 offset — required by the Zod datetime({offset:true}) schema. */
function nowIso(): string {
  return new Date().toISOString().replace("Z", "+00:00");
}

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
  scannedAt: new Date(0).toISOString().replace("Z", "+00:00"),
  totalScanned: 0,
  nonCompliantCount: 0,
  entries: [],
  dataSource: "unavailable",
};

export async function fetchTagCompliance(
  { bypassCache = false }: { bypassCache?: boolean } = {},
): Promise<TagComplianceResult> {
  if (!isAzureConfigured()) return UNAVAILABLE;

  if (!bypassCache && _cache && Date.now() - _cache.fetchedAt < CACHE_TTL_MS) {
    return _cache.data;
  }

  const subscriptionIds = getSubscriptionIds();
  if (subscriptionIds.length === 0) return UNAVAILABLE;

  try {
    const client = getClient();

    // Union query across all three scope levels. We fetch all resources first
    // (totalScanned), then filter to those missing at least one required tag.
    // Two passes: count total, then return non-compliant only (up to 1000).
    const requiredTagsKql = REQUIRED_TAGS.map((t) => `"${t}"`).join(", ");
    const query = `
      let required_tags = dynamic([${requiredTagsKql}]);
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
      | limit 1000
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
      scannedAt: nowIso(),
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
    logger.error({ err }, "fetchTagCompliance error");
    // Extract a clean message from Azure SDK errors — the raw message contains
    // internal timestamps and correlationIds that are not useful to display.
    let cleanMsg = "Azure Resource Graph query failed.";
    if (err && typeof err === "object") {
      const e = err as Record<string, unknown>;
      // Azure SDK errors surface the code in e.code or e.statusCode
      if (typeof e["code"] === "string") {
        if (e["code"] === "AuthorizationFailed" || e["code"] === "403") {
          cleanMsg = "Authorization failed — the managed identity does not have Reader access to one or more subscriptions.";
        } else if (e["code"] === "LinkedAuthorizationFailed") {
          cleanMsg = "Authorization failed — insufficient permissions on a linked subscription.";
        } else if (e["code"] === "InvalidSubscriptionId" || e["code"] === "SubscriptionNotFound") {
          cleanMsg = "One or more subscription IDs in AZURE_SUBSCRIPTION_IDS are invalid or not accessible.";
        } else if (e["code"] === "TooManyRequests" || String(e["statusCode"]) === "429") {
          cleanMsg = "Azure Resource Graph is throttled — please retry in a few minutes.";
        } else if (typeof e["code"] === "string") {
          cleanMsg = `Azure error: ${e["code"]}.`;
        }
      }
    }
    return {
      ...UNAVAILABLE,
      scannedAt: nowIso(),
      dataSource: "error",
      errorMessage: cleanMsg,
    };
  }
}
