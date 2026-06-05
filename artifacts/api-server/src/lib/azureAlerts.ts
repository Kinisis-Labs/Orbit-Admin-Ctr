import { ResourceGraphClient } from "./resourceGraph.js";
import { getAzureCredential, getSubscriptionIds, isAzureConfigured } from "./azure.js";
import type { AppRecord } from "../routes/orbit.js";

export type AlertEntry = {
  id: string;
  appId: string;
  appName: string;
  title: string;
  description: string;
  severity: "info" | "warning" | "error" | "critical";
  source: string;
  firedAt: string;
  status: "active" | "acknowledged" | "resolved";
};

let _client: ResourceGraphClient | null = null;

function getClient(): ResourceGraphClient {
  if (!_client) {
    _client = new ResourceGraphClient(getAzureCredential());
  }
  return _client;
}

/** Map Azure alert severity integers (0=Critical … 4=Verbose) to the dashboard enum. */
function mapSeverity(
  sev: string | number | undefined,
): "critical" | "error" | "warning" | "info" {
  const s = String(sev ?? "4");
  if (s === "0") return "critical";
  if (s === "1") return "error";
  if (s === "2") return "warning";
  if (s === "3") return "info";
  return "info";
}

/** Map Azure alert state to dashboard status enum. */
function mapState(
  state: string | undefined,
): "active" | "acknowledged" | "resolved" {
  const s = (state ?? "").toLowerCase();
  if (s === "new" || s === "fired") return "active";
  if (s === "acknowledged") return "acknowledged";
  if (s === "closed" || s === "resolved") return "resolved";
  return "active";
}

type AlertSource =
  | "AzureMonitor"
  | "LogAnalytics"
  | "NetworkWatcher"
  | "CostManagement"
  | "ApplicationInsights"
  | "WebAppTelemetry";

/**
 * Normalize a raw Azure monitorService value to the strict API enum.
 * Azure Monitor returns strings like "Application Insights", "Log Analytics",
 * "Network Watcher", etc. Unrecognised values fall back to "AzureMonitor"
 * so that GetAppAlertsResponse.parse() never throws on valid alert rows.
 */
function normalizeSource(raw: string | undefined): AlertSource {
  const s = (raw ?? "").toLowerCase().replace(/[\s_-]/g, "");
  if (s.includes("applicationinsights")) return "ApplicationInsights";
  if (s.includes("loganalytics")) return "LogAnalytics";
  if (s.includes("networkwatcher")) return "NetworkWatcher";
  if (s.includes("costmanagement")) return "CostManagement";
  if (s.includes("webapp")) return "WebAppTelemetry";
  return "AzureMonitor";
}

// Cache: app id → { result, expiresAt }
const ALERTS_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
type AlertsCacheEntry = { result: AlertEntry[]; expiresAt: number };
const _alertsCache = new Map<string, AlertsCacheEntry>();

/**
 * Fetch active Azure Monitor alert instances for the app's resource group
 * using a Resource Graph KQL query against the alertsmanagementresources table.
 *
 * Results are cached in-process for ALERTS_CACHE_TTL_MS (5 min). Pass
 * `bypassCache: true` to skip the cache and force a fresh API call (the fresh
 * result is still written back to the cache).
 *
 * Returns null when not configured or on any error (caller falls back to mock).
 */
export async function fetchActiveAlerts(
  app: AppRecord,
  { bypassCache = false }: { bypassCache?: boolean } = {},
): Promise<AlertEntry[] | null> {
  if (!isAzureConfigured()) return null;

  if (!bypassCache) {
    const entry = _alertsCache.get(app.id);
    if (entry && entry.expiresAt > Date.now()) {
      return entry.result;
    }
  }

  const subscriptionIds = getSubscriptionIds();
  const rg = app.resourceGroup.toLowerCase();

  const query = `
    alertsmanagementresources
    | where resourceGroup =~ '${rg}'
    | where type =~ 'microsoft.alertsmanagement/alerts'
    | where properties.essentials.alertState !~ 'Closed'
    | project
        id,
        name,
        severity    = tostring(properties.essentials.severity),
        alertState  = tostring(properties.essentials.alertState),
        firedDateTime = tostring(properties.essentials.startDateTime),
        description = tostring(properties.essentials.description),
        monitorService = tostring(properties.essentials.monitorService),
        signalType  = tostring(properties.essentials.signalType)
    | order by firedDateTime desc
    | limit 50
  `;

  try {
    const result = await getClient().resources({
      query,
      subscriptions: subscriptionIds,
    });

    const rows = (result.data as Record<string, unknown>[]) ?? [];

    const alerts = rows.map((row, i) => {
      const sev = String(row["severity"] ?? "Sev4").replace(/sev/i, "");
      const firedAt = String(
        row["firedDateTime"] ?? new Date().toISOString(),
      );
      const title = String(row["name"] ?? `Alert ${i + 1}`);
      const description = String(row["description"] ?? "");

      return {
        id: String(row["id"] ?? `${app.id}-azure-alert-${i}`),
        appId: app.id,
        appName: app.name,
        title,
        description,
        severity: mapSeverity(sev),
        source: normalizeSource(row["monitorService"] as string | undefined),
        firedAt,
        status: mapState(String(row["alertState"] ?? "")),
      };
    });

    _alertsCache.set(app.id, { result: alerts, expiresAt: Date.now() + ALERTS_CACHE_TTL_MS });
    return alerts;
  } catch {
    return null;
  }
}
