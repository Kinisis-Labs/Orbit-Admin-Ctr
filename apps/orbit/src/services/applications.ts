import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export interface Application {
  id: string;
  slug: string;
  displayName: string;
  description: string | null;
  logoUrl: string | null;
  url: string | null;
  healthCheckUrl: string | null;
  appInsightsConnectionString: string | null;
  category: string;
  tags: string[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
}

export interface EntraGroupMapping {
  id: string;
  applicationId: string;
  entraGroupId: string;
  entraGroupName: string | null;
  createdAt: string;
  createdBy: string | null;
}

export interface ApplicationWithMappings extends Application {
  groupMappings: EntraGroupMapping[];
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

export function useApplications() {
  return useQuery<Application[]>({
    queryKey: ["applications"],
    queryFn: () => apiFetch("/api/applications"),
  });
}

export function useAllApplications() {
  return useQuery<ApplicationWithMappings[]>({
    queryKey: ["applications", "all"],
    queryFn: () => apiFetch("/api/applications/all"),
  });
}

export function useCreateApplication() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<Application>) =>
      apiFetch<Application>("/api/applications", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["applications"] });
    },
  });
}

export function useUpdateApplication() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: Partial<Application> & { id: string }) =>
      apiFetch<Application>(`/api/applications/${id}`, {
        method: "PUT",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["applications"] });
    },
  });
}

export function useDeleteApplication() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<void>(`/api/applications/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["applications"] });
    },
  });
}

export function useApplicationGroupMappings(applicationId: string) {
  return useQuery<EntraGroupMapping[]>({
    queryKey: ["applications", applicationId, "groups"],
    queryFn: () => apiFetch(`/api/applications/${applicationId}/groups`),
  });
}

export function useAddGroupMapping() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      applicationId,
      entraGroupId,
      entraGroupName,
    }: {
      applicationId: string;
      entraGroupId: string;
      entraGroupName?: string;
    }) =>
      apiFetch<EntraGroupMapping>(`/api/applications/${applicationId}/groups`, {
        method: "POST",
        body: JSON.stringify({ entraGroupId, entraGroupName }),
      }),
    onSuccess: (_data, { applicationId }) => {
      void qc.invalidateQueries({ queryKey: ["applications", applicationId, "groups"] });
      void qc.invalidateQueries({ queryKey: ["applications", "all"] });
    },
  });
}

export function useRemoveGroupMapping() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      applicationId,
      mappingId,
    }: {
      applicationId: string;
      mappingId: string;
    }) =>
      apiFetch<void>(`/api/applications/${applicationId}/groups/${mappingId}`, {
        method: "DELETE",
      }),
    onSuccess: (_data, { applicationId }) => {
      void qc.invalidateQueries({ queryKey: ["applications", applicationId, "groups"] });
      void qc.invalidateQueries({ queryKey: ["applications", "all"] });
    },
  });
}
