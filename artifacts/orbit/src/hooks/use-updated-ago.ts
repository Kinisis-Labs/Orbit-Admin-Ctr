import { useEffect, useState } from "react";

function formatSecondsAgo(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

export function useUpdatedAgo(dataUpdatedAt: number): string | null {
  const [, setTick] = useState(0);

  useEffect(() => {
    if (dataUpdatedAt <= 0) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [dataUpdatedAt]);

  if (dataUpdatedAt <= 0) return null;
  return formatSecondsAgo(Date.now() - dataUpdatedAt);
}
