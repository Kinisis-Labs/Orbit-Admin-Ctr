import { useListAlertConfig, getGetInfrastructureQueryOptions } from "@workspace/api-client-react";
import type { InfrastructureReport, MetricSeries } from "@workspace/api-client-react";
import { useQueries } from "@tanstack/react-query";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Settings2 } from "lucide-react";

function getLatestValue(report: InfrastructureReport | undefined, seriesName: string): number | null {
  if (!report) return null;
  const series = report.series.find((s: MetricSeries) => s.name === seriesName);
  if (!series || series.points.length === 0) return null;
  const sorted = [...series.points].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );
  return sorted[0].value;
}

function utilizationStatus(current: number, threshold: number): "critical" | "warning" | "ok" {
  if (current >= threshold) return "critical";
  if (current >= threshold * 0.85) return "warning";
  return "ok";
}

const STATUS_COLORS = {
  critical: {
    bar: "bg-red-500",
    text: "text-red-600 dark:text-red-400",
    badge: "border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400",
  },
  warning: {
    bar: "bg-amber-400",
    text: "text-amber-600 dark:text-amber-400",
    badge: "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  },
  ok: {
    bar: "bg-emerald-500",
    text: "text-emerald-600 dark:text-emerald-400",
    badge: "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  },
};

function UtilizationIndicator({
  current,
  threshold,
  loading,
}: {
  current: number | null;
  threshold: number;
  loading: boolean;
}) {
  if (loading) {
    return <Skeleton className="h-4 w-24" />;
  }

  if (current === null) {
    return <span className="text-[11px] text-muted-foreground">—</span>;
  }

  const status = utilizationStatus(current, threshold);
  const colors = STATUS_COLORS[status];
  const barWidthPct = Math.min((current / threshold) * 100, 100);
  const delta = threshold - current;

  return (
    <div className="flex flex-col gap-1 min-w-[120px]">
      <div className="flex items-center gap-1.5">
        <span className={`tabular-nums font-mono text-[12px] font-semibold ${colors.text}`}>
          {current.toFixed(1)}%
        </span>
        {status === "critical" ? (
          <span className={`inline-flex items-center px-1 py-px rounded-sm border text-[10px] font-semibold uppercase tracking-wide ${colors.badge}`}>
            over threshold
          </span>
        ) : (
          <span className="text-[11px] text-muted-foreground">
            {delta.toFixed(1)}% below
          </span>
        )}
      </div>
      <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${colors.bar}`}
          style={{ width: `${barWidthPct}%` }}
        />
      </div>
    </div>
  );
}

function ThresholdCell({ value, isOverride }: { value: number; isOverride: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="tabular-nums font-mono text-[12px]">{value}%</span>
      {isOverride ? (
        <span className="inline-flex items-center px-1.5 py-0.5 rounded-sm border border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400 text-[10px] font-semibold uppercase tracking-wide">
          override
        </span>
      ) : (
        <span className="inline-flex items-center px-1.5 py-0.5 rounded-sm border border-border bg-muted/40 text-muted-foreground text-[10px] font-semibold uppercase tracking-wide">
          default
        </span>
      )}
    </span>
  );
}

interface Props {
  appId?: string;
}

export function AlertConfigTable({ appId }: Props) {
  const { data, isLoading } = useListAlertConfig();

  const rows = appId ? data?.filter((r) => r.appId === appId) : data;

  const infraQueries = useQueries({
    queries: (rows ?? []).map((row) =>
      getGetInfrastructureQueryOptions(row.appId)
    ),
  });

  return (
    <div className="bg-card border border-border shadow-sm flex flex-col">
      <div className="flex items-center gap-2 p-3 border-b border-border">
        <Settings2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <h2 className="text-sm font-semibold">Infra alert thresholds</h2>
        <span className="ml-auto text-[11px] text-muted-foreground">
          {!isLoading && rows !== undefined
            ? `${rows.length} app${rows.length === 1 ? "" : "s"}`
            : ""}
        </span>
      </div>

      {isLoading ? (
        <div className="p-4 space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <Table className="text-[13px]">
            <TableHeader className="bg-muted/50 border-b border-border">
              <TableRow className="hover:bg-transparent">
                {!appId && (
                  <TableHead className="h-8 font-semibold text-foreground">App</TableHead>
                )}
                <TableHead className="h-8 font-semibold text-foreground w-[220px]">CPU threshold</TableHead>
                <TableHead className="h-8 font-semibold text-foreground w-[200px]">Current CPU</TableHead>
                <TableHead className="h-8 font-semibold text-foreground w-[220px]">Memory threshold</TableHead>
                <TableHead className="h-8 font-semibold text-foreground w-[200px]">Current memory</TableHead>
                <TableHead className="h-8 font-semibold text-foreground w-[180px]">Consecutive checks</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows?.map((row, i) => {
                const infraData = infraQueries[i]?.data as InfrastructureReport | undefined;
                const infraLoading = infraQueries[i]?.isLoading ?? false;
                const currentCpu = getLatestValue(infraData, "CPU %");
                const currentMem = getLatestValue(infraData, "Memory %");

                return (
                  <TableRow key={row.appId} className="h-12 border-b border-border/50 hover:bg-muted/40">
                    {!appId && (
                      <TableCell className="py-1 font-medium">{row.appName}</TableCell>
                    )}
                    <TableCell className="py-1">
                      <ThresholdCell value={row.cpuThresholdPct} isOverride={row.cpuIsOverride} />
                    </TableCell>
                    <TableCell className="py-1.5">
                      <UtilizationIndicator
                        current={currentCpu}
                        threshold={row.cpuThresholdPct}
                        loading={infraLoading}
                      />
                    </TableCell>
                    <TableCell className="py-1">
                      <ThresholdCell value={row.memoryThresholdPct} isOverride={row.memoryIsOverride} />
                    </TableCell>
                    <TableCell className="py-1.5">
                      <UtilizationIndicator
                        current={currentMem}
                        threshold={row.memoryThresholdPct}
                        loading={infraLoading}
                      />
                    </TableCell>
                    <TableCell className="py-1 tabular-nums text-muted-foreground text-[12px]">
                      {row.consecutiveChecks} check{row.consecutiveChecks === 1 ? "" : "s"}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <div className="px-3 py-2 border-t border-border bg-muted/20">
        <p className="text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1 mr-2">
            <span className="inline-flex items-center px-1 py-px rounded-sm border border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400 text-[10px] font-semibold uppercase tracking-wide">override</span>
            — per-app env var is set
          </span>
          <span className="inline-flex items-center gap-1 mr-4">
            <span className="inline-flex items-center px-1 py-px rounded-sm border border-border bg-muted/40 text-muted-foreground text-[10px] font-semibold uppercase tracking-wide">default</span>
            — global or built-in default applies
          </span>
          <span className="inline-flex items-center gap-1.5 mr-3">
            <span className="h-2 w-2 rounded-full bg-emerald-500 inline-block" />
            <span>&gt;15% below threshold</span>
          </span>
          <span className="inline-flex items-center gap-1.5 mr-3">
            <span className="h-2 w-2 rounded-full bg-amber-400 inline-block" />
            <span>within 15% of threshold</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-red-500 inline-block" />
            <span>at or above threshold</span>
          </span>
        </p>
      </div>
    </div>
  );
}
