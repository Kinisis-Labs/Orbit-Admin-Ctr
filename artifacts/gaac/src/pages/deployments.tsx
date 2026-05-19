import { useMemo, useState } from "react";
import { useListApps } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Download, RefreshCw, Search } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { ScopeSelect, useScope } from "@/lib/scope";
import { PageHeader, StatusPill } from "@/components/page-header";
import { buildDeployments, type DeploymentStatus } from "@/lib/mock-data";

const STATUS_TONE: Record<DeploymentStatus, "ok" | "warn" | "bad" | "info"> = {
  Succeeded: "ok",
  InProgress: "info",
  Failed: "bad",
  RolledBack: "warn",
};

export default function Deployments() {
  const { scope, isGlobal } = useScope();
  const { data: apps, isLoading } = useListApps();
  const [filter, setFilter] = useState("");

  const deployments = useMemo(() => (apps ? buildDeployments(apps) : []), [apps]);
  const filtered = useMemo(() => {
    let rows = isGlobal ? deployments : deployments.filter((d) => d.appId === scope);
    if (filter) {
      const f = filter.toLowerCase();
      rows = rows.filter(
        (d) =>
          d.appName.toLowerCase().includes(f) ||
          d.version.toLowerCase().includes(f) ||
          d.triggeredBy.toLowerCase().includes(f) ||
          d.commitSha.includes(f),
      );
    }
    return rows;
  }, [deployments, scope, isGlobal, filter]);

  const succeeded = filtered.filter((d) => d.status === "Succeeded").length;
  const inProgress = filtered.filter((d) => d.status === "InProgress").length;
  const failed = filtered.filter((d) => d.status === "Failed" || d.status === "RolledBack").length;
  const successRate = filtered.length ? Math.round((succeeded / filtered.length) * 100) : 0;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Deployments"
        subtitle={isGlobal ? "Release activity across all applications" : `Scoped to selected application`}
        right={<ScopeSelect />}
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Tile title="Total" value={isLoading ? null : filtered.length.toString()} sub="Last 30 days" />
        <Tile title="Success rate" value={isLoading ? null : `${successRate}%`} sub={`${succeeded} succeeded`} />
        <Tile title="In progress" value={isLoading ? null : inProgress.toString()} sub="Active rollouts" />
        <Tile title="Failed / rolled back" value={isLoading ? null : failed.toString()} sub="Requires review" />
      </div>

      <div className="bg-card border border-border shadow-sm flex flex-col">
        <div className="flex items-center justify-between p-2 border-b border-border bg-card gap-2 flex-wrap">
          <h2 className="text-sm font-semibold px-2">Deployment history</h2>
          <div className="flex items-center gap-1">
            <div className="relative">
              <Search className="h-3.5 w-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter app, version, commit, deployer"
                className="h-7 w-72 pl-7 text-[12px] rounded-sm"
              />
            </div>
            <Button variant="ghost" size="sm" className="h-7 text-xs px-2 rounded-sm text-primary">
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
              Refresh
            </Button>
            <Button variant="ghost" size="sm" className="h-7 text-xs px-2 rounded-sm text-primary">
              <Download className="h-3.5 w-3.5 mr-1.5" />
              Export
            </Button>
          </div>
        </div>
        <div className="overflow-x-auto">
          {isLoading ? (
            <div className="p-4 space-y-2">
              <Skeleton className="h-8" /><Skeleton className="h-8" /><Skeleton className="h-8" />
            </div>
          ) : (
            <Table className="text-[13px]">
              <TableHeader className="bg-muted/50 hover:bg-muted/50 border-b border-border">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="h-8 font-semibold text-foreground">Application</TableHead>
                  <TableHead className="h-8 font-semibold text-foreground">Env</TableHead>
                  <TableHead className="h-8 font-semibold text-foreground">Version</TableHead>
                  <TableHead className="h-8 font-semibold text-foreground">Status</TableHead>
                  <TableHead className="h-8 font-semibold text-foreground">Triggered by</TableHead>
                  <TableHead className="h-8 font-semibold text-foreground">Commit</TableHead>
                  <TableHead className="h-8 font-semibold text-foreground">Started</TableHead>
                  <TableHead className="h-8 font-semibold text-foreground text-right">Duration</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((d) => (
                  <TableRow key={d.id} className="h-8 border-b border-border/50 hover:bg-muted/40">
                    <TableCell className="py-1 font-medium text-primary">{d.appName}</TableCell>
                    <TableCell className="py-1 text-muted-foreground">{d.environment}</TableCell>
                    <TableCell className="py-1 font-mono text-[12px]">{d.version}</TableCell>
                    <TableCell className="py-1"><StatusPill tone={STATUS_TONE[d.status]}>{d.status}</StatusPill></TableCell>
                    <TableCell className="py-1 text-muted-foreground">{d.triggeredBy}</TableCell>
                    <TableCell className="py-1 font-mono text-[12px]">{d.commitSha}</TableCell>
                    <TableCell className="py-1 text-muted-foreground" title={format(new Date(d.startedAt), "PPpp")}>
                      {formatDistanceToNow(new Date(d.startedAt), { addSuffix: true })}
                    </TableCell>
                    <TableCell className="py-1 text-right tabular-nums">
                      {Math.floor(d.durationSec / 60)}m {d.durationSec % 60}s
                    </TableCell>
                  </TableRow>
                ))}
                {filtered.length === 0 && (
                  <TableRow><TableCell colSpan={8} className="text-center py-6 text-muted-foreground">No deployments match.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </div>
      </div>
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
