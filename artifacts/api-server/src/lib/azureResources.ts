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

/**
 * Fetch resources in the app's resource group from Azure Resource Graph.
 * Returns an array of resource entries in the standard dashboard shape.
 * Falls back to an empty array on error so the route can use the mock.
 */
export async function fetchResourcesByResourceGroup(
  app: AppRecord,
): Promise<ResourceEntry[] | null> {
  if (!isAzureConfigured()) return null;

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
    return rows.map((row) => ({
      id: String(row["id"] ?? ""),
      name: String(row["name"] ?? ""),
      type: normalizeType(String(row["type"] ?? "")),
      status: mapStatus(
        row["provisioningState"] as string | undefined,
        row["powerState"] as string | undefined,
      ),
      location: String(row["location"] ?? app.region),
    }));
  } catch {
    return null;
  }
}
