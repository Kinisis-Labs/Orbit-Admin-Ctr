import { getAccessToken } from "./azure-monitor.js";

function env(key: string): string | undefined {
  return process.env[key];
}

export type AlertSeverity = "critical" | "error" | "warning" | "informational" | "unknown";
export type AlertStatus = "active" | "acknowledged" | "resolved";

export interface AzureAlert {
  id: string;
  name: string;
  severity: AlertSeverity;
  status: AlertStatus;
  service: string;
  description: string;
  firedAt: string;
  resolvedAt: string | null;
  source: string;
}

function mapSeverity(sev: string | number): AlertSeverity {
  const s = String(sev).toLowerCase();
  if (s === "0" || s === "sev0" || s === "critical") return "critical";
  if (s === "1" || s === "sev1" || s === "error") return "error";
  if (s === "2" || s === "sev2" || s === "warning") return "warning";
  if (s === "3" || s === "sev3" || s === "informational") return "informational";
  if (s === "4" || s === "sev4") return "informational";
  return "unknown";
}

function mapStatus(state: string): AlertStatus {
  const s = state.toLowerCase();
  if (s === "acknowledged") return "acknowledged";
  if (s === "resolved" || s === "closed") return "resolved";
  return "active";
}

function extractService(resourceId: string): string {
  if (!resourceId) return "Unknown";
  const lower = resourceId.toLowerCase();
  if (lower.includes("containerapps")) return "Container Apps";
  if (lower.includes("flexibleservers") || lower.includes("postgresql")) return "PostgreSQL";
  if (lower.includes("storageaccounts")) return "Storage";
  if (lower.includes("components")) return "App Insights";
  if (lower.includes("sites")) return "App Service";
  const parts = resourceId.split("/");
  return parts[parts.length - 1] ?? "Unknown";
}

// ── Azure Monitor Alerts REST API ─────────────────────────────────────────────

export async function fetchAzureAlerts(): Promise<AzureAlert[]> {
  const subIds = (env("AZURE_SUBSCRIPTION_IDS") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (subIds.length === 0) return [];

  const token = await getAccessToken();
  if (!token) return [];

  const results: AzureAlert[] = [];

  await Promise.all(
    subIds.map(async (subId) => {
      try {
        const url = `https://management.azure.com/subscriptions/${subId}/providers/Microsoft.AlertsManagement/alerts?api-version=2023-07-12-preview&timeRange=1d&pageSize=100`;
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;

        interface RawAlert {
          id: string;
          name: string;
          properties: {
            severity?: string;
            alertState?: string;
            monitorCondition?: string;
            description?: string;
            firedDateTime?: string;
            resolvedDateTime?: string | null;
            targetResourceType?: string;
            targetResource?: string;
            essentials?: {
              severity?: string;
              alertState?: string;
              monitorCondition?: string;
              description?: string;
              firedDateTime?: string;
              resolvedDateTime?: string | null;
              targetResourceType?: string;
              targetResource?: string;
            };
          };
        }

        const data = (await res.json()) as { value?: RawAlert[] };
        for (const a of data.value ?? []) {
          const p = a.properties?.essentials ?? a.properties;
          results.push({
            id: a.id ?? a.name,
            name: a.name,
            severity: mapSeverity(p.severity ?? "unknown"),
            status: mapStatus(p.alertState ?? p.monitorCondition ?? "active"),
            service: extractService(p.targetResource ?? p.targetResourceType ?? ""),
            description: p.description ?? "",
            firedAt: p.firedDateTime ?? new Date().toISOString(),
            resolvedAt: p.resolvedDateTime ?? null,
            source: "azure-monitor",
          });
        }
      } catch {
        // per-subscription failures are non-fatal
      }
    }),
  );

  return results;
}

// ── MTTA / MTTR computation ───────────────────────────────────────────────────

export interface IncidentMetrics {
  activeCount: number;
  acknowledgedCount: number;
  resolvedCount: number;
  criticalCount: number;
  slaAtRiskCount: number;
  mttaMinutes: number | null;
  mttrMinutes: number | null;
  byService: Record<string, number>;
  bySeverity: Record<AlertSeverity, number>;
}

export function computeIncidentMetrics(alerts: AzureAlert[], slaMinutes = 240): IncidentMetrics {
  const now = Date.now();
  let mttaSum = 0;
  let mttaCount = 0;
  let mttrSum = 0;
  let mttrCount = 0;
  let slaAtRiskCount = 0;

  const byService: Record<string, number> = {};
  const bySeverity: Record<AlertSeverity, number> = {
    critical: 0, error: 0, warning: 0, informational: 0, unknown: 0,
  };

  for (const a of alerts) {
    bySeverity[a.severity] = (bySeverity[a.severity] ?? 0) + 1;
    byService[a.service] = (byService[a.service] ?? 0) + 1;

    const firedMs = new Date(a.firedAt).getTime();
    const ageMinutes = (now - firedMs) / 60_000;

    if (a.status === "acknowledged" || a.status === "resolved") {
      const ackedAt = a.resolvedAt ?? a.firedAt;
      mttaSum += (new Date(ackedAt).getTime() - firedMs) / 60_000;
      mttaCount++;
    }

    if (a.resolvedAt) {
      mttrSum += (new Date(a.resolvedAt).getTime() - firedMs) / 60_000;
      mttrCount++;
    }

    if (a.status === "active" && ageMinutes > slaMinutes * 0.8) {
      slaAtRiskCount++;
    }
  }

  return {
    activeCount: alerts.filter((a) => a.status === "active").length,
    acknowledgedCount: alerts.filter((a) => a.status === "acknowledged").length,
    resolvedCount: alerts.filter((a) => a.status === "resolved").length,
    criticalCount: alerts.filter((a) => a.severity === "critical").length,
    slaAtRiskCount,
    mttaMinutes: mttaCount > 0 ? Math.round(mttaSum / mttaCount) : null,
    mttrMinutes: mttrCount > 0 ? Math.round(mttrSum / mttrCount) : null,
    byService,
    bySeverity,
  };
}
