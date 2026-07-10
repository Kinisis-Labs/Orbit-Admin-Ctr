import { useQuery } from "@tanstack/react-query";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface MetricResult {
  resourceId: string;
  resourceName: string;
  resourceType: string;
  metricName: string;
  value: number | null;
  unit: string;
  capturedAt: string;
}

export interface InfrastructureSnapshot {
  azureConfigured: boolean;
  containerApps: MetricResult[];
  database: MetricResult[];
  storage: MetricResult[];
  appInsights: MetricResult[];
  capturedAt: string;
}

// ── Infrastructure NOC ────────────────────────────────────────────────────────

async function fetchInfrastructure(): Promise<InfrastructureSnapshot> {
  const res = await fetch("/api/noc/infrastructure");
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { message?: string }).message ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<InfrastructureSnapshot>;
}

export function useInfrastructureMetrics(refetchIntervalMs = 60_000) {
  return useQuery<InfrastructureSnapshot>({
    queryKey: ["noc-infrastructure"],
    queryFn: fetchInfrastructure,
    refetchInterval: refetchIntervalMs,
    retry: 1,
  });
}
