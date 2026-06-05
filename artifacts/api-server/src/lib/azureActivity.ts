import { MonitorClient } from "@azure/arm-monitor";
import { getAzureCredential, isAzureConfigured } from "./azure.js";
import { logger } from "./logger.js";

/**
 * Azure Activity Log — operator-action audit trail per resource group.
 *
 * Queries the last 7 days of Azure Activity Log events for an app's
 * resource group. Returns [] when Azure is not configured or on error.
 *
 * Cache: 5 minutes in-process per app.
 */

const CACHE_TTL_MS = 5 * 60 * 1000;

export type ActivityLogEntry = {
  id: string;
  timestamp: string;
  actor: string;
  action: string;
  target: string;
  appId: string;
  status: "Succeeded" | "Failed" | "Started";
  category: string;
};

type CacheEntry = {
  data: ActivityLogEntry[];
  fetchedAt: number;
};

const _cache = new Map<string, CacheEntry>();

function mapStatus(status: string | undefined): ActivityLogEntry["status"] {
  const s = (status ?? "").toLowerCase();
  if (s === "failed") return "Failed";
  if (s === "started") return "Started";
  return "Succeeded";
}

export async function fetchActivityLog(
  appId: string,
  resourceGroup: string,
  subscriptionId: string,
): Promise<ActivityLogEntry[]> {
  if (!isAzureConfigured()) return [];

  const cached = _cache.get(appId);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.data;
  }

  try {
    const credential = getAzureCredential();
    const client = new MonitorClient(credential, subscriptionId);

    const start = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const filter = `eventTimestamp ge '${start}' and resourceGroupName eq '${resourceGroup}'`;

    const entries: ActivityLogEntry[] = [];

    for await (const event of client.activityLogs.list(filter, {
      select: "eventTimestamp,caller,operationName,resourceGroupName,status,category,eventDataId",
    })) {
      if (!event.eventTimestamp) continue;

      entries.push({
        id: event.eventDataId ?? `${appId}-${event.eventTimestamp.toISOString()}-${entries.length}`,
        timestamp: event.eventTimestamp.toISOString(),
        actor: event.caller ?? "unknown",
        action: event.operationName?.localizedValue ?? event.operationName?.value ?? "Unknown operation",
        target: event.resourceGroupName ?? resourceGroup,
        appId,
        status: mapStatus(event.status?.localizedValue ?? event.status?.value),
        category: event.category?.localizedValue ?? event.category?.value ?? "Operation",
      });

      if (entries.length >= 120) break;
    }

    entries.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    _cache.set(appId, { data: entries, fetchedAt: Date.now() });
    return entries;
  } catch (err) {
    logger.error({ err, appId }, "fetchActivityLog error");
    return [];
  }
}
