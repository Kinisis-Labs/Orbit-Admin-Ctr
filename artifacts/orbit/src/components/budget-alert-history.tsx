import { useListBudgetAlertLog, useAcknowledgeBudgetAlertLogEntry, getListBudgetAlertLogQueryKey } from "@workspace/api-client-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Bell, BellOff, Check, Filter, X, CalendarRange, Mail, MessageSquare } from "lucide-react";
import { format, parseISO, isValid, startOfDay, endOfDay } from "date-fns";
import { useState, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useCsvExport } from "@/hooks/use-csv-export";
import { useToast } from "@/hooks/use-toast";
import { CsvToolbar } from "@/components/csv-toolbar";

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(n);

const CHANNEL_LABELS: Record<string, string> = {
  teams: "Teams",
  email: "Email",
};

const ALL_CHANNELS = ["teams", "email"] as const;
type Channel = (typeof ALL_CHANNELS)[number];

function ChannelBadge({ channel }: { channel: string }) {
  const label = CHANNEL_LABELS[channel] ?? channel;
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded-sm border border-border bg-muted/40 text-muted-foreground text-[10px] font-semibold uppercase tracking-wide">
      {label}
    </span>
  );
}

function OveragePill({ forecast, budget }: { forecast: number; budget: number }) {
  const overage = forecast - budget;
  const pct = budget > 0 ? (overage / budget) * 100 : 0;
  const colorClass =
    pct > 25
      ? "border-destructive/40 bg-destructive/10 text-destructive"
      : "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400";
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded-sm border text-[10px] font-semibold ${colorClass}`}>
      +{pct.toFixed(1)}% over budget
    </span>
  );
}

function AcknowledgedBadge({ at }: { at: string }) {
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm border border-border bg-muted/30 text-muted-foreground text-[10px] font-medium">
      <Check className="h-2.5 w-2.5" />
      Acknowledged {format(new Date(at), "MMM d")}
    </span>
  );
}

interface Props {
  appId?: string;
}

export function BudgetAlertHistory({ appId }: Props) {
  const [unacknowledgedOnly, setUnacknowledgedOnly] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const params = {
    ...(appId ? { appId } : {}),
    limit: 50,
    ...(unacknowledgedOnly ? { unacknowledgedOnly: true } : {}),
  };

  const { data: entries, isLoading } = useListBudgetAlertLog(params);
  const { mutate: acknowledge, isPending: isAcknowledging } = useAcknowledgeBudgetAlertLogEntry({
    mutation: {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: getListBudgetAlertLogQueryKey() });
      },
    },
  });

  const [startInput, setStartInput] = useState("");
  const [endInput, setEndInput] = useState("");
  const [selectedChannels, setSelectedChannels] = useState<Set<Channel>>(new Set());

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

  const isDateFiltered = startDate !== null || endDate !== null;
  const isChannelFiltered = selectedChannels.size > 0;
  const isFiltered = isDateFiltered || isChannelFiltered;

  function toggleChannel(ch: Channel) {
    setSelectedChannels((prev) => {
      const next = new Set(prev);
      if (next.has(ch)) {
        next.delete(ch);
      } else {
        next.add(ch);
      }
      return next;
    });
  }

  const filteredEntries = useMemo(() => {
    if (!entries) return entries;
    if (!isFiltered) return entries;
    return entries.filter((entry) => {
      if (isDateFiltered) {
        const sent = new Date(entry.sentAt);
        if (startDate && sent < startDate) return false;
        if (endDate && sent > endDate) return false;
      }
      if (isChannelFiltered) {
        const hasChannel = entry.channels.some((ch) => selectedChannels.has(ch as Channel));
        if (!hasChannel) return false;
      }
      return true;
    });
  }, [entries, startDate, endDate, isDateFiltered, isChannelFiltered, selectedChannels, isFiltered]);

  function clearFilter() {
    setStartInput("");
    setEndInput("");
    setSelectedChannels(new Set());
  }

  const csvHeaders = appId
    ? ["Sent At", "MTD Spend", "Forecast", "Budget Cap", "Overage %", "Channels"]
    : ["App", "Sent At", "MTD Spend", "Forecast", "Budget Cap", "Overage %", "Channels"];

  const csvRows = filteredEntries?.map((entry) => {
    const overage = entry.budget > 0 ? (((entry.forecast - entry.budget) / entry.budget) * 100).toFixed(1) + "%" : "N/A";
    const sentAt = format(new Date(entry.sentAt), "MMM d, yyyy HH:mm");
    const channels = entry.channels.map((ch) => CHANNEL_LABELS[ch] ?? ch).join("; ");
    const base = [
      sentAt,
      entry.mtd.toFixed(2),
      entry.forecast.toFixed(2),
      entry.budget.toFixed(2),
      overage,
      channels,
    ];
    return appId ? base : [entry.appName, ...base];
  }) ?? null;

  const { copied, disabled: csvDisabled, handleExport, handleCopy } = useCsvExport(
    csvRows,
    csvHeaders,
    "budget-alert-history",
    () => toast({ title: "No alerts to export", description: "There are no alert records in the current view." }),
  );

  const total = entries?.length ?? 0;
  const shown = filteredEntries?.length ?? 0;

  const channelDefs: { key: Channel; label: string; Icon: React.ElementType }[] = [
    { key: "teams", label: "Teams", Icon: MessageSquare },
    { key: "email", label: "Email", Icon: Mail },
  ];

  return (
    <div className="bg-card border border-border shadow-sm flex flex-col">
      <div className="flex items-center gap-2 p-3 border-b border-border flex-wrap">
        <Bell className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <h2 className="text-sm font-semibold">Alerts sent</h2>

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

          <div className="flex items-center gap-0.5 rounded-sm border border-border bg-muted/30 px-1.5 py-1">
            {channelDefs.map(({ key, label, Icon }) => {
              const active = selectedChannels.has(key);
              return (
                <button
                  key={key}
                  onClick={() => toggleChannel(key)}
                  title={active ? `Remove ${label} filter` : `Filter by ${label}`}
                  className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm text-[11px] font-medium transition-colors ${
                    active
                      ? "bg-primary/15 text-primary border border-primary/30"
                      : "text-muted-foreground hover:text-foreground border border-transparent hover:border-border/60"
                  }`}
                >
                  <Icon className="h-3 w-3" />
                  {label}
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-1 rounded-sm border border-border bg-muted/30 px-2 py-1">
            <CalendarRange className="h-3 w-3 text-muted-foreground shrink-0" />
            <label className="text-[11px] text-muted-foreground select-none" htmlFor="alert-date-start">
              From
            </label>
            <input
              id="alert-date-start"
              type="date"
              value={startInput}
              max={endInput || undefined}
              onChange={(e) => setStartInput(e.target.value)}
              className="text-[11px] bg-transparent border-none outline-none text-foreground cursor-pointer tabular-nums h-5 w-[110px]"
            />
            <span className="text-[11px] text-muted-foreground mx-0.5">–</span>
            <label className="sr-only" htmlFor="alert-date-end">
              To
            </label>
            <input
              id="alert-date-end"
              type="date"
              value={endInput}
              min={startInput || undefined}
              onChange={(e) => setEndInput(e.target.value)}
              className="text-[11px] bg-transparent border-none outline-none text-foreground cursor-pointer tabular-nums h-5 w-[110px]"
            />
            {isDateFiltered && (
              <button
                onClick={() => { setStartInput(""); setEndInput(""); }}
                className="ml-1 flex items-center justify-center h-4 w-4 rounded-sm hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                aria-label="Clear date filter"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>

          {isFiltered && (
            <button
              onClick={clearFilter}
              className="inline-flex items-center gap-1 px-1.5 py-1 rounded-sm border border-border bg-transparent text-[11px] text-muted-foreground hover:text-foreground hover:border-border/80 transition-colors"
              title="Clear all filters"
            >
              <X className="h-3 w-3" />
              Clear all
            </button>
          )}

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
              <p className="text-sm">No budget-overrun notifications have been dispatched yet.</p>
              <p className="text-[11px] opacity-70">
                Alerts fire when the end-of-month forecast exceeds the budget cap.
                Configure <code className="font-mono">ALERT_TEAMS_WEBHOOK_URL</code> or{" "}
                <code className="font-mono">ALERT_SMTP_*</code> env vars to enable them.
              </p>
            </>
          )}
        </div>
      ) : filteredEntries && filteredEntries.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 py-10 text-muted-foreground">
          <Filter className="h-6 w-6 opacity-40" />
          <p className="text-sm">No alerts match the active filters.</p>
          <button
            onClick={clearFilter}
            className="text-[12px] text-primary hover:underline"
          >
            Clear filters to see all {total} notification{total === 1 ? "" : "s"}
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
                <TableHead className="h-8 font-semibold text-foreground text-right w-[130px]">MTD spend</TableHead>
                <TableHead className="h-8 font-semibold text-foreground text-right w-[130px]">Forecast</TableHead>
                <TableHead className="h-8 font-semibold text-foreground text-right w-[120px]">Budget cap</TableHead>
                <TableHead className="h-8 font-semibold text-foreground w-[200px]">Overage</TableHead>
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
                    <TableCell className="py-1 text-right font-mono text-[12px] tabular-nums">
                      {fmt(entry.mtd)}
                    </TableCell>
                    <TableCell className="py-1 text-right font-mono text-[12px] tabular-nums text-amber-600 dark:text-amber-400 font-semibold">
                      {fmt(entry.forecast)}
                    </TableCell>
                    <TableCell className="py-1 text-right font-mono text-[12px] tabular-nums text-muted-foreground">
                      {fmt(entry.budget)}
                    </TableCell>
                    <TableCell className="py-1">
                      {isAcked ? (
                        <AcknowledgedBadge at={entry.acknowledgedAt!} />
                      ) : (
                        <OveragePill forecast={entry.forecast} budget={entry.budget} />
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
