import { useMemo, useState } from "react";
import { useListApps } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, Download, TrendingDown, TrendingUp, ExternalLink } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { PageHeader, StatusPill } from "@/components/page-header";
import { buildUserActivity, buildUserSample, type UserRecord } from "@/lib/mock-data";
import { ScopeSelect, useScope } from "@/lib/scope";

const STATE_TONE: Record<UserRecord["state"], "ok" | "warn" | "muted"> = {
  Active: "ok",
  Idle: "warn",
  Inactive: "muted",
};

const fmt = (n: number) => new Intl.NumberFormat("en-US").format(n);

export default function Users() {
  const { scope, isGlobal } = useScope();
  const { data: apps, isLoading } = useListApps();
  const [filter, setFilter] = useState("");

  const activity = useMemo(() => (apps ? buildUserActivity(apps) : []), [apps]);
  const users = useMemo(() => (apps ? buildUserSample(apps, 10) : []), [apps]);

  const scopedActivity = isGlobal ? activity : activity.filter((a) => a.appId === scope);
  const scopedUsers = isGlobal ? users : users.filter((u) => u.appId === scope);
  const filteredUsers = filter
    ? scopedUsers.filter((u) =>
        u.email.toLowerCase().includes(filter.toLowerCase()) ||
        u.fullName.toLowerCase().includes(filter.toLowerCase()) ||
        u.appName.toLowerCase().includes(filter.toLowerCase()),
      )
    : scopedUsers;

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

  return (
    <div className="space-y-4">
      <PageHeader
        title="Users & activity"
        subtitle="Active vs inactive users per Kinisis application. Source of truth: Clerk Organizations + session webhooks."
        right={<ScopeSelect />}
      />

      <ClerkBanner />

      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <Tile title="Total members" value={isLoading ? null : fmt(totals.members)} sub="Across scoped applications" />
        <Tile title="DAU" value={isLoading ? null : fmt(totals.dau)} sub="Signed in in the last 24h" />
        <Tile title="WAU" value={isLoading ? null : fmt(totals.wau)} sub="Active in the last 7 days" />
        <Tile title="MAU" value={isLoading ? null : fmt(totals.mau)} sub="Active in the last 30 days" />
        <Tile
          title="DAU / MAU stickiness"
          value={isLoading ? null : `${stickiness.toFixed(1)}%`}
          sub={stickiness >= 20 ? "Healthy (≥20%)" : "Below target"}
        />
      </div>

      <div className="bg-card border border-border shadow-sm">
        <div className="p-2 border-b border-border"><h2 className="text-sm font-semibold px-2">Engagement by application</h2></div>
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
            </TableBody>
          </Table>
        )}
      </div>

      <div className="bg-card border border-border shadow-sm">
        <div className="flex items-center justify-between p-2 border-b border-border gap-2 flex-wrap">
          <h2 className="text-sm font-semibold px-2">Recent users {filteredUsers.length ? `(${filteredUsers.length})` : ""}</h2>
          <div className="flex items-center gap-1">
            <div className="relative">
              <Search className="h-3.5 w-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter by name, email, app" className="h-7 w-72 pl-7 text-[12px] rounded-sm" />
            </div>
            <Button variant="ghost" size="sm" className="h-7 text-xs px-2 rounded-sm text-primary">
              <Download className="h-3.5 w-3.5 mr-1.5" /> Export
            </Button>
          </div>
        </div>
        {isLoading ? (
          <div className="p-4 space-y-2"><Skeleton className="h-8" /><Skeleton className="h-8" /></div>
        ) : (
          <Table className="text-[13px]">
            <TableHeader className="bg-muted/50 hover:bg-muted/50 border-b border-border">
              <TableRow className="hover:bg-transparent">
                <TableHead className="h-8 font-semibold text-foreground">User</TableHead>
                <TableHead className="h-8 font-semibold text-foreground">Application</TableHead>
                <TableHead className="h-8 font-semibold text-foreground">State</TableHead>
                <TableHead className="h-8 font-semibold text-foreground">Last active</TableHead>
                <TableHead className="h-8 font-semibold text-foreground">Last sign-in</TableHead>
                <TableHead className="h-8 font-semibold text-foreground">Member since</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredUsers.map((u) => (
                <TableRow key={u.id} className="h-8 border-b border-border/50 hover:bg-muted/40">
                  <TableCell className="py-1">
                    <div className="font-medium">{u.fullName}</div>
                    <div className="text-[11px] text-muted-foreground">{u.email}</div>
                  </TableCell>
                  <TableCell className="py-1 text-primary">{u.appName}</TableCell>
                  <TableCell className="py-1"><StatusPill tone={STATE_TONE[u.state]}>{u.state}</StatusPill></TableCell>
                  <TableCell className="py-1 text-muted-foreground" title={format(new Date(u.lastActiveAt), "PPpp")}>{formatDistanceToNow(new Date(u.lastActiveAt), { addSuffix: true })}</TableCell>
                  <TableCell className="py-1 text-muted-foreground">{formatDistanceToNow(new Date(u.lastSignInAt), { addSuffix: true })}</TableCell>
                  <TableCell className="py-1 text-muted-foreground">{format(new Date(u.createdAt), "yyyy-MM-dd")}</TableCell>
                </TableRow>
              ))}
              {filteredUsers.length === 0 && (
                <TableRow><TableCell colSpan={6} className="text-center py-6 text-muted-foreground">No users match.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}

function ClerkBanner() {
  return (
    <div className="bg-card border border-border shadow-sm p-3 flex items-start gap-3">
      <div className="shrink-0 h-8 w-8 rounded-sm bg-primary/10 text-primary flex items-center justify-center text-[11px] font-semibold">CK</div>
      <div className="flex-1 text-[12px] text-muted-foreground">
        <span className="text-foreground font-semibold">Mock data.</span> When the Clerk integration is enabled, each Kinisis app will be a Clerk{" "}
        <span className="font-mono text-foreground">Organization</span>. DAU / WAU / MAU will be computed from{" "}
        <span className="font-mono text-foreground">session.created</span> webhooks, and Active / Idle / Inactive states from{" "}
        <span className="font-mono text-foreground">user.last_active_at</span>.
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
