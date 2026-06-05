import { useListBudgetAlertLog } from "@workspace/api-client-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Bell, BellOff } from "lucide-react";
import { format } from "date-fns";

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(n);

const CHANNEL_LABELS: Record<string, string> = {
  teams: "Teams",
  email: "Email",
};

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

interface Props {
  appId?: string;
}

export function BudgetAlertHistory({ appId }: Props) {
  const { data: entries, isLoading } = useListBudgetAlertLog(
    appId ? { appId, limit: 50 } : { limit: 50 },
  );

  return (
    <div className="bg-card border border-border shadow-sm flex flex-col">
      <div className="flex items-center gap-2 p-3 border-b border-border">
        <Bell className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <h2 className="text-sm font-semibold">Alerts sent</h2>
        {!isLoading && entries !== undefined && (
          <span className="ml-auto text-[11px] text-muted-foreground">
            {entries.length === 0 ? "No alerts on record" : `${entries.length} notification${entries.length === 1 ? "" : "s"}`}
          </span>
        )}
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
          <p className="text-sm">No budget-overrun notifications have been dispatched yet.</p>
          <p className="text-[11px] opacity-70">
            Alerts fire when the end-of-month forecast exceeds the budget cap.
            Configure <code className="font-mono">ALERT_TEAMS_WEBHOOK_URL</code> or{" "}
            <code className="font-mono">ALERT_SMTP_*</code> env vars to enable them.
          </p>
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
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((entry) => (
                <TableRow key={entry.id} className="h-9 border-b border-border/50 hover:bg-muted/40">
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
                    <OveragePill forecast={entry.forecast} budget={entry.budget} />
                  </TableCell>
                  <TableCell className="py-1">
                    <div className="flex flex-wrap gap-1">
                      {entry.channels.map((ch) => (
                        <ChannelBadge key={ch} channel={ch} />
                      ))}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
