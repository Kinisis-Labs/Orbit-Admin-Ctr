import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

// ── Types ─────────────────────────────────────────────────────────────────────

export type HealthStatus = "healthy" | "warning" | "critical" | "unknown";

export interface MetricResult {
  resourceId: string;
  resourceName: string;
  resourceType: string;
  metricName: string;
  value: number | null;
  unit: string;
  capturedAt: string;
}

export interface ResourceGroup {
  name: string;
  resourceType: string;
  health: HealthStatus;
  metrics: MetricResult[];
}

export interface InfrastructureSnapshot {
  overallHealth: HealthStatus;
  containerApps: ResourceGroup[];
  database: ResourceGroup[];
  network: ResourceGroup[];
  vpn: ResourceGroup[];
  api: ResourceGroup[];
  capturedAt: string;
}

export interface MetricSeriesPoint {
  t: string;
  v: number | null;
}

export interface MetricSeries {
  resourceName: string;
  resourceType: string;
  metricName: string;
  unit: string;
  points: MetricSeriesPoint[];
}

export interface InfrastructureHistory {
  hours: number;
  series: MetricSeries[];
  generatedAt: string;
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

async function fetchInfrastructureHistory(hours = 6): Promise<InfrastructureHistory> {
  const res = await fetch(`/api/noc/infrastructure/history?hours=${hours}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { message?: string }).message ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<InfrastructureHistory>;
}

export function useInfrastructureMetrics(refetchIntervalMs = 60_000) {
  return useQuery<InfrastructureSnapshot>({
    queryKey: ["noc-infrastructure"],
    queryFn: fetchInfrastructure,
    refetchInterval: refetchIntervalMs,
    retry: 1,
  });
}

export function useInfrastructureHistory(hours = 6, refetchIntervalMs = 120_000) {
  return useQuery<InfrastructureHistory>({
    queryKey: ["noc-infrastructure-history", hours],
    queryFn: () => fetchInfrastructureHistory(hours),
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

// ── Security NOC ──────────────────────────────────────────────────────────────

export interface SignInSummary {
  totalSignIns24h: number;
  failedSignIns24h: number;
  mfaFailureCount: number;
}

export interface RecentSignIn {
  id: string;
  createdAt: string;
  user: string;
  upn: string;
  ip: string;
  success: boolean;
  failureReason: string | null;
}

export interface SecurityEvent {
  id: string;
  source: string;
  type: string;
  severity: string;
  user: string | null;
  ip: string | null;
  detail: string;
  acknowledged: boolean;
  createdAt: string;
}

export interface SecuritySnapshot {
  graphConfigured: boolean;
  signInSummary: SignInSummary;
  recentSignIns: RecentSignIn[];
  securityEvents: SecurityEvent[];
  auditEvents: SecurityEvent[];
  capturedAt: string;
}

async function fetchSecurity(): Promise<SecuritySnapshot> {
  const res = await fetch("/api/noc/security");
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { message?: string }).message ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<SecuritySnapshot>;
}

export function useSecurityEvents(refetchIntervalMs = 60_000) {
  return useQuery<SecuritySnapshot>({
    queryKey: ["noc-security"],
    queryFn: fetchSecurity,
    refetchInterval: refetchIntervalMs,
    retry: 1,
  });
}

export function useAcknowledgeSecurityEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/noc/security/${encodeURIComponent(id)}/acknowledge`, {
        method: "PATCH",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["noc-security"] }),
  });
}

// ── AI NOC ────────────────────────────────────────────────────────────────────

export interface OpenAiMetrics {
  tokenUsage: number | null;
  promptTokens: number | null;
  completionTokens: number | null;
  avgLatencyMs: number | null;
  errorRate: number | null;
  totalRequests: number | null;
}

export interface AiSearchMetrics {
  documentCount: number | null;
  queryLatencyMs: number | null;
  throttledQueryPct: number | null;
  totalQueries: number | null;
}

