import { useListBudgetAlertLog, useAcknowledgeBudgetAlertLogEntry, getListBudgetAlertLogQueryKey, useGetAlertChannelStatus } from "@workspace/api-client-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Bell, BellOff, Check, Filter, X, CalendarRange, Mail, MessageSquare, StickyNote, Bookmark, BookmarkPlus, Trash2, Zap } from "lucide-react";
import { format, parseISO, isValid, startOfDay, endOfDay, subDays } from "date-fns";
import { useState, useMemo, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useCsvExport } from "@/hooks/use-csv-export";
import { useToast } from "@/hooks/use-toast";
import { CsvToolbar } from "@/components/csv-toolbar";
import { useSearch, useLocation } from "wouter";

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(n);

const CHANNEL_LABELS: Record<string, string> = {
  teams: "Teams",
  email: "Email",
};

const ALL_CHANNELS = ["teams", "email"] as const;
type Channel = (typeof ALL_CHANNELS)[number];

const FILTER_STATE_KEY = "orbit:alert-filter-state";
const PRESETS_KEY = "orbit:alert-presets";

interface FilterState {
  channels: Channel[];
  unacknowledgedOnly: boolean;
  dateFrom: string;
  dateTo: string;
}

interface Preset {
  id: string;
  name: string;
  channels: Channel[];
  unacknowledgedOnly: boolean;
  dateFrom: string;
  dateTo: string;
}

function loadFilterState(): FilterState | null {
  try {
    const raw = localStorage.getItem(FILTER_STATE_KEY);
    return raw ? (JSON.parse(raw) as FilterState) : null;
  } catch {
    return null;
  }
}

function loadPresets(): Preset[] {
  try {
    const raw = localStorage.getItem(PRESETS_KEY);
    return raw ? (JSON.parse(raw) as Preset[]) : [];
  } catch {
    return [];
  }
}

function savePresetsToStorage(presets: Preset[]) {
  try {
    localStorage.setItem(PRESETS_KEY, JSON.stringify(presets));
  } catch {
    /* storage quota */
  }
}

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

function AcknowledgedBadge({ at, note }: { at: string; note?: string | null }) {
  const badge = (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm border border-border bg-muted/30 text-muted-foreground text-[10px] font-medium">
      <Check className="h-2.5 w-2.5" />
      Acknowledged {format(new Date(at), "MMM d")}
      {note && <StickyNote className="h-2.5 w-2.5 ml-0.5 text-primary/70" />}
    </span>
  );

  if (!note) return badge;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{badge}</TooltipTrigger>
      <TooltipContent side="top" className="max-w-[280px] text-[12px] whitespace-pre-wrap break-words">
        {note}
      </TooltipContent>
    </Tooltip>
  );
}

interface Props {
  appId?: string;
}

