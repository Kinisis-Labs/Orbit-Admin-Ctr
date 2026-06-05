import { useMemo } from "react";
import { useListPlaySubscriptions } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TrendingDown, TrendingUp, ExternalLink, Download, Clipboard, Check } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { ScopeSelect } from "@/lib/scope";
import { useScope } from "@/lib/scope-context";
import { Button } from "@/components/ui/button";
import { useCsvExport } from "@/hooks/use-csv-export";
import { StaleCacheBanner, STALE_CACHE_MS } from "@/components/stale-cache-banner";

const num = (n: number) => new Intl.NumberFormat("en-US").format(n);
const usd = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

export default function PlaySubscriptions() {
  const { scope, isGlobal } = useScope();
  const { data, isLoading } = useListPlaySubscriptions();

  const rows = useMemo(() => data ?? [], [data]);
  const scoped = isGlobal ? rows : rows.filter((r) => r.appId === scope);

  const totals = scoped.reduce(
    (acc, r) => ({
      active: acc.active + r.activeSubscribers,
      canceled: acc.canceled + r.canceledSubscribers,
      expired: acc.expired + r.expiredSubscribers,
      mrr: acc.mrr + r.mrr,
      revenue: acc.revenue + r.revenueLast30d,
    }),
    { active: 0, canceled: 0, expired: 0, mrr: 0, revenue: 0 },
  );
  const isPlaceholder = scoped.some((r) => r.dataSource === "placeholder");

  const staleCachedRow = useMemo(() => {
    const cached = scoped.filter((r) => r.dataSource === "cached" && !!r.dataAsOf);
    if (cached.length === 0) return null;
    // Pick the row with the oldest dataAsOf to surface the worst-case staleness.
    return cached.reduce((oldest, r) =>
      new Date(r.dataAsOf!).getTime() < new Date(oldest.dataAsOf!).getTime() ? r : oldest,
    );
  }, [scoped]);

  const csvRows = scoped.map((r) => [
    r.appName,
    r.packageName,
    r.environment,
    String(r.activeSubscribers),
    String(r.canceledSubscribers),
    String(r.expiredSubscribers),
    r.mrr.toFixed(2),
    r.revenueLast30d.toFixed(2),
    String(r.activeTrendPct),
  ]);
  const { copied, disabled: csvDisabled, handleExport, handleCopy } = useCsvExport(
    csvRows,
    ["Application", "Package", "Env", "Active", "Canceled", "Expired", "MRR", "Revenue (30d)", "Active trend %"],
    "play-subscriptions",
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="Play subscriptions"
        subtitle="Google Play subscription financials and subscriber states per Kinisis Android app."
        right={<ScopeSelect />}
      />

      <PlayBanner placeholder={isPlaceholder} />
      <StaleCacheBanner
        dataAsOf={staleCachedRow?.dataAsOf}
        label="Google Play"
        liveText="live subscriber counts may differ"
      />

      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <Tile title="Active subscribers" value={isLoading ? null : num(totals.active)} sub="Currently paying" />
        <Tile title="Canceled" value={isLoading ? null : num(totals.canceled)} sub="Auto-renew off, still in term" />
        <Tile title="Expired" value={isLoading ? null : num(totals.expired)} sub="Lapsed / inactive" />
        <Tile title="MRR" value={isLoading ? null : usd(totals.mrr)} sub="Monthly recurring revenue" />
        <Tile title="Revenue (30d)" value={isLoading ? null : usd(totals.revenue)} sub="Trailing 30 days" />
      </div>

      <div className="bg-card border border-border shadow-sm">
        <div className="flex items-center justify-between p-2 border-b border-border">
          <h2 className="text-sm font-semibold px-2">Subscriptions by application</h2>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs px-2 rounded-sm text-primary hover:text-primary hover:bg-primary/10"
              onClick={handleExport}
              disabled={csvDisabled}
            >
              <Download className="h-3.5 w-3.5 mr-1.5" />
              Export
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs px-2 rounded-sm text-primary hover:text-primary hover:bg-primary/10"
              onClick={handleCopy}
              disabled={csvDisabled}
            >
              {copied ? (
                <>
                  <Check className="h-3.5 w-3.5 mr-1.5 text-green-500" />
                  <span className="text-green-500">Copied!</span>
                </>
              ) : (
                <>
                  <Clipboard className="h-3.5 w-3.5 mr-1.5" />
                  Copy
                </>
              )}
            </Button>
          </div>
        </div>
        {isLoading ? (
          <div className="p-4 space-y-2"><Skeleton className="h-8" /><Skeleton className="h-8" /></div>
        ) : (
          <Table className="text-[13px]">
            <TableHeader className="bg-muted/50 hover:bg-muted/50 border-b border-border">
              <TableRow className="hover:bg-transparent">
                <TableHead className="h-8 font-semibold text-foreground">Application</TableHead>
                <TableHead className="h-8 font-semibold text-foreground">Package</TableHead>
                <TableHead className="h-8 font-semibold text-foreground">Env</TableHead>
                <TableHead className="h-8 font-semibold text-foreground text-right">Active</TableHead>
                <TableHead className="h-8 font-semibold text-foreground text-right">Canceled</TableHead>
                <TableHead className="h-8 font-semibold text-foreground text-right">Expired</TableHead>
                <TableHead className="h-8 font-semibold text-foreground text-right">MRR</TableHead>
                <TableHead className="h-8 font-semibold text-foreground text-right">Revenue (30d)</TableHead>
                <TableHead className="h-8 font-semibold text-foreground text-right">Active trend</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {scoped.map((r) => {
                const positive = r.activeTrendPct >= 0;
                return (
                  <TableRow key={r.appId} className="h-8 border-b border-border/50 hover:bg-muted/40">
                    <TableCell className="py-1 font-medium text-primary">{r.appName}</TableCell>
                    <TableCell className="py-1 font-mono text-[12px] text-muted-foreground">{r.packageName}</TableCell>
                    <TableCell className="py-1 text-muted-foreground">{r.environment}</TableCell>
                    <TableCell className="py-1 text-right tabular-nums">{num(r.activeSubscribers)}</TableCell>
                    <TableCell className="py-1 text-right tabular-nums text-muted-foreground">{num(r.canceledSubscribers)}</TableCell>
                    <TableCell className="py-1 text-right tabular-nums text-muted-foreground">{num(r.expiredSubscribers)}</TableCell>
                    <TableCell className="py-1 text-right tabular-nums">{usd(r.mrr)}</TableCell>
                    <TableCell className="py-1 text-right tabular-nums">{usd(r.revenueLast30d)}</TableCell>
                    <TableCell className="py-1 text-right tabular-nums">
                      <span className={`inline-flex items-center gap-1 ${positive ? "text-emerald-500" : "text-destructive"}`}>
                        {positive ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                        {positive ? "+" : ""}{r.activeTrendPct}%
                      </span>
                    </TableCell>
                  </TableRow>
                );
              })}
              {scoped.length === 0 && (
                <TableRow><TableCell colSpan={9} className="text-center py-6 text-muted-foreground">No Google Play apps in scope.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}


function PlayBanner({ placeholder }: { placeholder: boolean }) {
  return (
    <div className="bg-card border border-border shadow-sm p-3 flex items-start gap-3">
      <div className="shrink-0 h-8 w-8 rounded-sm bg-primary/10 text-primary flex items-center justify-center text-[11px] font-semibold">GP</div>
      <div className="flex-1 text-[12px] text-muted-foreground">
        <span className="text-foreground font-semibold">{placeholder ? "Placeholder data." : "Google Play–sourced."}</span>{" "}
        {placeholder ? (
          <>
            GrailBabe is still in Google Play testing, so these figures are representative placeholders. The real feed activates
            automatically once the keyless Google Play connection (Workload Identity Federation — no downloadable JSON key) is
            provisioned: subscriber states from the Android Publisher API and revenue from Play earnings reports.
          </>
        ) : (
          <>Subscriber states and revenue are pulled live from the Google Play Developer APIs for each tracked Android app.</>
        )}
      </div>
      <a
        href="https://play.google.com/console"
        target="_blank"
        rel="noreferrer"
        className="text-primary text-[12px] inline-flex items-center gap-1 hover:underline shrink-0"
      >
        Open Play Console <ExternalLink className="h-3 w-3" />
      </a>
    </div>
  );
}

function Tile({ title, value, sub }: { title: string; value: string | null; sub: string }) {
  return (
    <div className="bg-card border border-border p-3 shadow-sm flex flex-col justify-between">
      <div className="text-[12px] text-muted-foreground font-medium mb-1 truncate">{title}</div>
      {value === null ? <Skeleton className="h-7 w-20 mb-1" /> : <div className="text-xl font-semibold tabular-nums mb-1">{value}</div>}
      <div className="text-[11px] text-muted-foreground truncate">{sub}</div>
    </div>
  );
}
