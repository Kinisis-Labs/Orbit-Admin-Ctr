import {
  useListInfraAlertLog,
  useAcknowledgeInfraAlertLogEntry,
  getListInfraAlertLogQueryKey,
} from "@workspace/api-client-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Cpu, BellOff, Check, Filter, X, CalendarRange } from "lucide-react";
import { format, parseISO, isValid, startOfDay, endOfDay } from "date-fns";
import { useState, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useCsvExport } from "@/hooks/use-csv-export";
import { useToast } from "@/hooks/use-toast";
import { CsvToolbar } from "@/components/csv-toolbar";

const CHANNEL_LABELS: Record<string, string> = {
  teams: "Teams",
  email: "Email",
};

const METRIC_LABELS: Record<string, string> = {
  cpu: "CPU",
  memory: "Memory",
};

function ChannelBadge({ channel }: { channel: string }) {
  const label = CHANNEL_LABELS[channel] ?? channel;
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded-sm border border-border bg-muted/40 text-muted-foreground text-[10px] font-semibold uppercase tracking-wide">
      {label}
    </span>
  );
}

function MetricBadge({ metric }: { metric: string }) {
  const label = METRIC_LABELS[metric] ?? metric;
  const colorClass =
    metric === "cpu"
      ? "border-blue-500/40 bg-blue-500/10 text-blue-600 dark:text-blue-400"
      : "border-purple-500/40 bg-purple-500/10 text-purple-600 dark:text-purple-400";
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded-sm border text-[10px] font-semibold ${colorClass}`}>
      {label}
    </span>
  );
}

function OverThresholdPill({ value, threshold }: { value: number; threshold: number }) {
  const over = value - threshold;
  const pct = threshold > 0 ? (over / threshold) * 100 : 0;
  const colorClass =
    pct > 25
      ? "border-destructive/40 bg-destructive/10 text-destructive"
      : "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400";
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded-sm border text-[10px] font-semibold ${colorClass}`}>
      {value.toFixed(1)}% &nbsp;<span className="opacity-70">(+{over.toFixed(1)}% over {threshold.toFixed(0)}%)</span>
    </span>
  );
}

function AcknowledgedBadge({ at, by }: { at: string; by?: string | null }) {
  const label = by ? `Acknowledged by ${by} on ${format(new Date(at), "MMM d, yyyy 'at' HH:mm")}` : `Acknowledged ${format(new Date(at), "MMM d, yyyy 'at' HH:mm")}`;
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm border border-border bg-muted/30 text-muted-foreground text-[10px] font-medium cursor-default"
      title={label}
    >
      <Check className="h-2.5 w-2.5" />
      {by ? `Ack'd by ${by}` : `Acknowledged ${format(new Date(at), "MMM d")}`}
    </span>
  );
}

interface Props {
  appId?: string;
}

