import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { usePermission } from "../../../../hooks/usePermission";
import { DatasetDevelopmentStatus } from "../components/DatasetDevelopmentStatus";
import { ErrorState, LoadingState, Panel, StatusBadge } from "../components/Ui";

interface Category {
  id: string;
  displayName: string;
  categoryGroup: string | null;
  synchronizationEnabled: boolean;
  lastSuccessfulAt: string | null;
  setCount: number;
  itemCount: number;
  imageCount: number;
  missingImageCount: number;
  failedDownloadCount: number;
  apiRequestsToday: number;
  healthStatus: string;
  synchronizationError: string | null;
}

function idempotencyKey() {
  return `reference-category:${crypto.randomUUID()}`;
}

async function referenceApi<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/reference-datasets${path}`, {
    ...init,
    credentials: "same-origin",
    headers: {
      accept: "application/json",
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      typeof body === "object" && body !== null && "error" in body
        ? String((body as { error?: { message?: unknown } }).error?.message ?? "Request failed")
        : "Request failed";
    throw new Error(message);
  }
  return body as T;
}

export function CategoryManagementPage() {
  const canManage = usePermission("grailscan.corpus.reference.manage");
  const [categories, setCategories] = useState<Category[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [updating, setUpdating] = useState<string | null>(null);

  const load = async () => {
    setError(null);
    try {
      const response = await referenceApi<{ categories: Category[] }>(
        "/datasets/cardhedge-reference/categories",
      );
      setCategories(response.categories);
    } catch (requestError) {
      setError(requestError);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const run = async (category: Category, syncMode: "full" | "incremental") => {
    setUpdating(category.id);
    try {
      await referenceApi(`/datasets/cardhedge-reference/categories/${category.id}/runs`, {
        method: "POST",
        headers: { "idempotency-key": idempotencyKey() },
        body: JSON.stringify({ dryRun: false, syncMode }),
      });
      await load();
    } catch (requestError) {
      setError(requestError);
    } finally {
      setUpdating(null);
    }
  };

  const toggle = async (category: Category) => {
    setUpdating(category.id);
    try {
      await referenceApi(`/datasets/cardhedge-reference/categories/${category.id}`, {
        method: "PATCH",
        headers: { "idempotency-key": idempotencyKey() },
        body: JSON.stringify({ synchronizationEnabled: !category.synchronizationEnabled }),
      });
      await load();
    } catch (requestError) {
      setError(requestError);
    } finally {
      setUpdating(null);
    }
  };

  if (!categories && !error)
    return <LoadingState label="Loading discovered provider categories…" />;
  return (
    <div className="space-y-5">
      <DatasetDevelopmentStatus unavailable={Boolean(error)} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Category Management</h2>
          <p className="mt-1 text-sm text-[var(--orbit-text-secondary)]">
            Provider-discovered categories remain provider-neutral and can be enabled independently.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="flex items-center gap-1.5 rounded-lg border border-[var(--orbit-border)] px-3 py-2 text-sm"
        >
          <RefreshCw className="h-4 w-4" /> Refresh
        </button>
      </div>
      {Boolean(error) && <ErrorState error={error} retry={() => void load()} />}
      <Panel className="overflow-x-auto">
        <table className="w-full min-w-[1050px] text-left text-sm">
          <thead className="border-b border-[var(--orbit-border)] text-xs text-[var(--orbit-text-muted)]">
            <tr>
              {(
                [
                  "Category",
                  "Provider",
                  "Enabled",
                  "Sets",
                  "Items",
                  "Images",
                  "API today",
                  "Last sync",
                  "Health",
                  "",
                ] as const
              ).map((label) => (
                <th key={label} className="px-4 py-3 font-medium">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {categories?.map((category) => (
              <tr key={category.id} className="border-b border-[var(--orbit-border)] last:border-0">
                <td className="px-4 py-3">
                  <p className="font-medium">{category.displayName}</p>
                  <p className="text-xs text-[var(--orbit-text-muted)]">
                    {category.categoryGroup ?? "Unclassified"}
                  </p>
                </td>
                <td className="px-4 py-3">Card Hedge</td>
                <td className="px-4 py-3">
                  {category.synchronizationEnabled ? "Enabled" : "Disabled"}
                </td>
                <td className="px-4 py-3">{category.setCount}</td>
                <td className="px-4 py-3">{category.itemCount}</td>
                <td className="px-4 py-3">{category.imageCount}</td>
                <td className="px-4 py-3">{category.apiRequestsToday}</td>
                <td className="px-4 py-3 text-xs">
                  {category.lastSuccessfulAt
                    ? new Date(category.lastSuccessfulAt).toLocaleString()
                    : "Not yet synchronized"}
                </td>
                <td className="px-4 py-3">
                  <StatusBadge value={category.healthStatus} />
                </td>
                <td className="px-4 py-3">
                  {canManage && (
                    <div className="flex gap-1">
                      <button
                        type="button"
                        disabled={updating === category.id}
                        onClick={() => void toggle(category)}
                        className="rounded-md border border-[var(--orbit-border)] px-2 py-1 text-xs disabled:opacity-50"
                      >
                        {category.synchronizationEnabled ? "Disable" : "Enable"}
                      </button>
                      {category.synchronizationEnabled && (
                        <>
                          <button
                            type="button"
                            disabled={updating === category.id}
                            onClick={() => void run(category, "incremental")}
                            className="rounded-md border border-cyan-500/40 px-2 py-1 text-xs text-cyan-300 disabled:opacity-50"
                          >
                            Incremental
                          </button>
                          <button
                            type="button"
                            disabled={updating === category.id}
                            onClick={() => void run(category, "full")}
                            className="rounded-md border border-amber-500/40 px-2 py-1 text-xs text-amber-200 disabled:opacity-50"
                          >
                            Full
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {categories?.length === 0 && (
          <p className="p-10 text-center text-sm text-[var(--orbit-text-muted)]">
            No categories have been discovered. Run the catalog discovery synchronization to
            register every provider category.
          </p>
        )}
      </Panel>
    </div>
  );
}
