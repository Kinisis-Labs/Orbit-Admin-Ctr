import { useEffect, useRef, useState } from "react";
import {
  useListAlertConfig,
  useUpdateAlertConfig,
  getListAlertConfigQueryKey,
  getGetInfrastructureQueryOptions,
} from "@workspace/api-client-react";
import type { AppAlertConfig, InfrastructureReport, MetricSeries } from "@workspace/api-client-react";
import { useQueryClient, useQueries } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Check, Pencil, RefreshCw, RotateCcw, Settings2, X, ArrowRight } from "lucide-react";
import { useAuth, ADMIN_GROUP } from "@/lib/auth";
import { cn } from "@/lib/utils";

const REFETCH_INTERVAL_MS = 60_000;

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
    text: "text-muted-foreground",
    badge: "border-border bg-muted/40 text-muted-foreground",
  },
};

function useSecondsTicker(intervalMs = 1000) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return tick;
}

function formatSecondsAgo(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

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
    return <span className="text-[11px] text-muted-foreground opacity-40">—</span>;
  }
  const status = utilizationStatus(current, threshold);
  const colors = STATUS_COLORS[status];
  const barWidthPct = Math.min(100, (current / threshold) * 100);
  const delta = threshold - current;

  return (
    <div className="flex flex-col gap-0.5 min-w-[80px]">
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

// ---------------------------------------------------------------------------
// Editable threshold helpers
// ---------------------------------------------------------------------------

type ThresholdField = "cpuThresholdPct" | "memoryThresholdPct" | "consecutiveChecks";

function SourceBadge({ source }: { source: "db" | "env" | "default" | undefined }) {
  if (source === "db") {
    return (
      <span className="inline-flex items-center px-1.5 py-0.5 rounded-sm border border-blue-500/40 bg-blue-500/10 text-blue-600 dark:text-blue-400 text-[10px] font-semibold uppercase tracking-wide">
        db
      </span>
    );
  }
  if (source === "env") {
    return (
      <span className="inline-flex items-center px-1.5 py-0.5 rounded-sm border border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400 text-[10px] font-semibold uppercase tracking-wide">
        env
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded-sm border border-border bg-muted/40 text-muted-foreground text-[10px] font-semibold uppercase tracking-wide">
      default
    </span>
  );
}

interface EditableCellProps {
  appId: string;
  field: ThresholdField;
  value: number;
  source: "db" | "env" | "default" | undefined;
  isPercent?: boolean;
  canEdit: boolean;
  onSaved: () => void;
}

function EditableCell({ appId, field, value, source, isPercent = false, canEdit, onSaved }: EditableCellProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { mutateAsync } = useUpdateAlertConfig();

  function startEdit() {
    setDraft(String(value));
    setError(null);
    setEditing(true);
    setTimeout(() => inputRef.current?.select(), 0);
  }

  function cancelEdit() {
    setEditing(false);
    setError(null);
  }

  async function save(newValue: number | null) {
    setSaving(true);
    setError(null);
    try {
      await mutateAsync({ appId, data: { [field]: newValue } });
      setEditing(false);
      onSaved();
    } catch {
      setError("Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function commitDraft() {
    const parsed = Number(draft);
    if (!Number.isFinite(parsed) || parsed < 1 || (isPercent && parsed > 100)) {
      setError(isPercent ? "Must be 1–100" : "Must be ≥ 1");
      return;
    }
    await save(Math.round(parsed));
  }

  if (editing) {
    return (
      <span className="inline-flex items-center gap-1">
        <input
          ref={inputRef}
          type="number"
          min={1}
          max={isPercent ? 100 : undefined}
          value={draft}
          onChange={(e) => { setDraft(e.target.value); setError(null); }}
          onKeyDown={(e) => {
            if (e.key === "Enter") void commitDraft();
            if (e.key === "Escape") cancelEdit();
          }}
          onBlur={() => { if (!saving) void commitDraft(); }}
          disabled={saving}
          className={cn(
            "w-16 h-6 px-1.5 text-[12px] font-mono tabular-nums bg-background border rounded text-foreground focus:outline-none focus:ring-1 focus:ring-ring",
            error ? "border-destructive" : "border-border",
          )}
          autoFocus
        />
        {isPercent && <span className="text-[11px] text-muted-foreground">%</span>}
        {saving ? (
          <span className="text-[11px] text-muted-foreground">saving…</span>
        ) : (
          <>
            <button
              type="button"
              onMouseDown={(e) => { e.preventDefault(); void commitDraft(); }}
              className="text-green-600 dark:text-green-400 hover:opacity-80"
              aria-label="Confirm"
            >
              <Check className="h-3 w-3" />
            </button>
            <button
              type="button"
              onMouseDown={(e) => { e.preventDefault(); cancelEdit(); }}
              className="text-muted-foreground hover:opacity-80"
              aria-label="Cancel"
            >
              <X className="h-3 w-3" />
            </button>
          </>
        )}
        {error && <span className="text-[10px] text-destructive">{error}</span>}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 group/cell">
      <span className="tabular-nums font-mono text-[12px]">
        {value}{isPercent ? "%" : ""}
      </span>
      <SourceBadge source={source} />
      {canEdit && (
        <span className="inline-flex items-center gap-0.5 opacity-0 group-hover/cell:opacity-100 transition-opacity">
          <button
            type="button"
            onClick={startEdit}
            className="text-muted-foreground hover:text-foreground transition-colors"
            aria-label={`Edit ${field}`}
          >
            <Pencil className="h-2.5 w-2.5" />
          </button>
          {source === "db" && (
            <button
              type="button"
              onClick={() => void save(null)}
              className="text-muted-foreground hover:text-amber-600 dark:hover:text-amber-400 transition-colors"
              aria-label="Reset to env/default"
              title="Reset to env-var / global default"
            >
              <RotateCcw className="h-2.5 w-2.5" />
            </button>
          )}
        </span>
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Main table
// ---------------------------------------------------------------------------

interface Props {
  appId?: string;
}

function formatUpdatedAt(iso: string | null | undefined): string | null {
  if (!iso) return null;
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(iso));
  } catch {
    return null;
  }
}

export function AlertConfigTable({ appId }: Props) {
  const { data, isLoading } = useListAlertConfig();
  const queryClient = useQueryClient();
  const { hasGroup } = useAuth();
  const canEdit = hasGroup(ADMIN_GROUP.id);
  const [, navigate] = useLocation();

  const rows = appId ? data?.filter((r) => r.appId === appId) : data;

  const infraQueries = useQueries({
    queries: (rows ?? []).map((row) => ({
      ...getGetInfrastructureQueryOptions(row.appId),
      refetchInterval: REFETCH_INTERVAL_MS,
      refetchIntervalInBackground: false,
    })),
  });

  function onSaved() {
    void queryClient.invalidateQueries({ queryKey: getListAlertConfigQueryKey() });
  }

  function renderThresholdCell(row: AppAlertConfig, field: ThresholdField) {
    const value = row[field];
    const source =
      field === "cpuThresholdPct" ? row.cpuSource :
      field === "memoryThresholdPct" ? row.memorySource :
      row.consecutiveChecksSource;
    const isPercent = field !== "consecutiveChecks";

    return (
      <EditableCell
        appId={row.appId}
        field={field}
        value={value}
        source={source}
        isPercent={isPercent}
        canEdit={canEdit}
        onSaved={onSaved}
      />
    );
  }

  const isAnyFetching = infraQueries.some((q) => q.isFetching);

  const latestUpdateAt = infraQueries.reduce((max, q) => {
    return q.dataUpdatedAt > max ? q.dataUpdatedAt : max;
  }, 0);

  useSecondsTicker();

  const updatedLabel =
    latestUpdateAt > 0
      ? formatSecondsAgo(Date.now() - latestUpdateAt)
      : null;

  return (
    <div className="bg-card border border-border shadow-sm flex flex-col">
      <div className="flex items-center gap-2 p-3 border-b border-border">
        <Settings2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <h2 className="text-sm font-semibold">Infra alert thresholds</h2>
        {canEdit && (
          <span className="ml-1 inline-flex items-center px-1.5 py-0.5 rounded-sm border border-border bg-muted/40 text-muted-foreground text-[10px] font-semibold uppercase tracking-wide">
            editable
          </span>
        )}
        <span className="ml-auto flex items-center gap-2">
          {updatedLabel && (
            <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <RefreshCw
                className={`h-3 w-3 ${isAnyFetching ? "animate-spin text-primary" : "text-muted-foreground/60"}`}
              />
              {isAnyFetching ? "Refreshing…" : `Updated ${updatedLabel}`}
            </span>
          )}
          {!isLoading && rows !== undefined && (
            <span className="text-[11px] text-muted-foreground">
              {rows.length} app{rows.length === 1 ? "" : "s"}
            </span>
          )}
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
                <TableHead className="h-8 font-semibold text-foreground w-[200px]">Consecutive checks</TableHead>
                <TableHead className="h-8 font-semibold text-foreground">Last updated</TableHead>
                <TableHead className="h-8 w-8" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows?.map((row, i) => {
                const infraData = infraQueries[i]?.data as InfrastructureReport | undefined;
                const infraLoading = infraQueries[i]?.isLoading ?? false;
                const currentCpu = getLatestValue(infraData, "CPU %");
                const currentMem = getLatestValue(infraData, "Memory %");

                return (
                  <TableRow
                    key={row.appId}
                    className="h-12 border-b border-border/50 hover:bg-muted/40 cursor-pointer group"
                    onClick={() => navigate(`/apps/${row.appId}?tab=infrastructure`)}
                  >
                    {!appId && (
                      <TableCell className="py-1 font-medium">{row.appName}</TableCell>
                    )}
                    <TableCell className="py-1">
                      {renderThresholdCell(row, "cpuThresholdPct")}
                    </TableCell>
                    <TableCell className="py-1.5">
                      <UtilizationIndicator
                        current={currentCpu}
                        threshold={row.cpuThresholdPct}
                        loading={infraLoading}
                      />
                    </TableCell>
                    <TableCell className="py-1">
                      {renderThresholdCell(row, "memoryThresholdPct")}
                    </TableCell>
                    <TableCell className="py-1.5">
                      <UtilizationIndicator
                        current={currentMem}
                        threshold={row.memoryThresholdPct}
                        loading={infraLoading}
                      />
                    </TableCell>
                    <TableCell className="py-1">
                      {renderThresholdCell(row, "consecutiveChecks")}
                    </TableCell>
                    <TableCell className="py-1 text-[11px] text-muted-foreground">
                      {row.updatedAt ? (
                        <span title={row.updatedAt ?? undefined}>
                          {formatUpdatedAt(row.updatedAt)}
                          {row.updatedBy && <span className="ml-1 opacity-70">by {row.updatedBy}</span>}
                        </span>
                      ) : (
                        <span className="opacity-40">—</span>
                      )}
                    </TableCell>
                    <TableCell className="py-1 w-8 text-right pr-3">
                      <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors" />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <div className="px-3 py-2 border-t border-border bg-muted/20">
        <p className="text-[11px] text-muted-foreground flex flex-wrap gap-x-3 gap-y-1">
          <span className="inline-flex items-center gap-1">
            <SourceBadge source="db" />
            — saved via Orbit UI
          </span>
          <span className="inline-flex items-center gap-1">
            <SourceBadge source="env" />
            — per-app env var
          </span>
          <span className="inline-flex items-center gap-1">
            <SourceBadge source="default" />
            — global or built-in default
          </span>
          {canEdit && (
            <span className="opacity-60">Hover a value to edit. Click <RotateCcw className="inline h-2.5 w-2.5" /> to clear a DB override.</span>
          )}
        </p>
      </div>
    </div>
  );
}
