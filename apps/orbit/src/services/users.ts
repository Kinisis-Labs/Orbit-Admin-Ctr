import { useQuery } from "@tanstack/react-query";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface UserSummary {
  id: string;
  displayName: string;
  userPrincipalName: string;
  jobTitle: string;
  isAdmin: boolean;
  isEngineer: boolean;
  groupCount: number;
}

export interface UserDetail {
  id: string;
  displayName: string;
  userPrincipalName: string;
  jobTitle: string;
  isAdmin: boolean;
  isEngineer: boolean;
  groupIds: string[];
  assignedRoles: { id: string; name: string; displayName: string; assignmentId: string }[];
  effectivePermissions: string[];
  authorizedApplications: {
    id: string;
    slug: string;
    displayName: string;
    url: string | null;
    category: string;
  }[];
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

export function useUsers() {
  return useQuery<UserSummary[]>({
    queryKey: ["users"],
    queryFn: () => apiFetch("/api/users"),
  });
}

export function useUserDetail(userId: string) {
  return useQuery<UserDetail>({
    queryKey: ["users", userId],
    queryFn: () => apiFetch(`/api/users/${userId}`),
    enabled: !!userId,
  });
}
