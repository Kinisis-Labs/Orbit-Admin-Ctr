import { useListAlertConfig } from "@workspace/api-client-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Settings2 } from "lucide-react";

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
                <TableHead className="h-8 font-semibold text-foreground w-[220px]">Memory threshold</TableHead>
                <TableHead className="h-8 font-semibold text-foreground w-[180px]">Consecutive checks</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows?.map((row) => (
                <TableRow key={row.appId} className="h-9 border-b border-border/50 hover:bg-muted/40">
                  {!appId && (
                    <TableCell className="py-1 font-medium">{row.appName}</TableCell>
                  )}
                  <TableCell className="py-1">
                    <ThresholdCell value={row.cpuThresholdPct} isOverride={row.cpuIsOverride} />
                  </TableCell>
                  <TableCell className="py-1">
                    <ThresholdCell value={row.memoryThresholdPct} isOverride={row.memoryIsOverride} />
                  </TableCell>
                  <TableCell className="py-1 tabular-nums text-muted-foreground text-[12px]">
                    {row.consecutiveChecks} check{row.consecutiveChecks === 1 ? "" : "s"}
                  </TableCell>
                </TableRow>
              ))}
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
          <span className="inline-flex items-center gap-1">
            <span className="inline-flex items-center px-1 py-px rounded-sm border border-border bg-muted/40 text-muted-foreground text-[10px] font-semibold uppercase tracking-wide">default</span>
            — global or built-in default applies
          </span>
        </p>
      </div>
    </div>
  );
}
