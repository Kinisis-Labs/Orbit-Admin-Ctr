import { Fragment, useEffect, useRef, useState } from "react";
import {
  useListAlertConfig,
  useUpdateAlertConfig,
  useGetAlertConfigHistory,
  getListAlertConfigQueryKey,
  getGetInfrastructureQueryOptions,
} from "@workspace/api-client-react";
import type { AppAlertConfig, AlertThresholdConfigLogEntry, InfrastructureReport, MetricSeries } from "@workspace/api-client-react";
import { useQueryClient, useQueries } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, BellOff, Check, ChevronDown, ChevronUp, History, Pencil, RefreshCw, RotateCcw, Settings2, X, ArrowRight } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { ADMIN_GROUP } from "@/lib/auth-groups";
import { cn } from "@/lib/utils";
import { POLL_OPTIONS, type PollValue, usePollingInterval } from "@/hooks/use-polling-interval";
import { useUpdatedAgo } from "@/hooks/use-updated-ago";

function pollIntervalKey(appId: string | undefined): string {
  return `orbit:alert-table:poll-interval:${appId ?? "global"}`;
}

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

const LARGE_CHANGE_THRESHOLD = 20;

const FIELD_LABELS: Record<string, string> = {
  cpuThresholdPct: "CPU threshold",
  memoryThresholdPct: "Memory threshold",
  consecutiveChecks: "Consecutive checks",
  cooldownHours: "Cooldown",
};

type ThresholdField = "cpuThresholdPct" | "memoryThresholdPct" | "consecutiveChecks" | "cooldownHours";

function SourceBadge({
  source,
  envVarName,
  envValue,
}: {
  source: "db" | "env" | "default" | undefined;
  envVarName?: string | null;
  envValue?: number | null;
}) {
  const hasConflict = source === "db" && envVarName != null && envValue != null;

  if (source === "db") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm border text-[10px] font-semibold uppercase tracking-wide",
          hasConflict
            ? "border-orange-500/40 bg-orange-500/10 text-orange-600 dark:text-orange-400 cursor-help"
            : "border-blue-500/40 bg-blue-500/10 text-blue-600 dark:text-blue-400",
        )}
        title={
          hasConflict
            ? `DB override takes precedence. Env var is being ignored: ${envVarName}=${envValue}`
            : undefined
        }
      >
        db
        {hasConflict && <AlertTriangle className="h-2.5 w-2.5 shrink-0" />}
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

function formatSilencedUntil(iso: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function SilencedBadge({ silencedUntil }: { silencedUntil: string | null | undefined }) {
  if (!silencedUntil) return null;
  const expiresAt = new Date(silencedUntil).getTime();
  if (Date.now() >= expiresAt) return null;
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm border border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400 text-[10px] font-semibold whitespace-nowrap"
      title={`Alert notifications silenced until ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(silencedUntil))}`}
    >
      <BellOff className="h-2.5 w-2.5 shrink-0" />
      until {formatSilencedUntil(silencedUntil)}
    </span>
  );
}

interface EditableCellProps {
  appId: string;
  field: ThresholdField;
  value: number;
  source: "db" | "env" | "default" | undefined;
  envVarName?: string | null;
  envValue?: number | null;
  isPercent?: boolean;
  suffix?: string;
  canEdit: boolean;
  onSaved: () => void;
}

