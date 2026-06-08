import { useMemo } from "react";
import { useListUserActivity } from "@workspace/api-client-react";
import { useUpdatedAgo } from "@/hooks/use-updated-ago";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TrendingDown, TrendingUp, ExternalLink, RefreshCw, Wifi } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { RefreshingBar } from "@/components/refreshing-bar";
import { ScopeSelect } from "@/lib/scope";
import { useScope } from "@/lib/scope-context";

const fmt = (n: number) => new Intl.NumberFormat("en-US").format(n);

export default function Users() {
  const { scope } = useScope();
  const { data, isLoading, isFetching, refetch, dataUpdatedAt } = useListUserActivity();

  const activity = useMemo(() => data ?? [], [data]);
  const scopedActivity = activity.filter((a) => a.appId === scope);

  const totals = scopedActivity.reduce(
    (acc, r) => ({
      members: acc.members + r.totalMembers,
      dau: acc.dau + r.dau,
      wau: acc.wau + r.wau,
      mau: acc.mau + r.mau,
      inactive: acc.inactive + r.inactive30d,
    }),
    { members: 0, dau: 0, wau: 0, mau: 0, inactive: 0 },
  );
  const stickiness = totals.mau > 0 ? (totals.dau / totals.mau) * 100 : 0;

  const isLoaded = !isLoading && data != null;
  const isLive = isLoaded && activity.some((a) => a.dataSource === "live");
  const liveBadge = isLoaded ? (
    isLive ? (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm border border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[10px] font-semibold uppercase tracking-wide">
        <Wifi className="h-3 w-3" />
        Live
      </span>
    ) : (
      <span className="inline-flex items-center px-1.5 py-0.5 rounded-sm border border-border bg-muted text-muted-foreground text-[10px] font-semibold uppercase tracking-wide">
        Demo
      </span>
    )
  ) : null;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Users & activity"
        subtitle="Active vs inactive end users per Kinisis consumer app. Source of truth: Clerk webhook ingestion (anonymous counts)."
        right={
          <div className="flex items-center gap-2">
            {liveBadge}
            <ScopeSelect />
          </div>
        }
      />

      <RefreshingBar isFetching={isFetching} isLoading={isLoading} />

      <ClerkBanner dataUpdatedAt={dataUpdatedAt} />

      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <Tile title="Total members" value={isLoading ? null : fmt(totals.members)} sub="Across scoped applications" />
        <Tile title="DAU" value={isLoading ? null : fmt(totals.dau)} sub="Active in the last 24h" />
        <Tile title="WAU" value={isLoading ? null : fmt(totals.wau)} sub="Active in the last 7 days" />
        <Tile title="MAU" value={isLoading ? null : fmt(totals.mau)} sub="Active in the last 30 days" />
        <Tile
          title="DAU / MAU stickiness"
          value={isLoading ? null : `${stickiness.toFixed(1)}%`}
          sub={stickiness >= 20 ? "Healthy (≥20%)" : "Below target"}
        />
      </div>

      <div className="bg-card border border-border shadow-sm">
        <div className="flex items-center justify-between p-2 border-b border-border">
          <h2 className="text-sm font-semibold px-2">Engagement by application</h2>
          <button
            type="button"
            onClick={() => void refetch()}
            disabled={isFetching}
            aria-label="Refresh user activity"
            title="Refresh user activity now"
            className={`flex items-center justify-center rounded p-1 transition-colors mr-1 ${
              isFetching
                ? "cursor-not-allowed text-primary opacity-60"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
            }`}
          >
            <RefreshCw className={`h-3.5 w-3.5${isFetching ? " animate-spin" : ""}`} />
          </button>
        </div>
        {isLoading ? (
          <div className="p-4 space-y-2"><Skeleton className="h-8" /><Skeleton className="h-8" /></div>
        ) : (
          <Table className="text-[13px]">
            <TableHeader className="bg-muted/50 hover:bg-muted/50 border-b border-border">
              <TableRow className="hover:bg-transparent">
                <TableHead className="h-8 font-semibold text-foreground">Application</TableHead>
                <TableHead className="h-8 font-semibold text-foreground">Env</TableHead>
                <TableHead className="h-8 font-semibold text-foreground text-right">Members</TableHead>
                <TableHead className="h-8 font-semibold text-foreground text-right">DAU</TableHead>
                <TableHead className="h-8 font-semibold text-foreground text-right">WAU</TableHead>
                <TableHead className="h-8 font-semibold text-foreground text-right">MAU</TableHead>
                <TableHead className="h-8 font-semibold text-foreground text-right">Inactive 30d</TableHead>
                <TableHead className="h-8 font-semibold text-foreground text-right">New (7d)</TableHead>
                <TableHead className="h-8 font-semibold text-foreground text-right">DAU trend</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {scopedActivity.map((r) => {
                const positive = r.dauTrendPct >= 0;
                return (
                  <TableRow key={r.appId} className="h-8 border-b border-border/50 hover:bg-muted/40">
                    <TableCell className="py-1 font-medium text-primary">{r.appName}</TableCell>
                    <TableCell className="py-1 text-muted-foreground">{r.environment}</TableCell>
                    <TableCell className="py-1 text-right tabular-nums">{fmt(r.totalMembers)}</TableCell>
                    <TableCell className="py-1 text-right tabular-nums">{fmt(r.dau)}</TableCell>
                    <TableCell className="py-1 text-right tabular-nums">{fmt(r.wau)}</TableCell>
                    <TableCell className="py-1 text-right tabular-nums">{fmt(r.mau)}</TableCell>
                    <TableCell className="py-1 text-right tabular-nums text-muted-foreground">{fmt(r.inactive30d)}</TableCell>
                    <TableCell className="py-1 text-right tabular-nums">{fmt(r.newLast7d)}</TableCell>
                    <TableCell className="py-1 text-right tabular-nums">
                      <span className={`inline-flex items-center gap-1 ${positive ? "text-emerald-500" : "text-destructive"}`}>
                        {positive ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                        {positive ? "+" : ""}{r.dauTrendPct}%
                      </span>
                    </TableCell>
                  </TableRow>
                );
              })}
              {scopedActivity.length === 0 && (
                <TableRow><TableCell colSpan={9} className="text-center py-6 text-muted-foreground">No activity yet. Counts populate as Clerk webhooks arrive.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}

function ClerkBanner({ dataUpdatedAt }: { dataUpdatedAt: number }) {
  const ago = useUpdatedAgo(dataUpdatedAt);
  const timestampLabel = dataUpdatedAt > 0
    ? `Data as of ${new Date(dataUpdatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`
    : null;

  return (
    <div className="bg-card border border-border shadow-sm p-3 flex items-start gap-3">
      <div className="shrink-0 h-8 w-8 rounded-sm bg-primary/10 text-primary flex items-center justify-center text-[11px] font-semibold">CK</div>
      <div className="flex-1 text-[12px] text-muted-foreground">
        <span className="text-foreground font-semibold">Clerk-sourced, anonymous.</span> Each consumer app's end users sign in via{" "}
        <span className="font-mono text-foreground">Clerk</span>. DAU / WAU / MAU are ingested in real time from Clerk{" "}
        <span className="font-mono text-foreground">webhooks</span> and stored as aggregate rollups — only an opaque user id and
        timestamps are kept, never emails or names. (Orbit staff still authenticate via corporate Entra ID.)
        {timestampLabel && (
          <span className="block mt-1 text-[11px] text-muted-foreground/70 tabular-nums">
            {timestampLabel}{ago ? <span className="text-muted-foreground/50"> · {ago}</span> : null}
          </span>
        )}
      </div>
      <a
        href="https://dashboard.clerk.com"
        target="_blank"
        rel="noreferrer"
        className="text-primary text-[12px] inline-flex items-center gap-1 hover:underline shrink-0"
      >
        Open Clerk dashboard <ExternalLink className="h-3 w-3" />
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