export function InfraAlertHistory({ appId }: Props) {
  const [unacknowledgedOnly, setUnacknowledgedOnly] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const params = {
    ...(appId ? { appId } : {}),
    limit: 50,
    ...(unacknowledgedOnly ? { unacknowledgedOnly: true } : {}),
  };

  const { data: entries, isLoading } = useListInfraAlertLog(params);
  const { mutate: acknowledge, isPending: isAcknowledging } = useAcknowledgeInfraAlertLogEntry({
    mutation: {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: getListInfraAlertLogQueryKey() });
      },
    },
  });

  const [startInput, setStartInput] = useState("");
  const [endInput, setEndInput] = useState("");

  const startDate = useMemo(() => {
    if (!startInput) return null;
    const d = parseISO(startInput);
    return isValid(d) ? startOfDay(d) : null;
  }, [startInput]);

  const endDate = useMemo(() => {
    if (!endInput) return null;
    const d = parseISO(endInput);
    return isValid(d) ? endOfDay(d) : null;
  }, [endInput]);

  const isFiltered = startDate !== null || endDate !== null;

  const filteredEntries = useMemo(() => {
    if (!entries) return entries;
    if (!isFiltered) return entries;
    return entries.filter((entry) => {
      const sent = new Date(entry.sentAt);
      if (startDate && sent < startDate) return false;
      if (endDate && sent > endDate) return false;
      return true;
    });
  }, [entries, startDate, endDate, isFiltered]);

  function clearFilter() {
    setStartInput("");
    setEndInput("");
  }

  const csvHeaders = appId
    ? ["Sent At", "Metric", "Observed Value", "Threshold", "Channels"]
    : ["App", "Sent At", "Metric", "Observed Value", "Threshold", "Channels"];

  const csvRows = filteredEntries?.map((entry) => {
    const sentAt = format(new Date(entry.sentAt), "MMM d, yyyy HH:mm");
    const metricLabel = METRIC_LABELS[entry.metric] ?? entry.metric;
    const channels = entry.channels.map((ch) => CHANNEL_LABELS[ch] ?? ch).join("; ");
    const base = [
      sentAt,
      metricLabel,
      `${entry.value.toFixed(1)}%`,
      `${entry.threshold.toFixed(0)}%`,
      channels,
    ];
    return appId ? base : [entry.appName, ...base];
  }) ?? null;

  const { copied, disabled: csvDisabled, handleExport, handleCopy } = useCsvExport(
    csvRows,
    csvHeaders,
    `infra-alert-history${appId ? `-${entries?.[0]?.appName ?? appId}` : ""}`,
    () => toast({ title: "No alerts to export", description: "There are no infra alert records in the current view." }),
  );

  const total = entries?.length ?? 0;
  const shown = filteredEntries?.length ?? 0;

  return (
    <div className="bg-card border border-border shadow-sm flex flex-col">
      <div className="flex items-center gap-2 p-3 border-b border-border flex-wrap">
        <Cpu className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <h2 className="text-sm font-semibold">Infra pressure alerts sent</h2>

        <div className="flex items-center gap-1.5 ml-auto flex-wrap">
          <button
            onClick={() => setUnacknowledgedOnly((v) => !v)}
            className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-sm border text-[11px] font-medium transition-colors ${
              unacknowledgedOnly
                ? "border-primary/40 bg-primary/10 text-primary"
                : "border-border bg-transparent text-muted-foreground hover:text-foreground hover:border-border/80"
            }`}
            title={unacknowledgedOnly ? "Showing unacknowledged only — click to show all" : "Click to show only unacknowledged"}
          >
            <Filter className="h-3 w-3" />
            {unacknowledgedOnly ? "Unacknowledged only" : "All"}
          </button>

          <div className="flex items-center gap-1 rounded-sm border border-border bg-muted/30 px-2 py-1">
            <CalendarRange className="h-3 w-3 text-muted-foreground shrink-0" />
            <label className="text-[11px] text-muted-foreground select-none" htmlFor="infra-alert-date-start">
              From
            </label>
            <input
              id="infra-alert-date-start"
              type="date"
              value={startInput}
              max={endInput || undefined}
              onChange={(e) => setStartInput(e.target.value)}
              className="text-[11px] bg-transparent border-none outline-none text-foreground cursor-pointer tabular-nums h-5 w-[110px]"
            />
            <span className="text-[11px] text-muted-foreground mx-0.5">–</span>
            <label className="sr-only" htmlFor="infra-alert-date-end">
              To
            </label>
            <input
              id="infra-alert-date-end"
              type="date"
              value={endInput}
              min={startInput || undefined}
              onChange={(e) => setEndInput(e.target.value)}
              className="text-[11px] bg-transparent border-none outline-none text-foreground cursor-pointer tabular-nums h-5 w-[110px]"
            />
            {isFiltered && (
              <button
                onClick={clearFilter}
                className="ml-1 flex items-center justify-center h-4 w-4 rounded-sm hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                aria-label="Clear date filter"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>

          {!isLoading && entries !== undefined && (
            <span className="text-[11px] text-muted-foreground whitespace-nowrap">
              {total === 0
                ? "No alerts on record"
                : isFiltered
                  ? `${shown} of ${total} notification${total === 1 ? "" : "s"}`
                  : `${total} notification${total === 1 ? "" : "s"}`}
            </span>
          )}

          {!isLoading && (
            <div className="flex items-center gap-1">
              <CsvToolbar
                handleExport={handleExport}
                handleCopy={handleCopy}
                disabled={csvDisabled}
                copied={copied}
              />
            </div>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="p-4 space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      ) : !entries || entries.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 py-10 text-muted-foreground">
          <BellOff className="h-6 w-6 opacity-40" />
          {unacknowledgedOnly ? (
            <>
              <p className="text-sm">All alerts have been acknowledged.</p>
              <button
                onClick={() => setUnacknowledgedOnly(false)}
                className="text-[11px] text-primary hover:underline"
              >
                Show all alerts
              </button>
            </>
          ) : (
            <>
              <p className="text-sm">No infra-pressure notifications have been dispatched yet.</p>
              <p className="text-[11px] opacity-70">
                Alerts fire when CPU exceeds{" "}
                <code className="font-mono">ALERT_CPU_THRESHOLD_PCT</code> (default 80%) or memory exceeds{" "}
                <code className="font-mono">ALERT_MEMORY_THRESHOLD_PCT</code> (default 85%) for{" "}
                <code className="font-mono">ALERT_INFRA_CONSECUTIVE_CHECKS</code> consecutive scheduler runs (default 2).
              </p>
            </>
          )}
        </div>
      ) : filteredEntries && filteredEntries.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 py-10 text-muted-foreground">
          <CalendarRange className="h-6 w-6 opacity-40" />
          <p className="text-sm">No alerts in this date range.</p>
          <button
            onClick={clearFilter}
            className="text-[12px] text-primary hover:underline"
          >
            Clear filter to see all {total} notification{total === 1 ? "" : "s"}
          </button>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <Table className="text-[13px]">
            <TableHeader className="bg-muted/50 border-b border-border">
              <TableRow className="hover:bg-transparent">
                {!appId && (
                  <TableHead className="h-8 font-semibold text-foreground w-[160px]">App</TableHead>
                )}
                <TableHead className="h-8 font-semibold text-foreground w-[160px]">Sent at</TableHead>
                <TableHead className="h-8 font-semibold text-foreground w-[90px]">Metric</TableHead>
                <TableHead className="h-8 font-semibold text-foreground">Observed value</TableHead>
                <TableHead className="h-8 font-semibold text-foreground w-[160px]">Channels</TableHead>
                <TableHead className="h-8 font-semibold text-foreground w-[120px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredEntries!.map((entry) => {
                const isAcked = !!entry.acknowledgedAt;
                return (
                  <TableRow
                    key={entry.id}
                    className={`h-9 border-b border-border/50 hover:bg-muted/40 ${isAcked ? "opacity-50" : ""}`}
                  >
                    {!appId && (
                      <TableCell className="py-1 font-medium truncate max-w-[160px]">{entry.appName}</TableCell>
                    )}
                    <TableCell className="py-1 tabular-nums text-[12px] text-muted-foreground whitespace-nowrap">
                      {format(new Date(entry.sentAt), "MMM d, yyyy HH:mm")}
                    </TableCell>
                    <TableCell className="py-1">
                      <MetricBadge metric={entry.metric} />
                    </TableCell>
                    <TableCell className="py-1">
                      {isAcked ? (
                        <AcknowledgedBadge at={entry.acknowledgedAt!} by={entry.acknowledgedBy} />
                      ) : (
                        <OverThresholdPill value={entry.value} threshold={entry.threshold} />
                      )}
                    </TableCell>
                    <TableCell className="py-1">
                      <div className="flex flex-wrap gap-1">
                        {entry.channels.map((ch) => (
                          <ChannelBadge key={ch} channel={ch} />
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="py-1 text-right">
                      {isAcked ? null : (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 text-[11px] px-2 rounded-sm text-muted-foreground hover:text-foreground"
                          onClick={() => acknowledge({ id: entry.id })}
                          disabled={isAcknowledging}
                        >
                          Acknowledge
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