function EditableCell({ appId, field, value, source, envVarName, envValue, isPercent = false, suffix = "", canEdit, onSaved }: EditableCellProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingValue, setPendingValue] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { mutateAsync } = useUpdateAlertConfig();

  const displaySuffix = suffix || (isPercent ? "%" : "");
  const fieldLabel = FIELD_LABELS[field] ?? field;

  function startEdit() {
    setDraft(String(value));
    setError(null);
    setPendingValue(null);
    setEditing(true);
    setTimeout(() => inputRef.current?.select(), 0);
  }

  function cancelEdit() {
    setEditing(false);
    setPendingValue(null);
    setError(null);
  }

  async function save(newValue: number | null) {
    setSaving(true);
    setError(null);
    try {
      await mutateAsync({ appId, data: { [field]: newValue } });
      setEditing(false);
      setPendingValue(null);
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
    const rounded = Math.round(parsed);
    if (Math.abs(rounded - value) > LARGE_CHANGE_THRESHOLD) {
      setPendingValue(rounded);
      return;
    }
    await save(rounded);
  }

  if (editing && pendingValue !== null) {
    return (
      <span className="inline-flex flex-wrap items-center gap-1">
        <span className="text-[11px] text-muted-foreground">
          Set {fieldLabel} to{" "}
          <span className="font-mono font-semibold text-foreground">
            {pendingValue}{displaySuffix}
          </span>
          ?{" "}
          <span className="opacity-60">(was {value}{displaySuffix})</span>
        </span>
        {saving ? (
          <span className="text-[11px] text-muted-foreground">saving…</span>
        ) : (
          <>
            <button
              type="button"
              onClick={() => void save(pendingValue)}
              className="inline-flex items-center gap-0.5 h-5 px-1.5 rounded border border-green-500/50 bg-green-500/10 text-green-700 dark:text-green-400 text-[10px] font-semibold hover:bg-green-500/20 transition-colors"
            >
              Confirm
            </button>
            <button
              type="button"
              onClick={cancelEdit}
              className="inline-flex items-center gap-0.5 h-5 px-1.5 rounded border border-border bg-muted/40 text-muted-foreground text-[10px] font-semibold hover:bg-muted/60 transition-colors"
            >
              Cancel
            </button>
          </>
        )}
        {error && <span className="text-[10px] text-destructive">{error}</span>}
      </span>
    );
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
          onBlur={() => { if (!saving && pendingValue === null) void commitDraft(); }}
          disabled={saving}
          className={cn(
            "w-16 h-6 px-1.5 text-[12px] font-mono tabular-nums bg-background border rounded text-foreground focus:outline-none focus:ring-1 focus:ring-ring",
            error ? "border-destructive" : "border-border",
          )}
          autoFocus
        />
        {displaySuffix && <span className="text-[11px] text-muted-foreground">{displaySuffix}</span>}
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
        {value}{displaySuffix}
      </span>
      <SourceBadge source={source} envVarName={envVarName} envValue={envValue} />
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
// History panel
// ---------------------------------------------------------------------------

function formatDt(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function DiffValue({
  oldVal,
  newVal,
  suffix = "",
}: {
  oldVal: number | null | undefined;
  newVal: number | null | undefined;
  suffix?: string;
}) {
  const hasOld = oldVal !== null && oldVal !== undefined;
  const hasNew = newVal !== null && newVal !== undefined;

  if (!hasOld && !hasNew) return <span className="opacity-40">—</span>;

  if (!hasOld) {
    return (
      <span className="text-emerald-600 dark:text-emerald-400 font-mono text-[11px]">
        {newVal}{suffix} <span className="opacity-50 font-sans">(new)</span>
      </span>
    );
  }

  if (!hasNew) {
    return (
      <span className="text-amber-600 dark:text-amber-400 font-mono text-[11px] line-through opacity-60">
        {oldVal}{suffix}
      </span>
    );
  }

  if (oldVal === newVal) {
    return (
      <span className="font-mono text-[11px] text-muted-foreground">
        {newVal}{suffix}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 font-mono text-[11px]">
      <span className="text-muted-foreground line-through opacity-60">{oldVal}{suffix}</span>
      <ArrowRight className="h-2.5 w-2.5 text-muted-foreground/50 shrink-0" />
      <span className="text-foreground font-semibold">{newVal}{suffix}</span>
    </span>
  );
}

function HistoryPanel({ appId, colSpan }: { appId: string; colSpan: number }) {
  const { data, isLoading, isError } = useGetAlertConfigHistory(appId);

  return (
    <TableRow className="bg-muted/30 hover:bg-muted/30">
      <TableCell colSpan={colSpan} className="py-0">
        <div className="px-4 py-3">
          <div className="flex items-center gap-2 mb-2">
            <History className="h-3 w-3 text-muted-foreground" />
            <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
              Threshold change history
            </span>
            {!isLoading && data && (
              <span className="text-[10px] text-muted-foreground opacity-60">
                {data.length} {data.length === 1 ? "entry" : "entries"}
              </span>
            )}
          </div>

          {isLoading && (
            <div className="space-y-1.5">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-6 w-full" />
              ))}
            </div>
          )}

          {isError && (
            <p className="text-[11px] text-destructive">Failed to load history.</p>
          )}

          {!isLoading && !isError && data?.length === 0 && (
            <p className="text-[11px] text-muted-foreground opacity-60">
              No changes recorded yet. Changes made through the Orbit UI will appear here.
            </p>
          )}

          {!isLoading && !isError && data && data.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="border-b border-border/50">
                    <th className="text-left py-1 pr-4 font-semibold text-muted-foreground w-[160px]">When</th>
                    <th className="text-left py-1 pr-4 font-semibold text-muted-foreground w-[120px]">By</th>
                    <th className="text-left py-1 pr-4 font-semibold text-muted-foreground w-[160px]">CPU threshold</th>
                    <th className="text-left py-1 pr-4 font-semibold text-muted-foreground w-[160px]">Memory threshold</th>
                    <th className="text-left py-1 pr-4 font-semibold text-muted-foreground w-[140px]">Consecutive checks</th>
                    <th className="text-left py-1 font-semibold text-muted-foreground w-[120px]">Cooldown</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((entry: AlertThresholdConfigLogEntry) => (
                    <tr key={entry.id} className="border-b border-border/30 last:border-0">
                      <td className="py-1.5 pr-4 text-muted-foreground whitespace-nowrap">
                        {formatDt(entry.changedAt)}
                      </td>
                      <td className="py-1.5 pr-4 text-muted-foreground max-w-[120px] truncate" title={entry.changedBy}>
                        {entry.changedBy}
                      </td>
                      <td className="py-1.5 pr-4">
                        <DiffValue oldVal={entry.oldCpuThresholdPct} newVal={entry.newCpuThresholdPct} suffix="%" />
                      </td>
                      <td className="py-1.5 pr-4">
                        <DiffValue oldVal={entry.oldMemoryThresholdPct} newVal={entry.newMemoryThresholdPct} suffix="%" />
                      </td>
                      <td className="py-1.5 pr-4">
                        <DiffValue oldVal={entry.oldConsecutiveChecks} newVal={entry.newConsecutiveChecks} />
                      </td>
                      <td className="py-1.5">
                        <DiffValue oldVal={entry.oldCooldownHours} newVal={entry.newCooldownHours} suffix="h" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </TableCell>
    </TableRow>
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
  const { data, isLoading } = useListAlertConfig({ query: { queryKey: getListAlertConfigQueryKey(), staleTime: 5 * 60 * 1000 } });
  const queryClient = useQueryClient();
  const { hasGroup } = useAuth();
  const canEdit = hasGroup(ADMIN_GROUP.id);
  const [, navigate] = useLocation();
  const [expandedHistory, setExpandedHistory] = useState<string | null>(null);

  const [pollInterval, setPollInterval] = usePollingInterval(pollIntervalKey(appId));

  const rows = appId ? data?.filter((r) => r.appId === appId) : data;

  const infraQueries = useQueries({
    queries: (rows ?? []).map((row) => ({
      ...getGetInfrastructureQueryOptions(row.appId),
      refetchInterval: pollInterval > 0 ? pollInterval : false,
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
      field === "consecutiveChecks" ? row.consecutiveChecksSource :
      row.cooldownSource;
    const envVarName =
      field === "cpuThresholdPct" ? row.cpuEnvVarName :
      field === "memoryThresholdPct" ? row.memoryEnvVarName :
      field === "consecutiveChecks" ? row.consecutiveChecksEnvVarName :
      undefined;
    const envValue =
      field === "cpuThresholdPct" ? row.cpuEnvValue :
      field === "memoryThresholdPct" ? row.memoryEnvValue :
      field === "consecutiveChecks" ? row.consecutiveChecksEnvValue :
      undefined;
    const isPercent = field === "cpuThresholdPct" || field === "memoryThresholdPct";
    const suffix = field === "cooldownHours" ? "h" : isPercent ? "%" : "";

    return (
      <EditableCell
        appId={row.appId}
        field={field}
        value={value}
        source={source}
        envVarName={envVarName}
        envValue={envValue}
        isPercent={isPercent}
        suffix={suffix}
        canEdit={canEdit}
        onSaved={onSaved}
      />
    );
  }

  const isAnyFetching = infraQueries.some((q) => q.isFetching);

  const latestUpdateAt = infraQueries.reduce((max, q) => {
    return q.dataUpdatedAt > max ? q.dataUpdatedAt : max;
  }, 0);

  const updatedLabel = useUpdatedAgo(latestUpdateAt);

  function handleManualRefresh() {
    infraQueries.forEach((q) => void q.refetch());
  }

  const colCount = (appId ? 0 : 1) + 8;

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
              {isAnyFetching ? "Refreshing…" : `Updated ${updatedLabel}`}
            </span>
          )}
          {infraQueries.length > 0 && (
            <>
              <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground select-none">
                <span className="hidden sm:inline">Poll</span>
                <select
                  value={pollInterval}
                  onChange={(e) => setPollInterval(Number(e.target.value) as PollValue)}
                  className={cn(
                    "h-6 rounded border border-border bg-background px-1.5 text-[11px] text-foreground",
                    "focus:outline-none focus:ring-1 focus:ring-ring cursor-pointer",
                  )}
                  aria-label="Utilization polling interval"
                >
                  {POLL_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                onClick={handleManualRefresh}
                disabled={isAnyFetching}
                aria-label="Refresh utilization data"
                title="Refresh utilization data now"
                className={cn(
                  "flex items-center justify-center rounded p-1 transition-colors",
                  isAnyFetching
                    ? "cursor-not-allowed text-primary opacity-60"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/60",
                )}
              >
                <RefreshCw className={cn("h-3.5 w-3.5", isAnyFetching && "animate-spin")} />
              </button>
            </>
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
                <TableHead className="h-8 font-semibold text-foreground w-[160px]">Cooldown</TableHead>
                <TableHead className="h-8 font-semibold text-foreground">Last updated</TableHead>
                <TableHead className="h-8 w-16" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows?.map((row, i) => {
                const infraData = infraQueries[i]?.data as InfrastructureReport | undefined;
                const infraLoading = infraQueries[i]?.isLoading ?? false;
                const currentCpu = getLatestValue(infraData, "CPU %");
                const currentMem = getLatestValue(infraData, "Memory %");
                const historyOpen = expandedHistory === row.appId;

                return (
                  <Fragment key={row.appId}>
                    <TableRow
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
                      <TableCell className="py-1">
                        <span className="inline-flex flex-wrap items-center gap-1.5">
                          {renderThresholdCell(row, "cooldownHours")}
                          <SilencedBadge silencedUntil={row.silencedUntil} />
                        </span>
                      </TableCell>
                      <TableCell className="py-1 text-[11px] text-muted-foreground">
                        {row.updatedAt ? (
                          <span className="italic" title={row.updatedAt ?? undefined}>
                            Last set by {row.updatedBy ?? "unknown"}
                            {row.updatedAt ? ` on ${formatUpdatedAt(row.updatedAt)}` : ""}
                          </span>
                        ) : (
                          <span className="opacity-40">—</span>
                        )}
                      </TableCell>
                      <TableCell className="py-1 w-16 text-right pr-3">
                        <span className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setExpandedHistory(historyOpen ? null : row.appId);
                            }}
                            className={cn(
                              "inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold border transition-colors",
                              historyOpen
                                ? "border-primary/40 bg-primary/10 text-primary"
                                : "border-border bg-muted/40 text-muted-foreground hover:text-foreground hover:border-border/80",
                            )}
                            title={historyOpen ? "Hide change history" : "Show change history"}
                            aria-label={historyOpen ? "Hide history" : "Show history"}
                          >
                            <History className="h-2.5 w-2.5" />
                            {historyOpen
                              ? <ChevronUp className="h-2.5 w-2.5" />
                              : <ChevronDown className="h-2.5 w-2.5" />}
                          </button>
                          <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors" />
                        </span>
                      </TableCell>
                    </TableRow>
                    {historyOpen && (
                      <HistoryPanel appId={row.appId} colSpan={colCount} />
                    )}
                  </Fragment>
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
            <SourceBadge source="db" envVarName="ALERT_CPU_THRESHOLD_PCT__APPID" envValue={90} />
            — DB override shadows an env var (hover for details)
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
