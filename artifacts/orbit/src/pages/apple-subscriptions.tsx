import { useMemo } from "react";
import { useListAppleSubscriptions } from "@workspace/api-client-react";
import { useUpdatedAgo } from "@/hooks/use-updated-ago";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TrendingDown, TrendingUp, ExternalLink, Clock, AlertTriangle, PowerOff } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { ScopeSelect } from "@/lib/scope";
import { useScope } from "@/lib/scope-context";
import { useCsvExport } from "@/hooks/use-csv-export";
import { useToast } from "@/hooks/use-toast";
import { CsvToolbar } from "@/components/csv-toolbar";
import { format } from "date-fns";
import { StaleCacheBanner } from "@/components/stale-cache-banner";
import { AdminAccessBadge } from "@/components/admin-access-badge";
import { DataSourceBadge } from "@/components/data-source-badge";

const num = (n: number) => new Intl.NumberFormat("en-US").format(n);
const usd = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

export default function AppleSubscriptions() {
  const { toast } = useToast();
  const { scope } = useScope();
  const { data, isLoading, isError, error, dataUpdatedAt } = useListAppleSubscriptions();

  const isDisabled = isError && (error as { status?: number } | null)?.status === 404;

  if (isDisabled) {
    return (
      <div className="space-y-4">
        <PageHeader
          title="App Store subscriptions"
          subtitle="Apple App Store subscription financials and subscriber states per Kinisis iOS app."
          right={
            <div className="flex items-center gap-2">
              <AdminAccessBadge />
              <ScopeSelect />
            </div>
          }
        />
        <SurfaceDisabled
          icon="AS"
          title="App Store subscriptions surface is disabled"
          description="This surface has been turned off via a feature flag in Azure App Configuration. To re-enable it, set the flag back on and redeploy (or wait for the next config refresh)."
        />
      </div>
    );
  }

  const rows = useMemo(() => data ?? [], [data]);
  const scoped = rows.filter((r) => r.appId === scope);

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
  const isLive = scoped.some((r) => r.dataSource === "live");
  const isCached = scoped.some((r) => r.dataSource === "cached");
  const badgeDataSource = scoped.length === 0
    ? undefined
    : isLive
    ? "live"
    : isCached
    ? "cached"
    : isPlaceholder
    ? "placeholder"
    : undefined;

  const staleCachedRow = useMemo(() => {
    const cached = scoped.filter((r) => r.dataSource === "cached" && !!r.dataAsOf);
    if (cached.length === 0) return null;
    return cached.reduce((oldest, r) =>
      new Date(r.dataAsOf!).getTime() < new Date(oldest.dataAsOf!).getTime() ? r : oldest,
    );
  }, [scoped]);

  const earliestDataAsOf = useMemo(() => {
    const withDate = scoped.filter((r) => !!r.dataAsOf);
    if (withDate.length === 0) return undefined;
    return withDate.reduce((oldest, r) =>
      new Date(r.dataAsOf!).getTime() < new Date(oldest.dataAsOf!).getTime() ? r : oldest,
    ).dataAsOf;
  }, [scoped]);

  const csvRows = scoped.map((r) => [
    r.appName,
    r.bundleId,
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
    ["Application", "Bundle ID", "Env", "Active", "Canceled", "Expired", "MRR", "Revenue (30d)", "Active trend %"],
    `apple-subscriptions-${scoped[0]?.appName ?? scope}`,
    () => toast({ title: "No data to export", description: "There are no subscription rows in the current view." }),
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="App Store subscriptions"
        subtitle="Apple App Store subscription financials and subscriber states per Kinisis iOS app."
        right={
          <div className="flex items-center gap-2">
            <DataSourceBadge dataSource={badgeDataSource} dataAsOf={staleCachedRow?.dataAsOf} label="App Store Connect" />
            <AdminAccessBadge />
            <ScopeSelect />
          </div>
        }
      />

      <AppleBanner placeholder={isPlaceholder} isLive={isLive} dataUpdatedAt={dataUpdatedAt} dataAsOf={earliestDataAsOf} />
      <StaleCacheBanner source="apple" dataAsOf={staleCachedRow?.dataAsOf} />

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
            <CsvToolbar
              handleExport={handleExport}
              handleCopy={handleCopy}
              disabled={csvDisabled}
              copied={copied}
            />
          </div>
        </div>
        {isLoading ? (
          <div className="p-4 space-y-2"><Skeleton className="h-8" /><Skeleton className="h-8" /></div>
        ) : (
          <Table className="text-[13px]">
            <TableHeader className="bg-muted/50 hover:bg-muted/50 border-b border-border">
              <TableRow className="hover:bg-transparent">
                <TableHead className="h-8 font-semibold text-foreground">Application</TableHead>
                <TableHead className="h-8 font-semibold text-foreground">Bundle ID</TableHead>
                <TableHead className="h-8 font-semibold text-foreground">Env</TableHead>
                <TableHead className="h-8 font-semibold text-foreground text-right">Active</TableHead>
                <TableHead className="h-8 font-semibold text-foreground text-right">Canceled</TableHead>
                <TableHead className="h-8 font-semibold text-foreground text-right">Expired</TableHead>
                <TableHead className="h-8 font-semibold text-foreground text-right">MRR</TableHead>
                <TableHead className="h-8 font-semibold text-foreground text-right">Revenue (30d)</TableHead>
                <TableHead className="h-8 font-semibold text-foreground text-right">Active trend</TableHead>
                <TableHead className="h-8 font-semibold text-foreground text-right">ASC</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {scoped.map((r) => {
                const positive = r.activeTrendPct >= 0;
                const ascUrl = r.appleAppId
                  ? `https://appstoreconnect.apple.com/apps/${r.appleAppId}/distribution/subscriptions`
                  : null;
                return (
                  <TableRow key={r.appId} className="h-8 border-b border-border/50 hover:bg-muted/40">
                    <TableCell className="py-1 font-medium text-primary">{r.appName}</TableCell>
                    <TableCell className="py-1 font-mono text-[12px]">
                      <a
                        href={`https://apps.apple.com/app/${r.bundleId}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary hover:underline inline-flex items-center gap-1"
                      >
                        {r.bundleId}
                        <ExternalLink className="h-3 w-3 shrink-0" />
                      </a>
                    </TableCell>
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
                    <TableCell className="py-1 text-right">
                      {ascUrl ? (
                        <a
                          href={ascUrl}
                          target="_blank"
                          rel="noreferrer"
                          title="Open in App Store Connect"
                          className="text-primary hover:underline inline-flex items-center gap-1 text-[12px]"
                        >
                          Manage <ExternalLink className="h-3 w-3 shrink-0" />
                        </a>
                      ) : (
                        <span className="text-muted-foreground text-[12px]">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
              {scoped.length === 0 && (
                <TableRow><TableCell colSpan={10} className="text-center py-6 text-muted-foreground">No App Store apps in scope.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}

function AppleBanner({ placeholder, isLive, dataUpdatedAt, dataAsOf }: { placeholder: boolean; isLive: boolean; dataUpdatedAt: number; dataAsOf?: string }) {
  const timestampMs = dataAsOf ? new Date(dataAsOf).getTime() : dataUpdatedAt ?? 0;
  const ago = useUpdatedAgo(timestampMs);

  const isStale = dataAsOf ? Date.now() - new Date(dataAsOf).getTime() > STALE_THRESHOLD_MS : false;

  const timestampLabel = (() => {
    if (dataAsOf) {
      const d = new Date(dataAsOf);
      const isToday = d.toDateString() === new Date().toDateString();
      const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      const label = isToday ? time : `${d.toLocaleDateString([], { month: "short", day: "numeric" })} ${time}`;
      return { text: `Data as of ${label}`, stale: isStale };
    }
    if (dataUpdatedAt) {
      const time = new Date(dataUpdatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      return { text: `${placeholder ? "Generated" : "Fetched"} at ${time}`, stale: false };
    }
    return null;
  })();

  return (
    <div className="bg-card border border-border shadow-sm p-3 flex items-start gap-3">
      <div className="shrink-0 h-8 w-8 rounded-sm bg-primary/10 text-primary flex items-center justify-center text-[11px] font-semibold">AS</div>
      <div className="flex-1 text-[12px] text-muted-foreground">
        <span className="inline-flex items-center gap-2">
          <span className="text-foreground font-semibold">{placeholder ? "Placeholder data." : "App Store Connect–sourced."}</span>
          {isLive && (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 ring-1 ring-emerald-500/20">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Live
            </span>
          )}
        </span>{" "}
        {placeholder ? (
          <>
            These figures are representative placeholders. The real feed activates automatically once three App Store Connect credentials
            are set: <span className="font-mono text-foreground">APPLE_CONNECT_ISSUER_ID</span>,{" "}
            <span className="font-mono text-foreground">APPLE_CONNECT_KEY_ID</span>, and{" "}
            <span className="font-mono text-foreground">APPLE_CONNECT_PRIVATE_KEY</span> (the contents of the .p8 file — single-download
            from App Store Connect, store it securely as it cannot be re-downloaded).
          </>
        ) : (
          <>Subscriber states and revenue are pulled live from the App Store Connect API for each tracked iOS app.</>
        )}
        {timestampLabel && (
          <span className={`inline-flex items-center gap-1 ml-2 ${timestampLabel.stale ? "text-amber-500" : "text-muted-foreground/70"}`}>
            {timestampLabel.stale ? <AlertTriangle className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
            {timestampLabel.text}
            {ago && <span>· {ago}</span>}
          </span>
        )}
      </div>
      <a
        href="https://appstoreconnect.apple.com"
        target="_blank"
        rel="noreferrer"
        className="text-primary text-[12px] inline-flex items-center gap-1 hover:underline shrink-0"
      >
        Open App Store Connect <ExternalLink className="h-3 w-3" />
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

function SurfaceDisabled({ icon, title, description }: { icon: string; title: string; description: string }) {
  return (
    <div className="bg-card border border-border shadow-sm p-4 flex items-start gap-4">
      <div className="shrink-0 h-10 w-10 rounded-sm bg-muted text-muted-foreground flex items-center justify-center">
        <PowerOff className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <div className="text-sm font-semibold text-foreground">{title}</div>
        <p className="text-[13px] text-muted-foreground mt-1">{description}</p>
        <p className="text-[12px] text-muted-foreground/60 mt-2">
          Surface identifier: <span className="font-mono">{icon.toLowerCase()}-subscriptions</span>
        </p>
      </div>
    </div>
  );
}
