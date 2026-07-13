import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export interface AlertContactRow {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  smsEnabled: boolean;
  emailEnabled: boolean;
  severities: string[];
  createdAt: string;
  updatedAt: string;
}

export interface UpsertContactInput {
  name: string;
  email?: string;
  phone?: string;
  smsEnabled: boolean;
  emailEnabled: boolean;
  severities: string[];
}

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

export function useAlertContacts() {
  return useQuery<AlertContactRow[]>({
    queryKey: ["alert-contacts"],
    queryFn: () => apiFetch("/api/alert-contacts"),
  });
}

export function useCreateContact() {
  const qc = useQueryClient();
  return useMutation<AlertContactRow, Error, UpsertContactInput>({
    mutationFn: (data) => apiFetch("/api/alert-contacts", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["alert-contacts"] }),
  });
}

export function useUpdateContact() {
  const qc = useQueryClient();
  return useMutation<AlertContactRow, Error, { id: string } & Partial<UpsertContactInput>>({
    mutationFn: ({ id, ...data }) => apiFetch(`/api/alert-contacts/${id}`, { method: "PUT", body: JSON.stringify(data) }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["alert-contacts"] }),
  });
}

export function useDeleteContact() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (id) => apiFetch(`/api/alert-contacts/${id}`, { method: "DELETE" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["alert-contacts"] }),
  });
}

export function useTestContact() {
  return useMutation<{ sms: boolean; email: boolean }, Error, string>({
    mutationFn: (id) => apiFetch(`/api/alert-contacts/${id}/test`, { method: "POST" }),
  });
}