export function BudgetAlertHistory({ appId }: Props) {
  const [unacknowledgedOnly, setUnacknowledgedOnly] = useState(() => loadFilterState()?.unacknowledgedOnly ?? false);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: channelStatus } = useGetAlertChannelStatus();

  const search = useSearch();
  const [pathname, navigate] = useLocation();

  const searchParams = useMemo(() => new URLSearchParams(search), [search]);
  const startInput = searchParams.get("alertFrom") ?? "";
  const endInput = searchParams.get("alertTo") ?? "";

  function applyParams(next: URLSearchParams) {
    const qs = next.toString();
    navigate(qs ? "?" + qs : pathname, { replace: true });
  }

  function setStartInput(value: string) {
    const next = new URLSearchParams(searchParams);
    if (value) { next.set("alertFrom", value); } else { next.delete("alertFrom"); }
    applyParams(next);
  }

  function setEndInput(value: string) {
    const next = new URLSearchParams(searchParams);
    if (value) { next.set("alertTo", value); } else { next.delete("alertTo"); }
    applyParams(next);
  }

  function clearDateRange() {
    const next = new URLSearchParams(searchParams);
    next.delete("alertFrom");
    next.delete("alertTo");
    applyParams(next);
  }

  const didRestoreDates = useRef(false);
  useEffect(() => {
    if (didRestoreDates.current) return;
    didRestoreDates.current = true;
    if (!searchParams.get("alertFrom") && !searchParams.get("alertTo")) {
      const saved = loadFilterState();
      if (saved?.dateFrom || saved?.dateTo) {
        const next = new URLSearchParams(searchParams);
        if (saved.dateFrom) next.set("alertFrom", saved.dateFrom);
        if (saved.dateTo) next.set("alertTo", saved.dateTo);
        applyParams(next);
      }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
        setDialogOpen(false);
        setDialogNote("");
        setPendingId(null);
      },
    },
  });

  const [selectedChannels, setSelectedChannels] = useState<Set<Channel>>(() => {
    const saved = loadFilterState()?.channels ?? [];
    return new Set(saved.filter((ch): ch is Channel => (ALL_CHANNELS as readonly string[]).includes(ch)));
  });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [dialogNote, setDialogNote] = useState("");

  const [presets, setPresets] = useState<Preset[]>(() => loadPresets());
  const [savePresetOpen, setSavePresetOpen] = useState(false);
  const [presetName, setPresetName] = useState("");

  useEffect(() => {
    const state: FilterState = {
      channels: Array.from(selectedChannels),
      unacknowledgedOnly,
      dateFrom: startInput,
      dateTo: endInput,
    };
    try {
      localStorage.setItem(FILTER_STATE_KEY, JSON.stringify(state));
    } catch {
      /* storage quota */
    }
  }, [selectedChannels, unacknowledgedOnly, startInput, endInput]);

  function openAcknowledgeDialog(id: number) {
    setPendingId(id);
    setDialogNote("");
    setDialogOpen(true);
  }

  function handleConfirmAcknowledge() {
    if (pendingId === null) return;
    acknowledge({
      id: pendingId,
      data: dialogNote.trim() ? { note: dialogNote.trim() } : undefined,
    });
  }

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
  const isFiltered = isDateFiltered || isChannelFiltered || unacknowledgedOnly;

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
    if (!isDateFiltered && !isChannelFiltered) return entries;
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
  }, [entries, startDate, endDate, isDateFiltered, isChannelFiltered, selectedChannels]);

  function clearFilter() {
    clearDateRange();
    setSelectedChannels(new Set());
    setUnacknowledgedOnly(false);
  }

  function applyPreset(preset: Pick<Preset, "channels" | "unacknowledgedOnly" | "dateFrom" | "dateTo">) {
    setSelectedChannels(new Set(preset.channels));
    setUnacknowledgedOnly(preset.unacknowledgedOnly);
    const next = new URLSearchParams(searchParams);
    if (preset.dateFrom) { next.set("alertFrom", preset.dateFrom); } else { next.delete("alertFrom"); }
    if (preset.dateTo) { next.set("alertTo", preset.dateTo); } else { next.delete("alertTo"); }
    applyParams(next);
  }

  function handleSavePreset() {
    if (!presetName.trim()) return;
    const preset: Preset = {
      id: Date.now().toString(),
      name: presetName.trim(),
      channels: Array.from(selectedChannels),
      unacknowledgedOnly,
      dateFrom: startInput,
      dateTo: endInput,
    };
    const next = [...presets, preset];
    setPresets(next);
    savePresetsToStorage(next);
    setPresetName("");
    setSavePresetOpen(false);
  }

  function handleDeletePreset(id: string) {
    const next = presets.filter((p) => p.id !== id);
    setPresets(next);
    savePresetsToStorage(next);
  }

  const quickPicks = useMemo(() => [
    {
      label: "Teams · 7 d",
      preset: {
        channels: ["teams"] as Channel[],
        unacknowledgedOnly: false,
        dateFrom: format(subDays(new Date(), 7), "yyyy-MM-dd"),
        dateTo: "",
      },
    },
    {
      label: "Email · 30 d",
      preset: {
        channels: ["email"] as Channel[],
        unacknowledgedOnly: false,
        dateFrom: format(subDays(new Date(), 30), "yyyy-MM-dd"),
        dateTo: "",
      },
    },
    {
      label: "Unacknowledged",
      preset: { channels: [] as Channel[], unacknowledgedOnly: true, dateFrom: "", dateTo: "" },
    },
  ], []);

  const csvHeaders = appId
    ? ["Sent At", "MTD Spend", "Forecast", "Budget Cap", "Overage %", "Channels", "Acknowledged At", "Acknowledgement note"]
    : ["App", "Sent At", "MTD Spend", "Forecast", "Budget Cap", "Overage %", "Channels", "Acknowledged At", "Acknowledgement note"];

  const csvRows = filteredEntries?.map((entry) => {
    const overage = entry.budget > 0 ? (((entry.forecast - entry.budget) / entry.budget) * 100).toFixed(1) + "%" : "N/A";
    const sentAt = format(new Date(entry.sentAt), "MMM d, yyyy HH:mm");
    const channels = entry.channels.map((ch) => CHANNEL_LABELS[ch] ?? ch).join("; ");
    const acknowledgedAt = entry.acknowledgedAt ? format(new Date(entry.acknowledgedAt), "MMM d, yyyy HH:mm") : "";
    const acknowledgedNote = entry.acknowledgedNote ?? "";
    const base = [
      sentAt,
      entry.mtd.toFixed(2),
      entry.forecast.toFixed(2),
      entry.budget.toFixed(2),
      overage,
      channels,
      acknowledgedAt,
      acknowledgedNote,
    ];
    return appId ? base : [entry.appName, ...base];
  }) ?? null;

  const { copied, disabled: csvDisabled, handleExport, handleCopy } = useCsvExport(
    csvRows,
    csvHeaders,
    `budget-alert-history${appId ? `-${entries?.[0]?.appName ?? appId}` : ""}`,
    () => toast({ title: "No alerts to export", description: "There are no alert records in the current view." }),
  );

  const total = entries?.length ?? 0;
  const shown = filteredEntries?.length ?? 0;

  const channelDefs: { key: Channel; label: string; Icon: React.ElementType }[] = [
    { key: "teams", label: "Teams", Icon: MessageSquare },
    { key: "email", label: "Email", Icon: Mail },
  ];

  const channelRawCounts = useMemo<Partial<Record<Channel, number>>>(() => {
    if (!entries || entries.length === 0) return {};
    const counts: Partial<Record<Channel, number>> = {};
    for (const entry of entries) {
      for (const ch of entry.channels) {
        const key = ch as Channel;
        counts[key] = (counts[key] ?? 0) + 1;
      }
    }
    return counts;
  }, [entries]);

  const hasChannelCounts = entries && entries.length > 0 && Object.keys(channelRawCounts).length > 0;

  const hasAnyPresets = presets.length > 0;

  return (
    <>
      <Dialog open={dialogOpen} onOpenChange={(open) => {
        setDialogOpen(open);
        if (!open) {
          setDialogNote("");
          setPendingId(null);
        }
      }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold">Acknowledge alert</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <p className="text-[12px] text-muted-foreground">
              Optionally add a note explaining why this alert is safe to dismiss (e.g. "spike from load test").
            </p>
            <Textarea
              value={dialogNote}
              onChange={(e) => setDialogNote(e.target.value)}
              placeholder="Note (optional)"
              maxLength={500}
              rows={3}
              className="text-[13px] resize-none"
              autoFocus
            />
            {dialogNote.length > 0 && (
              <p className="text-[11px] text-muted-foreground text-right">{dialogNote.length}/500</p>
            )}
          </div>
          <DialogFooter className="gap-2">
            <DialogClose asChild>
              <Button variant="ghost" size="sm" className="h-7 text-[12px]">
                Cancel
              </Button>
            </DialogClose>
            <Button
              size="sm"
              className="h-7 text-[12px]"
              onClick={handleConfirmAcknowledge}
              disabled={isAcknowledging}
            >
              <Check className="h-3 w-3 mr-1" />
              Acknowledge
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="bg-card border border-border shadow-sm flex flex-col">
        <div className="flex items-center gap-2 p-3 border-b border-border flex-wrap">
          <Bell className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <h2 className="text-sm font-semibold">Alerts sent</h2>

          {channelStatus && (
            <div className="flex items-center gap-1">
              {channelDefs.map(({ key, label, Icon }) => {
                const configured = channelStatus[key];
                return (
                  <Tooltip key={key}>
                    <TooltipTrigger asChild>
                      <span
                        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm border text-[10px] font-medium ${
                          configured
                            ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                            : "border-border bg-muted/30 text-muted-foreground/50"
                        }`}
                      >
                        <Icon className="h-2.5 w-2.5 shrink-0" />
                        {label}
                        {configured ? (
                          <Check className="h-2.5 w-2.5 shrink-0" />
                        ) : (
                          <span className="text-[9px] opacity-60">off</span>
                        )}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="text-[12px]">
                      {configured
                        ? `${label} channel is configured and will receive alerts`
                        : key === "teams"
                          ? "Teams not configured — set ALERT_TEAMS_WEBHOOK_URL to enable"
                          : "Email not configured — set ALERT_SMTP_HOST, ALERT_SMTP_FROM, and ALERT_EMAIL_TO to enable"}
                    </TooltipContent>
                  </Tooltip>
                );
              })}
            </div>
          )}

          {hasChannelCounts && (
            <div className="flex items-center gap-1 pl-1 border-l border-border/50">
              {channelDefs
                .filter(({ key }) => (channelRawCounts[key] ?? 0) > 0)
                .map(({ key, label, Icon }) => {
                  const count = channelRawCounts[key]!;
                  return (
                    <span
                      key={key}
                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm border border-border bg-muted/40 text-muted-foreground text-[10px] font-medium"
                      title={`${count} alert${count === 1 ? "" : "s"} sent via ${label}`}
                    >
                      <Icon className="h-2.5 w-2.5 shrink-0" />
                      {label}
                      <span className="font-semibold text-foreground">{count}</span>
                    </span>
                  );
                })}
            </div>
          )}

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
                  onClick={clearDateRange}
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

        <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-border bg-muted/20 flex-wrap">
          <Zap className="h-3 w-3 text-muted-foreground shrink-0" />
          <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide mr-0.5">Quick picks</span>
          {quickPicks.map((qp) => (
            <button
              key={qp.label}
              onClick={() => applyPreset(qp.preset)}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-sm border border-border bg-card hover:bg-muted/60 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
              title={`Apply preset: ${qp.label}`}
            >
              {qp.label}
            </button>
          ))}

          {hasAnyPresets && (
            <>
              <span className="w-px h-3.5 bg-border/60 mx-0.5 shrink-0" />
              <Bookmark className="h-3 w-3 text-muted-foreground shrink-0" />
              {presets.map((p) => (
                <span key={p.id} className="inline-flex items-center gap-0.5 rounded-sm border border-border bg-card text-[11px]">
                  <button
                    onClick={() => applyPreset(p)}
                    className="px-2 py-0.5 text-muted-foreground hover:text-foreground transition-colors"
                    title={`Apply saved preset: ${p.name}`}
                  >
                    {p.name}
                  </button>
                  <button
                    onClick={() => handleDeletePreset(p.id)}
                    className="pr-1.5 py-0.5 text-muted-foreground/50 hover:text-destructive transition-colors"
                    title={`Delete preset "${p.name}"`}
                  >
                    <Trash2 className="h-2.5 w-2.5" />
                  </button>
                </span>
              ))}
            </>
          )}

          <div className="ml-auto flex items-center gap-1">
            {savePresetOpen ? (
              <form
                className="flex items-center gap-1"
                onSubmit={(e) => { e.preventDefault(); handleSavePreset(); }}
              >
                <Input
                  autoFocus
                  value={presetName}
                  onChange={(e) => setPresetName(e.target.value)}
                  placeholder="Preset name…"
                  maxLength={40}
                  className="h-6 text-[11px] w-[140px] px-2 py-0"
                />
                <Button type="submit" size="sm" className="h-6 text-[11px] px-2" disabled={!presetName.trim()}>
                  Save
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 text-[11px] px-1.5 text-muted-foreground"
                  onClick={() => { setSavePresetOpen(false); setPresetName(""); }}
                >
                  <X className="h-3 w-3" />
                </Button>
              </form>
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => setSavePresetOpen(true)}
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm border border-dashed border-border text-[11px] text-muted-foreground hover:text-foreground hover:border-border transition-colors"
                  >
                    <BookmarkPlus className="h-3 w-3" />
                    Save current
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-[12px]">
                  Save the current filter combination as a named preset
                </TooltipContent>
              </Tooltip>
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
                          <AcknowledgedBadge at={entry.acknowledgedAt!} note={entry.acknowledgedNote} />
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
                            onClick={() => openAcknowledgeDialog(entry.id)}
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
    </>
  );
}
