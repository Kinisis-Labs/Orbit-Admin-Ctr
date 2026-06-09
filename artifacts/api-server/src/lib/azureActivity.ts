import { MonitorClient } from "@azure/arm-monitor";
import { getAzureCredential, isAzureConfigured } from "./azure.js";
import { logger } from "./logger.js";
import { resolveActorNames } from "./graphResolver.js";

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

    const start = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
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

    const actorNames = await resolveActorNames(entries.map((e) => e.actor));
    for (const entry of entries) {
      const resolved = actorNames.get(entry.actor);
      if (resolved !== undefined) entry.actor = resolved;
    }

    _cache.set(appId, { data: entries, fetchedAt: Date.now() });
    return entries;
  } catch (err) {
    logger.error({ err, appId }, "fetchActivityLog error");
    return [];
  }
}

export type ActivityLogDiagnostic = {
  appId: string;
  subscriptionId: string;
  resourceGroup: string;
  isAzureConfigured: boolean;
  outcome: "not_configured" | "success" | "error";
  count: number;
  sampleActors: string[];
  /** Populated when count=0: resource groups that DO have activity in this subscription (helps diagnose wrong RG name). */
  activeResourceGroups?: string[];
  error?: string;
};

export async function diagnoseActivityLog(
  appId: string,
  resourceGroup: string,
  subscriptionId: string,
): Promise<ActivityLogDiagnostic> {
  if (!isAzureConfigured()) {
    return { appId, subscriptionId, resourceGroup, isAzureConfigured: false, outcome: "not_configured", count: 0, sampleActors: [] };
  }

  try {
    const credential = getAzureCredential();
    const client = new MonitorClient(credential, subscriptionId);
    const start = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const filter = `eventTimestamp ge '${start}' and resourceGroupName eq '${resourceGroup}'`;

    let count = 0;
    const sampleActors: string[] = [];
    for await (const event of client.activityLogs.list(filter, {
      select: "eventTimestamp,eventDataId,caller",
    })) {
      count++;
      if (event.caller && !sampleActors.includes(event.caller)) {
        sampleActors.push(event.caller);
      }
      if (count >= 20) break;
    }

    if (count > 0) {
      return { appId, subscriptionId, resourceGroup, isAzureConfigured: true, outcome: "success", count, sampleActors };
    }

    // count=0 — scan subscription-wide (no RG filter) to find which RGs actually have activity
    const activeResourceGroups: string[] = [];
    const subFilter = `eventTimestamp ge '${start}'`;
    for await (const event of client.activityLogs.list(subFilter, {
      select: "eventTimestamp,eventDataId,resourceGroupName",
    })) {
      const rg = event.resourceGroupName;
      if (rg && !activeResourceGroups.includes(rg)) {
        activeResourceGroups.push(rg);
      }
      if (activeResourceGroups.length >= 10) break;
    }

    return { appId, subscriptionId, resourceGroup, isAzureConfigured: true, outcome: "success", count, sampleActors, activeResourceGroups };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { appId, subscriptionId, resourceGroup, isAzureConfigured: true, outcome: "error", count: 0, sampleActors: [], error: msg.slice(0, 300) };
  }
}
