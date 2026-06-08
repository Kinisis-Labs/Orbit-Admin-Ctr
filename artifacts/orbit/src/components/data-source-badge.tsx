import { AlertTriangle, Database, Wifi } from "lucide-react";

export function LiveBadge({ label = "Live", className }: { label?: string; className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm border border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[10px] font-semibold uppercase tracking-wide${className ? ` ${className}` : ""}`}
    >
      <Wifi className="h-3 w-3" />
      {label}
    </span>
  );
}

export function DemoBadge({ className }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded-sm border border-border bg-muted text-muted-foreground text-[10px] font-semibold uppercase tracking-wide${className ? ` ${className}` : ""}`}
    >
      Demo
    </span>
  );
}

const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

function fmtDataAsOf(iso: string | undefined | null): string | null {
  if (!iso) return null;
  try {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(new Date(iso));
  } catch {
    return null;
  }
}

interface DataSourceBadgeProps {
  dataSource: "live" | "cached" | "mock" | "placeholder" | "none" | undefined;
  dataAsOf?: string | null;
  label?: string;
}

export function DataSourceBadge({
  dataSource,
  dataAsOf,
  label = "Azure Monitor",
}: DataSourceBadgeProps) {
  if (!dataSource) return null;

  if (dataSource === "live") {
    const asOf = fmtDataAsOf(dataAsOf);
    const isStale = dataAsOf
      ? Date.now() - new Date(dataAsOf).getTime() > STALE_THRESHOLD_MS
      : false;
    return (
      <span className="inline-flex items-center gap-1.5 select-none flex-wrap">
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm border border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[10px] font-semibold uppercase tracking-wide">
          <Wifi className="h-3 w-3" />
          Live — {label}
        </span>
        {asOf && (
          <span
            className={
              isStale
                ? "inline-flex items-center gap-0.5 text-[10px] text-amber-600 dark:text-amber-400"
                : "text-[10px] text-muted-foreground"
            }
          >
            {isStale && <AlertTriangle className="h-3 w-3" />}
            as of {asOf}
          </span>
        )}
      </span>
    );
  }

  if (dataSource === "cached") {
    const asOf = fmtDataAsOf(dataAsOf);
    return (
      <span className="inline-flex items-center gap-1.5 select-none flex-wrap">
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm border border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400 text-[10px] font-semibold uppercase tracking-wide">
          <Database className="h-3 w-3" />
          Cached — DB snapshot
        </span>
        {asOf && (
          <span className="inline-flex items-center gap-0.5 text-[10px] text-amber-600 dark:text-amber-400">
            <AlertTriangle className="h-3 w-3" />
            as of {asOf}
          </span>
        )}
      </span>
    );
  }

  if (dataSource === "mock" || dataSource === "placeholder") {
    return <DemoBadge />;
  }

  return null;
}
