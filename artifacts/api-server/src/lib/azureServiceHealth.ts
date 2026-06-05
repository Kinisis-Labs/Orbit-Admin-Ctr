import { ResourceGraphClient } from "@azure/arm-resourcegraph";
import { getAzureCredential, getSubscriptionIds, isAzureConfigured } from "./azure.js";
import { logger } from "./logger.js";

/**
 * Azure Service Health — active incidents, advisories, and planned maintenance.
 *
 * Queries the `servicehealthresources` Resource Graph table for events in the
 * subscriptions Orbit monitors. Returns [] when Azure is not configured or on error.
 *
 * Cache: 15 minutes in-process.
 */

const CACHE_TTL_MS = 15 * 60 * 1000;

export type ServiceHealthEvent = {
  id: string;
  service: string;
  region: string;
  status: "Active" | "Resolved" | "Advisory";
  severity: "Low" | "Medium" | "High";
  title: string;
  startedAt: string;
  resolvedAt?: string;
};

type CacheEntry = {
  data: ServiceHealthEvent[];
  fetchedAt: number;
};

let _cache: CacheEntry | null = null;
let _client: ResourceGraphClient | null = null;

function getClient(): ResourceGraphClient {
  if (!_client) {
    _client = new ResourceGraphClient(getAzureCredential());
  }
  return _client;
}

function mapSeverity(value: unknown): ServiceHealthEvent["severity"] {
  const n = typeof value === "number" ? value : parseInt(String(value ?? "3"), 10);
  if (n <= 1) return "High";
  if (n === 2) return "Medium";
  return "Low";
}

function mapEventTypeToStatus(
  eventType: string,
  properties: Record<string, unknown>,
): ServiceHealthEvent["status"] {
  if (eventType === "HealthAdvisory") return "Advisory";
  const resolutionTime = properties["ResolutionTime"] as string | undefined;
  return resolutionTime ? "Resolved" : "Active";
}

export async function fetchServiceHealth(): Promise<ServiceHealthEvent[]> {
  if (!isAzureConfigured()) return [];

  if (_cache && Date.now() - _cache.fetchedAt < CACHE_TTL_MS) {
    return _cache.data;
  }

  const subscriptionIds = getSubscriptionIds();
  if (subscriptionIds.length === 0) return [];

  try {
    const client = getClient();
    const query = `
      servicehealthresources
      | where type =~ 'microsoft.resourcehealth/events'
      | where properties.EventType in ('ServiceIssue', 'PlannedMaintenance', 'HealthAdvisory')
      | project id, name, properties
      | order by tostring(properties.ActivationTime) desc
      | limit 30
    `;

    const result = await client.resources({
      query,
      subscriptions: subscriptionIds,
    });

    const rows = (result.data as unknown as Array<Record<string, unknown>>) ?? [];
    const events: ServiceHealthEvent[] = [];

    for (const row of rows) {
      try {
        const props = (row["properties"] ?? {}) as Record<string, unknown>;
        const eventType = String(props["EventType"] ?? "ServiceIssue");
        const status = mapEventTypeToStatus(eventType, props);

        const impactedServices = (props["ImpactedServices"] as Array<{ ImpactedRegions?: Array<{ RegionName?: string }> }>) ?? [];
        const region =
          impactedServices[0]?.ImpactedRegions?.[0]?.RegionName ?? "global";

        const activationTime = String(props["ActivationTime"] ?? new Date().toISOString());
        const resolutionTime = props["ResolutionTime"] ? String(props["ResolutionTime"]) : undefined;

        events.push({
          id: String(row["id"] ?? row["name"] ?? `svc-${events.length}`),
          service: String(props["Service"] ?? "Azure"),
          region,
          status,
          severity: mapSeverity(props["Severity"]),
          title: String(props["Title"] ?? "Azure service event"),
          startedAt: activationTime,
          ...(resolutionTime ? { resolvedAt: resolutionTime } : {}),
        });
      } catch {
        // Skip malformed rows
      }
    }

    _cache = { data: events, fetchedAt: Date.now() };
    return events;
  } catch (err) {
    logger.error({ err }, "fetchServiceHealth error");
    return [];
  }
}
