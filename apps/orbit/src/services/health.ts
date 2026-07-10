import { useQuery } from "@tanstack/react-query";

// ── Types ─────────────────────────────────────────────────────────────────────

export type HealthStatus = "healthy" | "degraded" | "unhealthy" | "unknown";

export interface HistoryPoint {
  status: HealthStatus;
  latencyMs: number;
  checkedAt: string;
}

export interface ServiceCheck {
  name: string;
  status: HealthStatus;
  latencyMs?: number;
  message?: string;
  httpStatus?: number;
  timedOut?: boolean;
  history: HistoryPoint[];
  checkedAt: string;
}

export interface PlatformHealthReport {
  overall: HealthStatus;
  orbit: ServiceCheck;
  database: ServiceCheck;
  applications: ServiceCheck[];
  checkedAt: string;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

async function fetchPlatformHealth(): Promise<PlatformHealthReport> {
  const res = await fetch("/api/health/platform");
  if (!res.ok && res.status !== 503 && res.status !== 207) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { message?: string }).message ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<PlatformHealthReport>;
}

export function usePlatformHealth(refetchIntervalMs = 30_000) {
  return useQuery<PlatformHealthReport>({
    queryKey: ["platform-health"],
    queryFn: fetchPlatformHealth,
    refetchInterval: refetchIntervalMs,
    retry: 1,
  });
}
