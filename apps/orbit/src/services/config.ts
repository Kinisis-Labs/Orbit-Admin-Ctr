import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface GlobalConfigRow {
  id: string;
  key: string;
  value: string;
  description: string | null;
  isSecret: boolean;
  updatedBy: string | null;
  updatedAt: string;
  createdAt: string;
}

export interface FeatureFlagRow {
  name: string;
  enabled: boolean;
  description: string | null;
  updatedBy: string | null;
  updatedAt: string;
  createdAt: string;
}

export interface UpsertConfigInput {
  key: string;
  value: string;
  description?: string;
  isSecret?: boolean;
}

export interface UpsertFlagInput {
  name: string;
  enabled: boolean;
  description?: string;
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

// ── Config hooks ──────────────────────────────────────────────────────────────

export function useGlobalConfig() {
  return useQuery<GlobalConfigRow[]>({
    queryKey: ["config"],
    queryFn: () => apiFetch("/api/config"),
  });
}

export function useUpsertConfig() {
  const qc = useQueryClient();
  return useMutation<GlobalConfigRow, Error, UpsertConfigInput>({
    mutationFn: (data) =>
      apiFetch("/api/config", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["config"] }),
  });
}

export function useDeleteConfig() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (key) => apiFetch(`/api/config/${encodeURIComponent(key)}`, { method: "DELETE" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["config"] }),
  });
}

// ── Feature flag hooks ────────────────────────────────────────────────────────

export function useFeatureFlags() {
  return useQuery<FeatureFlagRow[]>({
    queryKey: ["config", "flags"],
    queryFn: () => apiFetch("/api/config/flags"),
  });
}

export function useUpsertFlag() {
  const qc = useQueryClient();
  return useMutation<FeatureFlagRow, Error, UpsertFlagInput>({
    mutationFn: (data) =>
      apiFetch("/api/config/flags", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["config", "flags"] }),
  });
}

export function useDeleteFlag() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (name) =>
      apiFetch(`/api/config/flags/${encodeURIComponent(name)}`, { method: "DELETE" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["config", "flags"] }),
  });
}
