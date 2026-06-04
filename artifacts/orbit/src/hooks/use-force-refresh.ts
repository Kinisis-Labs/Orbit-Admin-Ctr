import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

export const FORCE_REFRESH_COOLDOWN_MS = 30_000;

export function useForceRefresh(url: string, queryKey: readonly unknown[]) {
  const queryClient = useQueryClient();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<number | null>(null);

  useEffect(() => {
    if (!lastRefreshedAt) return;
    const id = setTimeout(() => setLastRefreshedAt(null), FORCE_REFRESH_COOLDOWN_MS);
    return () => clearTimeout(id);
  }, [lastRefreshedAt]);

  const isCoolingDown = lastRefreshedAt !== null;

  const forceRefresh = async () => {
    if (isRefreshing || isCoolingDown) return;
    setIsRefreshing(true);
    try {
      const res = await fetch(`${url}?refresh=true`, { credentials: "same-origin" });
      if (res.ok) {
        const data: unknown = await res.json();
        queryClient.setQueryData([...queryKey], data);
      }
    } finally {
      setIsRefreshing(false);
      setLastRefreshedAt(Date.now());
    }
  };

  return { isRefreshing, isCoolingDown, forceRefresh };
}
