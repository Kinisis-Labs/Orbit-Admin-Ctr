import { useQuery } from "@tanstack/react-query";

// ── Types ─────────────────────────────────────────────────────────────────────

export type AuditCategory = "auth" | "rbac" | "application" | "configuration" | "admin";
export type AuditOutcome = "success" | "failure" | "denied";

export interface AuditLogRow {
  id: string;
  actorId: string | null;
  actorName: string | null;
  actorUpn: string | null;
  action: string;
  category: AuditCategory;
  outcome: AuditOutcome;
  entityType: string | null;
  entityId: string | null;
  entityName: string | null;
  detail: Record<string, unknown> | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}

export interface AuditResponse {
  rows: AuditLogRow[];
  total: number;
  limit: number;
  offset: number;
}

export interface AuditFilters {
  search?: string;
  category?: AuditCategory | "";
  outcome?: AuditOutcome | "";
  action?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

// ── Fetch helper ──────────────────────────────────────────────────────────────

async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { "Content-Type": "application/json" } });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { message?: string }).message ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ── Hooks ─────────────────────────────────────────────────────────────────────

export function useAuditLog(filters: AuditFilters = {}) {
  const params = new URLSearchParams();
  if (filters.search) params.set("search", filters.search);
  if (filters.category) params.set("category", filters.category);
  if (filters.outcome) params.set("outcome", filters.outcome);
  if (filters.action) params.set("action", filters.action);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (filters.limit) params.set("limit", String(filters.limit));
  if (filters.offset) params.set("offset", String(filters.offset));

  const qs = params.toString();
  return useQuery<AuditResponse>({
    queryKey: ["audit", filters],
    queryFn: () => apiFetch(`/api/audit${qs ? `?${qs}` : ""}`),
    refetchInterval: 30_000,
  });
}
