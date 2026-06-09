import { format } from "date-fns";
import { BellOff, Check, History, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ToastAction } from "@/components/ui/toast";
import { toast } from "@/hooks/use-toast";
import { useViolationLog } from "@/hooks/use-violation-log";
import type { ViolationEntry } from "@/hooks/use-violation-log";

const METRIC_LABELS: Record<string, string> = {
  cpu: "CPU",
  mem: "Memory",
};

function MetricBadge({ metric }: { metric: string }) {
  const label = METRIC_LABELS[metric] ?? metric;
  const colorClass =
    metric === "cpu"
      ? "border-blue-500/40 bg-blue-500/10 text-blue-600 dark:text-blue-400"
      : "border-purple-500/40 bg-purple-500/10 text-purple-600 dark:text-purple-400";
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded-sm border text-[10px] font-semibold ${colorClass}`}
    >
      {label}
    </span>
  );
}

function ViolationRow({
  entry,
  showAppCol,
  onDismiss,
}: {
  entry: ViolationEntry;
  showAppCol: boolean;
  onDismiss?: (id: string) => void;
}) {
  const over = entry.value - entry.threshold;
  const pct = entry.threshold > 0 ? (over / entry.threshold) * 100 : 0;
  const valueCls =
    pct > 25
      ? "text-destructive font-medium"
      : "text-amber-600 dark:text-amber-400 font-medium";

  return (
    <tr
      className={`border-b border-border/50 h-9 hover:bg-muted/30 transition-colors group ${
        entry.dismissed ? "opacity-50" : ""
      }`}
    >
      <td className="py-1 px-3 text-[12px] text-muted-foreground whitespace-nowrap tabular-nums">
        {format(new Date(entry.timestamp), "MMM d, yyyy HH:mm")}
      </td>
      {showAppCol && (
        <td className="py-1 px-3 text-[13px] font-medium truncate max-w-[140px]">
          {entry.appName}
        </td>
      )}
      <td className="py-1 px-3">
        <MetricBadge metric={entry.metric} />
      </td>
      <td className="py-1 px-3 tabular-nums">
        <span className={valueCls}>{entry.value.toFixed(1)}%</span>
        <span className="text-[11px] text-muted-foreground ml-1.5">
          (+{over.toFixed(1)}% over {entry.threshold.toFixed(0)}%)
        </span>
      </td>
      <td className="py-1 px-3">
        {entry.dismissed ? (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm border border-border bg-muted/30 text-muted-foreground text-[10px] font-medium">
            <Check className="h-2.5 w-2.5" />
            Dismissed
          </span>
        ) : (
          <span className="inline-flex items-center px-1.5 py-0.5 rounded-sm border border-destructive/30 bg-destructive/10 text-destructive text-[10px] font-medium">
            Active
          </span>
        )}
      </td>
      <td className="py-1 px-3">
        <span className="inline-flex h-1.5 w-1.5 rounded-full bg-destructive" title="Not yet seen"
          style={{ visibility: entry.seen ? "hidden" : "visible" }}
        />
      </td>
      {onDismiss && (
        <td className="py-1 px-2">
          <button
            type="button"
            onClick={() => onDismiss(entry.id)}
            title="Dismiss this entry"
            className="opacity-0 group-hover:opacity-100 transition-opacity inline-flex items-center justify-center h-5 w-5 rounded-sm text-muted-foreground hover:text-destructive hover:bg-destructive/10"
          >
            <X className="h-3 w-3" />
          </button>
        </td>
      )}
    </tr>
  );
}

const UNDO_DURATION_MS = 4000;

export function ViolationLogPanel({ appId }: { appId?: string } = {}) {
  const { entries, unseenCount, markSeen, clear, clearByApp, removeById, restoreEntry } = useViolationLog();

  const filtered = appId ? entries.filter((e) => e.appId === appId) : entries;
  const filteredUnseen = filtered.filter((e) => !e.seen).length;
  const showAppCol = !appId;

  function handleDismiss(id: string) {
    const entry = entries.find((e) => e.id === id);
    if (!entry) return;
    removeById(id);
    const { dismiss } = toast({
      description: "Violation dismissed.",
      duration: UNDO_DURATION_MS,
      action: (
        <ToastAction
          altText="Undo dismiss"
          onClick={() => {
            restoreEntry(entry);
            dismiss();
          }}
        >
          Undo
        </ToastAction>
      ),
    });
  }

  return (
    <div className="bg-card border border-border shadow-sm flex flex-col">
      <div className="flex items-center gap-2 p-3 border-b border-border flex-wrap">
        <History className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <h2 className="text-sm font-semibold">Client-side threshold violations</h2>
        {filteredUnseen > 0 && (
          <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-destructive text-white text-[10px] font-bold leading-none">
            {filteredUnseen > 99 ? "99+" : filteredUnseen}
          </span>
        )}
        <span className="text-[11px] text-muted-foreground ml-0.5">
          Persisted in this browser — entries older than 24 hours are pruned automatically
        </span>
        <div className="flex items-center gap-1.5 ml-auto">
          {unseenCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-[11px] px-2 rounded-sm text-muted-foreground hover:text-foreground"
              onClick={markSeen}
              title="Mark all violations as seen"
            >
              Mark all seen
            </Button>
          )}
          {filtered.length > 0 && appId && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-[11px] px-2 rounded-sm text-muted-foreground hover:text-destructive"
              onClick={() => clearByApp(appId)}
              title="Clear this app's violations"
            >
              <Trash2 className="h-3 w-3 mr-1" />
              Clear app violations ({filtered.length})
            </Button>
          )}
          {entries.length > 0 && !appId && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-[11px] px-2 rounded-sm text-muted-foreground hover:text-destructive"
              onClick={clear}
              title="Clear violation log"
            >
              <Trash2 className="h-3 w-3 mr-1" />
              Clear
            </Button>
          )}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 py-10 text-muted-foreground">
          <BellOff className="h-6 w-6 opacity-40" />
          <p className="text-sm">No threshold violations in the last 24 hours.</p>
          <p className="text-[11px] opacity-70 text-center max-w-xs">
            When a metric crosses a configured threshold, the event is recorded here so you can review what fired — even after the toast has been dismissed.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="bg-muted/50 border-b border-border">
              <tr>
                <th className="h-8 px-3 text-left text-[12px] font-semibold text-foreground whitespace-nowrap w-[160px]">
                  Detected at
                </th>
                {showAppCol && (
                  <th className="h-8 px-3 text-left text-[12px] font-semibold text-foreground w-[140px]">
                    App
                  </th>
                )}
                <th className="h-8 px-3 text-left text-[12px] font-semibold text-foreground w-[80px]">
                  Metric
                </th>
                <th className="h-8 px-3 text-left text-[12px] font-semibold text-foreground">
                  Observed value
                </th>
                <th className="h-8 px-3 text-left text-[12px] font-semibold text-foreground w-[110px]">
                  Status
                </th>
                <th className="h-8 px-3 w-5" />
                {appId && <th className="h-8 px-2 w-7" />}
              </tr>
            </thead>
            <tbody>
              {filtered.map((entry) => (
                <ViolationRow
                  key={entry.id}
                  entry={entry}
                  showAppCol={showAppCol}
                  onDismiss={appId ? handleDismiss : undefined}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
