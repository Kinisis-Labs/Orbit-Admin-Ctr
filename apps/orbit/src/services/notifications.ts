import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

// ── Types ─────────────────────────────────────────────────────────────────────

export type NotificationType = "info" | "warning" | "error" | "success" | "announcement";

export interface NotificationRow {
  id: string;
  userId: string | null;
  title: string;
  body: string;
  type: NotificationType;
  actionUrl: string | null;
  read: boolean;
  readAt: string | null;
  createdBy: string | null;
  createdAt: string;
  expiresAt: string | null;
}

export interface CreateNotificationInput {
  title: string;
  body: string;
  type?: NotificationType;
  userId?: string;
  actionUrl?: string;
  expiresAt?: string;
}

// ── Fetch helpers ─────────────────────────────────────────────────────────────

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

// ── User hooks ────────────────────────────────────────────────────────────────

export function useNotifications() {
  return useQuery<NotificationRow[]>({
    queryKey: ["notifications"],
    queryFn: () => apiFetch("/api/notifications"),
    refetchInterval: 30_000,
  });
}

export function useUnreadCount() {
  return useQuery<{ count: number }>({
    queryKey: ["notifications", "unread-count"],
    queryFn: () => apiFetch("/api/notifications/unread-count"),
    refetchInterval: 30_000,
  });
}

export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (id) => apiFetch(`/api/notifications/${id}/read`, { method: "POST" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
}

export function useMarkAllRead() {
  const qc = useQueryClient();
  return useMutation<void, Error, void>({
    mutationFn: () => apiFetch("/api/notifications/read-all", { method: "POST" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
}

// ── Admin hooks ───────────────────────────────────────────────────────────────

export function useAdminNotifications() {
  return useQuery<NotificationRow[]>({
    queryKey: ["admin", "notifications"],
    queryFn: () => apiFetch("/api/admin/notifications"),
  });
}

export function useCreateNotification() {
  const qc = useQueryClient();
  return useMutation<NotificationRow, Error, CreateNotificationInput>({
    mutationFn: (data) =>
      apiFetch("/api/admin/notifications", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin", "notifications"] });
      void qc.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
}

export function useDeleteNotification() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (id) => apiFetch(`/api/admin/notifications/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin", "notifications"] });
    },
  });
}
