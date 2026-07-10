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

// ── Application NOC ───────────────────────────────────────────────────────────

export interface AppTelemetry {
  availability: number | null;
  avgResponseMs: number | null;
  failedRequests: number | null;
  totalRequests: number | null;
  exceptions: number | null;
  activeSessions: number | null;
  authFailures: number | null;
}

export type AppStatus = "healthy" | "degraded" | "unhealthy" | "unknown";

export interface AppNocEntry {
  slug: string;
  displayName: string;
  category: string;
  url: string | null;
  status: AppStatus;
  telemetry: AppTelemetry;
  appInsightsConfigured: boolean;
}

export interface AppNocDetail extends AppNocEntry {
  description: string | null;
  capturedAt: string;
}

export interface ApplicationsSnapshot {
  apps: AppNocEntry[];
  capturedAt: string;
}

async function fetchApplications(): Promise<ApplicationsSnapshot> {
  const res = await fetch("/api/noc/applications");
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { message?: string }).message ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<ApplicationsSnapshot>;
}

async function fetchApplicationDetail(slug: string): Promise<AppNocDetail> {
  const res = await fetch(`/api/noc/applications/${encodeURIComponent(slug)}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { message?: string }).message ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<AppNocDetail>;
}

export function useApplicationMetrics(refetchIntervalMs = 60_000) {
  return useQuery<ApplicationsSnapshot>({
    queryKey: ["noc-applications"],
    queryFn: fetchApplications,
    refetchInterval: refetchIntervalMs,
    retry: 1,
  });
}

export function useApplicationDetail(slug: string) {
  return useQuery<AppNocDetail>({
    queryKey: ["noc-application", slug],
    queryFn: () => fetchApplicationDetail(slug),
    refetchInterval: 60_000,
    retry: 1,
    enabled: !!slug,
  });
}