export interface AiSnapshot {
  openAi: OpenAiMetrics;
  aiSearch: AiSearchMetrics;
  openAiConfigured: boolean;
  aiSearchConfigured: boolean;
  capturedAt: string;
}

async function fetchAi(): Promise<AiSnapshot> {
  const res = await fetch("/api/noc/ai");
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { message?: string }).message ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<AiSnapshot>;
}

export function useAiMetrics(refetchIntervalMs = 60_000) {
  return useQuery<AiSnapshot>({
    queryKey: ["noc-ai"],
    queryFn: fetchAi,
    refetchInterval: refetchIntervalMs,
    retry: 1,
  });
}

// ── Incident NOC ──────────────────────────────────────────────────────────────

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

export interface IncidentSnapshot {
  alerts: AzureAlert[];
  metrics: IncidentMetrics;
  azureConfigured: boolean;
  generatedAt: string;
}

export interface IncidentTrendPoint {
  date: string;
  count: number;
  resolved: number;
  mttaMinutes: number | null;
  mttrMinutes: number | null;
}

export interface IncidentTrend {
  days: number;
  trend: IncidentTrendPoint[];
  total: number;
  generatedAt: string;
}

async function fetchIncidents(): Promise<IncidentSnapshot> {
  const res = await fetch("/api/noc/incidents");
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { message?: string }).message ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<IncidentSnapshot>;
}

async function fetchIncidentTrend(days = 7): Promise<IncidentTrend> {
  const res = await fetch(`/api/noc/incidents/metrics?days=${days}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { message?: string }).message ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<IncidentTrend>;
}

export function useIncidents(refetchIntervalMs = 120_000) {
  return useQuery<IncidentSnapshot>({
    queryKey: ["noc-incidents"],
    queryFn: fetchIncidents,
    refetchInterval: refetchIntervalMs,
    retry: 1,
  });
}

export function useIncidentTrend(days = 7) {
  return useQuery<IncidentTrend>({
    queryKey: ["noc-incident-trend", days],
    queryFn: () => fetchIncidentTrend(days),
    refetchInterval: 300_000,
    retry: 1,
  });
}

// ── UX & Service Quality ───────────────────────────────────────────────────────

export interface PageLoadMetric {
  page: string;
  p50Ms: number | null;
  p95Ms: number | null;
  p99Ms: number | null;
  sessions: number | null;
}

export interface ApiLatencyRegion {
  region: string;
  avgMs: number | null;
  p95Ms: number | null;
  requestCount: number | null;
  failureRate: number | null;
}

export interface ErrorBucket {
  type: string;
  count: number;
  affectedUsers: number | null;
  sample: string | null;
}

export interface SyntheticResult {
  name: string;
  location: string;
  success: boolean;
  durationMs: number | null;
  lastRunAt: string | null;
}

export interface FailingJourney {
  journey: string;
  failureCount: number;
  affectedUsers: number | null;
  topError: string | null;
}

export interface UXSnapshot {
  portalLoadTimes: PageLoadMetric[];
  apiLatencyByRegion: ApiLatencyRegion[];
  errorDistribution: ErrorBucket[];
  syntheticResults: SyntheticResult[];
  failingJourneys: FailingJourney[];
  overallScore: number | null;
  capturedAt: string;
  appInsightsConfigured: boolean;
}

async function fetchUXSnapshot(): Promise<UXSnapshot> {
  const res = await fetch("/api/noc/ux", { credentials: "same-origin" });
  if (!res.ok) throw new Error(`UX fetch failed: ${res.status}`);
  return res.json() as Promise<UXSnapshot>;
}

export function useUXSnapshot(refetchIntervalMs = 120_000) {
  return useQuery<UXSnapshot>({
    queryKey: ["noc-ux"],
    queryFn: fetchUXSnapshot,
    refetchInterval: refetchIntervalMs,
    retry: 1,
  });
}

