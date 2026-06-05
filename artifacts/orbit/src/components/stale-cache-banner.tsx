import { WifiOff } from "lucide-react";

export const STALE_CACHE_HOURS = 4;
export const STALE_CACHE_MS = STALE_CACHE_HOURS * 60 * 60 * 1000;

export function fmtStaleCacheAsOf(iso: string | undefined | null): string | null {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(d);
  } catch {
    return null;
  }
}

export function StaleCacheBanner({
  dataSource,
  dataAsOf,
}: {
  dataSource: "live" | "cached" | "mock" | undefined;
  dataAsOf?: string | null;
}) {
  if (dataSource !== "cached" || !dataAsOf) return null;
  const ageMs = Date.now() - new Date(dataAsOf).getTime();
  if (ageMs <= STALE_CACHE_MS) return null;
  const ageHours = Math.floor(ageMs / (60 * 60 * 1000));
  const asOf = fmtStaleCacheAsOf(dataAsOf);
  return (
    <div className="flex items-start gap-3 px-3 py-2.5 rounded-sm border border-orange-500/50 bg-orange-500/10 text-orange-800 dark:text-orange-300">
      <WifiOff className="h-4 w-4 mt-0.5 shrink-0 text-orange-500" />
      <div className="flex-1 min-w-0 text-[13px] leading-snug">
        <span className="font-semibold">Azure Cost Management unreachable — </span>
        <span>
          Figures shown are from the last known snapshot
          {asOf ? <>, captured <span className="font-semibold">{asOf}</span></> : null}.
          {" "}Data is approximately{" "}
          <span className="font-semibold">{ageHours} hour{ageHours !== 1 ? "s" : ""} old</span>
          {" "}— live costs may differ.
        </span>
      </div>
    </div>
  );
}
