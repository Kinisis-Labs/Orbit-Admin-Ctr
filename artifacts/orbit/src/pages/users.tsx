import { useCallback, useMemo } from "react";
import { useListUserActivity, useGetStaffStats, useListClerkEventSummary, useListClerkIdentities } from "@workspace/api-client-react";
import type { ClerkIdentityRow } from "@workspace/api-client-react";
import { useUpdatedAgo } from "@/hooks/use-updated-ago";
import { useApps } from "@/hooks/use-apps";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TrendingDown, TrendingUp, ExternalLink, RefreshCw, Wifi, Shield, Users as UsersIcon } from "lucide-react";
import { PageHeader, StatusPill } from "@/components/page-header";
import { RefreshingBar } from "@/components/refreshing-bar";
import { useSearch, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { formatDistanceToNow, format } from "date-fns";
import type { AppSummary } from "@workspace/api-client-react";

const fmt = (n: number) => new Intl.NumberFormat("en-US").format(n);

const APP_TAG_SCOPE_PARAM = "appTag";

const APP_TAG_FILTERS = [
  { value: "all", label: "All" },
  { value: "orbit", label: "Orbit" },
  { value: "grailbabe", label: "Grailbabe" },
] as const;

type AppTagFilterValue = (typeof APP_TAG_FILTERS)[number]["value"];

function getApplicationTag(app: AppSummary): string | undefined {
  const tags = app.tags as Record<string, string> | undefined;
  return tags?.["Application"] ?? tags?.["application"];
}

function AppTagToggle({
  value,
  onChange,
}: {
  value: AppTagFilterValue;
  onChange: (v: AppTagFilterValue) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <label className="text-[12px] text-muted-foreground font-medium">Scope</label>
      <div className="flex items-center gap-1 rounded-sm border border-border bg-card p-0.5">
        {APP_TAG_FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => onChange(f.value)}
            aria-pressed={value === f.value}
            className={cn(
              "text-[12px] px-2.5 py-1 rounded-sm transition-colors",
              value === f.value
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-muted",
            )}
          >
            {f.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function Users() {
  const { data: apps } = useApps();
  const { data, isLoading, isFetching, refetch, dataUpdatedAt } = useListUserActivity();
  const { data: staffData, isLoading: staffLoading } = useGetStaffStats();
  const { data: eventsData, isLoading: eventsLoading } = useListClerkEventSummary();

  const search = useSearch();
  const [location, navigate] = useLocation();

  const appTagScope = useMemo((): AppTagFilterValue => {
    const v = new URLSearchParams(search).get(APP_TAG_SCOPE_PARAM)?.toLowerCase();
    if (v === "orbit" || v === "grailbabe") return v;
    return "all";
  }, [search]);

  const setAppTagScope = useCallback(
    (v: AppTagFilterValue) => {
      const params = new URLSearchParams(search);
      if (v === "all") {
        params.delete(APP_TAG_SCOPE_PARAM);
      } else {
        params.set(APP_TAG_SCOPE_PARAM, v);
      }
      const qs = params.toString();
      navigate(`${location}${qs ? `?${qs}` : ""}`, { replace: true });
    },
    [search, location, navigate],
  );

  const isGlobal = appTagScope === "all";
  const showEntra = appTagScope === "all" || appTagScope === "orbit";
  const showClerk = appTagScope === "all" || appTagScope === "grailbabe";

  const taggedAppIds = useMemo(() => {
    if (!apps || appTagScope === "all") return null;
    return new Set(
      apps
        .filter((a) => getApplicationTag(a)?.toLowerCase() === appTagScope)
        .map((a) => a.id),
    );
  }, [apps, appTagScope]);

  const activity = useMemo(() => data ?? [], [data]);
  const scopedActivity = taggedAppIds
    ? activity.filter((a) => taggedAppIds.has(a.appId))
    : activity;

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
  const liveBadge = isLoaded && isLive ? (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm border border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[10px] font-semibold uppercase tracking-wide">
      <Wifi className="h-3 w-3" />
      Live
    </span>
  ) : null;

  const staffGroups = staffData?.groups ?? [];
  const staffLive = staffData?.dataSource === "live";

  return (
    <div className="space-y-4">
      <PageHeader
        title="Users & activity"
        subtitle="Consumer end-user engagement (Clerk) and Orbit staff access (Entra ID)."
        right={
          <div className="flex items-center gap-2">
            {liveBadge}
            <AppTagToggle value={appTagScope} onChange={setAppTagScope} />
          </div>
        }
      />

      <RefreshingBar isFetching={isFetching} isLoading={isLoading} />

      {/* ── Orbit staff (Entra ID) — shown for Business Ops and global ── */}
      {showEntra && (
        <div className="bg-card border border-border shadow-sm">
          <div className="flex items-center gap-3 p-3 border-b border-border">
            <div className="shrink-0 h-8 w-8 rounded-sm bg-blue-500/10 text-blue-500 flex items-center justify-center">
              <Shield className="h-4 w-4" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-semibold">Orbit staff — Entra ID</p>
              <p className="text-[11px] text-muted-foreground">RBAC group membership counts from Microsoft Entra ID. Refreshed every 5 minutes.</p>
            </div>
            {staffLive && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm border border-blue-500/40 bg-blue-500/10 text-blue-600 dark:text-blue-400 text-[10px] font-semibold uppercase tracking-wide shrink-0">
                <Wifi className="h-3 w-3" />
                Live
              </span>
            )}
          </div>

          {staffLoading ? (
            <div className="p-4 space-y-2">
              <Skeleton className="h-8" />
              <Skeleton className="h-8" />
            </div>
          ) : staffGroups.length === 0 ? (
            <div className="p-6 text-center text-[12px] text-muted-foreground">
              {staffData?.dataSource === "unconfigured"
                ? "Entra ID not configured — set ENTRA_TENANT_ID, ENTRA_CLIENT_ID, and ENTRA_CLIENT_SECRET on the API container."
                : "No RBAC groups configured — set ENTRA_AUTHORIZED_GROUP_ID and ENTRA_COST_READER_GROUP_ID env vars."}
            </div>
          ) : (
            <Table className="text-[13px]">
              <TableHeader className="bg-muted/50 border-b border-border">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="h-8 font-semibold text-foreground">Group</TableHead>
                  <TableHead className="h-8 font-semibold text-foreground text-right">Members</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {staffGroups.map((g) => (
                  <TableRow key={g.id} className="h-8 border-b border-border/50 hover:bg-muted/40">
                    <TableCell className="py-1 font-medium">{g.name}</TableCell>
                    <TableCell className="py-1 text-right tabular-nums font-semibold">{fmt(g.memberCount)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      )}

      {/* ── Consumer end-user engagement (Clerk) — hidden for Business Ops ── */}
      {showClerk && <ClerkBanner dataUpdatedAt={dataUpdatedAt} />}

      {showClerk && <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <Tile title="Total members" value={isLoading ? null : fmt(totals.members)} sub="Across scoped applications" />
        <Tile title="DAU" value={isLoading ? null : fmt(totals.dau)} sub="Active in the last 24h" />
        <Tile title="WAU" value={isLoading ? null : fmt(totals.wau)} sub="Active in the last 7 days" />
        <Tile title="MAU" value={isLoading ? null : fmt(totals.mau)} sub="Active in the last 30 days" />
        <Tile
          title="DAU / MAU stickiness"
          value={isLoading ? null : `${stickiness.toFixed(1)}%`}
          sub={stickiness >= 20 ? "Healthy (≥20%)" : "Below target"}
        />
      </div>}

      {showClerk && <div className="bg-card border border-border shadow-sm">
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
      </div>}

      {/* ── Account event log (Clerk lifecycle events) ─────────────── */}
      {showClerk && <ClerkEventLog data={eventsData ?? []} isLoading={eventsLoading} taggedAppIds={taggedAppIds} isGlobal={isGlobal} />}
    </div>
  );
}

function ClerkIdentityTable({ appId }: { appId: string }) {
  const { data, isLoading } = useListClerkIdentities({ appId });
  const users = data ?? [];

  return (
    <div className="bg-card border border-border shadow-sm">
      <div className="flex items-center gap-3 p-3 border-b border-border">
        <div className="shrink-0 h-8 w-8 rounded-sm bg-primary/10 text-primary flex items-center justify-center">
          <UsersIcon className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-semibold">User accounts</p>
          <p className="text-[11px] text-muted-foreground">
            Individual Clerk accounts — email and account age from webhook ingestion. Most recently joined first.
          </p>
        </div>
        {!isLoading && (
          <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">
            {users.length === 50 ? "50+" : users.length} {users.length === 1 ? "account" : "accounts"}
          </span>
        )}
      </div>

      {isLoading ? (
        <div className="p-4 space-y-2">
          <Skeleton className="h-8" />
          <Skeleton className="h-8" />
          <Skeleton className="h-8" />
        </div>
      ) : users.length === 0 ? (
        <div className="p-8 text-center text-[12px] text-muted-foreground">
          No user records yet. Accounts appear here as Clerk webhooks arrive.
        </div>
      ) : (
        <Table className="text-[13px]">
          <TableHeader className="bg-muted/50 hover:bg-muted/50 border-b border-border">
            <TableRow className="hover:bg-transparent">
              <TableHead className="h-8 font-semibold text-foreground">Email</TableHead>
              <TableHead className="h-8 font-semibold text-foreground">Account age</TableHead>
              <TableHead className="h-8 font-semibold text-foreground">Last sign-in</TableHead>
              <TableHead className="h-8 font-semibold text-foreground">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((u) => (
              <ClerkIdentityRowComponent key={u.clerkUserId} user={u} />
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

function ClerkIdentityRowComponent({ user }: { user: ClerkIdentityRow }) {
  const createdDate = new Date(user.createdAt);
  const lastSignIn = user.lastSignInAt ? new Date(user.lastSignInAt) : null;

  const domainPart = user.email?.split("@")[1];
  const emailDomain = domainPart ? `@${domainPart}` : null;
  const emailLocal = user.email?.split("@")[0] ?? null;

  return (
    <TableRow className="h-9 border-b border-border/50 hover:bg-muted/40">
      <TableCell className="py-1">
        {user.email ? (
          <span className="font-mono text-[12px]">
            <span className="text-foreground font-medium">{emailLocal}</span>
            <span className="text-muted-foreground">{emailDomain}</span>
          </span>
        ) : (
          <span className="text-muted-foreground/50 text-[12px] font-mono">{user.clerkUserId}</span>
        )}
      </TableCell>
      <TableCell className="py-1 text-muted-foreground" title={format(createdDate, "PPpp")}>
        {formatDistanceToNow(createdDate, { addSuffix: true })}
      </TableCell>
      <TableCell className="py-1 text-muted-foreground">
        {lastSignIn ? (
          <span title={format(lastSignIn, "PPpp")}>{formatDistanceToNow(lastSignIn, { addSuffix: true })}</span>
        ) : (
          <span className="text-muted-foreground/40">—</span>
        )}
      </TableCell>
      <TableCell className="py-1">
        {user.deleted ? (
          <StatusPill tone="bad">Deleted</StatusPill>
        ) : (
          <StatusPill tone="ok">Active</StatusPill>
        )}
      </TableCell>
    </TableRow>
  );
}

function ClerkEventLog({
  data,
  isLoading,
  taggedAppIds,
  isGlobal,
}: {
  data: import("@workspace/api-client-react").ClerkEventSummaryRow[];
  isLoading: boolean;
  taggedAppIds: Set<string> | null;
  isGlobal: boolean;
}) {
  const relevantRows = isGlobal || !taggedAppIds
    ? data
    : data.filter((r) => taggedAppIds.has(r.appId));

  const row = relevantRows.reduce<import("@workspace/api-client-react").ClerkEventSummaryRow | null>((acc, r) => {
    if (!acc) return r;
    return {
      ...acc,
      signups7d: acc.signups7d + r.signups7d,
      signups30d: acc.signups30d + r.signups30d,
      updates7d: acc.updates7d + r.updates7d,
      updates30d: acc.updates30d + r.updates30d,
      deletions7d: acc.deletions7d + r.deletions7d,
      deletions30d: acc.deletions30d + r.deletions30d,
      daily: [],
    };
  }, null);
  const hasAny = row
    ? row.signups30d + row.updates30d + row.deletions30d > 0
    : false;

  return (
    <div className="bg-card border border-border shadow-sm">
      <div className="p-3 border-b border-border">
        <p className="text-[13px] font-semibold">Account events — last 30 days</p>
        <p className="text-[11px] text-muted-foreground">
          Lifecycle events from Clerk webhooks. Counts start from when the webhook was first configured — no historical backfill.
        </p>
      </div>

      {isLoading ? (
        <div className="p-4 space-y-2"><Skeleton className="h-8" /><Skeleton className="h-8" /></div>
      ) : !row || !hasAny ? (
        <div className="p-6 text-center text-[12px] text-muted-foreground">
          No account events yet. Events appear here as Clerk webhooks arrive.
        </div>
      ) : (
        <>
          {/* Summary tiles */}
          <div className="grid grid-cols-3 divide-x divide-border border-b border-border">
            {[
              { label: "Sign-ups", v7: row.signups7d, v30: row.signups30d, color: "text-emerald-500" },
              { label: "Profile updates", v7: row.updates7d, v30: row.updates30d, color: "text-blue-500" },
              { label: "Deletions", v7: row.deletions7d, v30: row.deletions30d, color: "text-destructive" },
            ].map(({ label, v7, v30, color }) => (
              <div key={label} className="p-3 flex flex-col gap-0.5">
                <span className="text-[11px] text-muted-foreground font-medium">{label}</span>
                <span className={`text-xl font-semibold tabular-nums ${color}`}>{fmt(v30)}</span>
                <span className="text-[11px] text-muted-foreground">{fmt(v7)} in last 7d</span>
              </div>
            ))}
          </div>

          {/* Daily timeline */}
          <Table className="text-[13px]">
            <TableHeader className="bg-muted/50 border-b border-border">
              <TableRow className="hover:bg-transparent">
                <TableHead className="h-8 font-semibold text-foreground">Date</TableHead>
                <TableHead className="h-8 font-semibold text-foreground text-right text-emerald-600 dark:text-emerald-400">Sign-ups</TableHead>
                <TableHead className="h-8 font-semibold text-foreground text-right text-blue-600 dark:text-blue-400">Updates</TableHead>
                <TableHead className="h-8 font-semibold text-foreground text-right text-destructive">Deletions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {row.daily.slice(0, 14).map((d) => (
                <TableRow key={d.day} className="h-8 border-b border-border/50 hover:bg-muted/40">
                  <TableCell className="py-1 text-muted-foreground tabular-nums">
                    {new Date(d.day + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                  </TableCell>
                  <TableCell className="py-1 text-right tabular-nums">{d.signups > 0 ? <span className="text-emerald-600 dark:text-emerald-400 font-medium">+{fmt(d.signups)}</span> : <span className="text-muted-foreground/50">—</span>}</TableCell>
                  <TableCell className="py-1 text-right tabular-nums">{d.updates > 0 ? fmt(d.updates) : <span className="text-muted-foreground/50">—</span>}</TableCell>
                  <TableCell className="py-1 text-right tabular-nums">{d.deletions > 0 ? <span className="text-destructive">{fmt(d.deletions)}</span> : <span className="text-muted-foreground/50">—</span>}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </>
      )}
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
        <span className="text-foreground font-semibold">Clerk-sourced.</span> Each consumer app's end users sign in via{" "}
        <span className="font-mono text-foreground">Clerk</span>. DAU / WAU / MAU are ingested in real time from Clerk{" "}
        <span className="font-mono text-foreground">webhooks</span>. Email addresses are captured from{" "}
        <span className="font-mono text-foreground">user.created</span> and{" "}
        <span className="font-mono text-foreground">user.updated</span> events and stored in Orbit's database.
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
