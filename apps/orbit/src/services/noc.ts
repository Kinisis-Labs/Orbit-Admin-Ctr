import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

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

// ── Cost NOC ──────────────────────────────────────────────────────────────────

export interface CostByService {
  serviceName: string;
  cost: number;
  currency: string;
}

export interface BudgetInfo {
  name: string;
  limit: number;
  currentSpend: number;
  currency: string;
  utilizationPct: number;
  forecastedSpend: number | null;
}

export interface M365ProductCost {
  productName: string;
  publisherName: string;
  cost: number;
  currency: string;
}

export interface M365CostSummary {
  totalMtdCost: number | null;
  totalYtdCost: number | null;
  currency: string;
  topProducts: M365ProductCost[];
  billingConfigured: boolean;
}

export interface SubscriptionCost {
  subscriptionId: string;
  label: string;
  totalMtdCost: number | null;
  totalYtdCost: number | null;
  currency: string;
  topServices: CostByService[];
  budget: BudgetInfo | null;
}

export interface CostSnapshot {
  subscriptions: SubscriptionCost[];
  subscriptionConfigured: boolean;
  m365: M365CostSummary;
  capturedAt: string;
}

async function fetchCost(): Promise<CostSnapshot> {
  const res = await fetch("/api/noc/cost");
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { message?: string }).message ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<CostSnapshot>;
}

export function useCostMetrics(refetchIntervalMs = 300_000) {
  return useQuery<CostSnapshot>({
    queryKey: ["noc-cost"],
    queryFn: fetchCost,
    refetchInterval: refetchIntervalMs,
    retry: 1,
  });
}
