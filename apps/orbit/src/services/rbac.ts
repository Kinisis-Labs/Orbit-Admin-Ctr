import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Role {
  id: string;
  name: string;
  displayName: string;
  description: string | null;
  isSystem: boolean;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
}

export interface Permission {
  id: string;
  name: string;
  displayName: string;
  description: string | null;
  application: string;
  module: string;
  action: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
}

export interface RolePermission {
  id: string;
  name: string;
  displayName: string;
  application: string;
  module: string;
  action: string;
  mappingId: string;
}

export interface UserRole {
  id: string;
  name: string;
  displayName: string;
  assignmentId: string;
}

// ── Fetch helper ──────────────────────────────────────────────────────────────

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { message?: string }).message ?? `HTTP ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// ── Permission evaluation ─────────────────────────────────────────────────────

export function useMyPermissions() {
  return useQuery<{ permissions: string[] }>({
    queryKey: ["rbac", "my-permissions"],
    queryFn: () => apiFetch("/api/rbac/my-permissions"),
    staleTime: 60_000,
  });
}

// ── Roles ─────────────────────────────────────────────────────────────────────

export function useRoles() {
  return useQuery<Role[]>({
    queryKey: ["rbac", "roles"],
    queryFn: () => apiFetch("/api/rbac/roles"),
  });
}

export function useRolePermissions(roleId: string) {
  return useQuery<RolePermission[]>({
    queryKey: ["rbac", "roles", roleId, "permissions"],
    queryFn: () => apiFetch(`/api/rbac/roles/${roleId}/permissions`),
  });
}

export function useCreateRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string; displayName: string; description?: string }) =>
      apiFetch<Role>("/api/rbac/roles", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["rbac", "roles"] }),
  });
}

export function useUpdateRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: Partial<Role> & { id: string }) =>
      apiFetch<Role>(`/api/rbac/roles/${id}`, { method: "PUT", body: JSON.stringify(data) }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["rbac", "roles"] }),
  });
}

export function useDeleteRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/api/rbac/roles/${id}`, { method: "DELETE" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["rbac", "roles"] }),
  });
}

export function useAssignPermissionToRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ roleId, permissionId }: { roleId: string; permissionId: string }) =>
      apiFetch<RolePermission>(`/api/rbac/roles/${roleId}/permissions`, {
        method: "POST",
        body: JSON.stringify({ permissionId }),
      }),
    onSuccess: (_data, { roleId }) =>
      void qc.invalidateQueries({ queryKey: ["rbac", "roles", roleId, "permissions"] }),
  });
}

export function useRemovePermissionFromRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ roleId, mappingId }: { roleId: string; mappingId: string }) =>
      apiFetch<void>(`/api/rbac/roles/${roleId}/permissions/${mappingId}`, { method: "DELETE" }),
    onSuccess: (_data, { roleId }) =>
      void qc.invalidateQueries({ queryKey: ["rbac", "roles", roleId, "permissions"] }),
  });
}

// ── Permissions ───────────────────────────────────────────────────────────────

export function usePermissions() {
  return useQuery<Permission[]>({
    queryKey: ["rbac", "permissions"],
    queryFn: () => apiFetch("/api/rbac/permissions"),
  });
}

export function useCreatePermission() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      application: string;
      module: string;
      action: string;
      displayName?: string;
      description?: string;
    }) =>
      apiFetch<Permission>("/api/rbac/permissions", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["rbac", "permissions"] }),
  });
}

export function useUpdatePermission() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: Partial<Permission> & { id: string }) =>
      apiFetch<Permission>(`/api/rbac/permissions/${id}`, {
        method: "PUT",
        body: JSON.stringify(data),
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["rbac", "permissions"] }),
  });
}

export function useDeletePermission() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<void>(`/api/rbac/permissions/${id}`, { method: "DELETE" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["rbac", "permissions"] }),
  });
}

// ── User Roles ────────────────────────────────────────────────────────────────

export function useUserRoles(userId: string) {
  return useQuery<UserRole[]>({
    queryKey: ["rbac", "users", userId, "roles"],
    queryFn: () => apiFetch(`/api/rbac/users/${userId}/roles`),
    enabled: !!userId,
  });
}

export function useAssignRoleToUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, roleId }: { userId: string; roleId: string }) =>
      apiFetch<UserRole>(`/api/rbac/users/${userId}/roles`, {
        method: "POST",
        body: JSON.stringify({ roleId }),
      }),
    onSuccess: (_data, { userId }) =>
      void qc.invalidateQueries({ queryKey: ["rbac", "users", userId, "roles"] }),
  });
}

export function useRemoveRoleFromUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, assignmentId }: { userId: string; assignmentId: string }) =>
      apiFetch<void>(`/api/rbac/users/${userId}/roles/${assignmentId}`, { method: "DELETE" }),
    onSuccess: (_data, { userId }) =>
      void qc.invalidateQueries({ queryKey: ["rbac", "users", userId, "roles"] }),
  });
}
