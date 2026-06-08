import { useMemo, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { listDeployments, getListDeploymentsQueryKey } from "@workspace/api-client-react";
import { useApps } from "@/hooks/use-apps";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Download, RefreshCw, Search, GitBranch } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { ScopeSelect } from "@/lib/scope";
import { useScope } from "@/lib/scope-context";
import { PageHeader, StatusPill } from "@/components/page-header";
import type { Deployment } from "@workspace/api-client-react";

type DeploymentStatus = Deployment["status"];

const STATUS_TONE: Record<DeploymentStatus, "ok" | "warn" | "bad" | "info"> = {
  Succeeded: "ok",
  InProgress: "info",
  Failed: "bad",
  RolledBack: "warn",
};

export default function Deployments() {
  const { scope } = useScope();
  const { data: apps, isLoading: appsLoading } = useApps();
  const [filter, setFilter] = useState("");

  const selectedApp = apps?.find((a) => a.id === scope);

  const appsToQuery = useMemo(() => {
    if (!apps) return [];
    return apps.filter((a) => a.id === scope);
  }, [apps, scope]);

  const deploymentQueries = useQueries({
    queries: appsToQuery.map((app) => ({
      queryKey: getListDeploymentsQueryKey(app.id),
      queryFn: () => listDeployments(app.id),
      staleTime: 5 * 60 * 1000,
    })),
  });

  const isLoading = appsLoading || deploymentQueries.some((q) => q.isLoading);
  const isFetching = deploymentQueries.some((q) => q.isFetching);
  const allEmpty = !isLoading && deploymentQueries.every((q) => !q.isLoading && (q.data?.length ?? 0) === 0);

  function handleRefresh() {
    deploymentQueries.forEach((q) => void q.refetch());
  }

  const deployments = useMemo(
    () => deploymentQueries.flatMap((q) => q.data ?? []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [deploymentQueries.map((q) => q.dataUpdatedAt).join(",")],
  );

  const filtered = useMemo(() => {
    if (!filter) return deployments;
    const f = filter.toLowerCase();
    return deployments.filter(
      (d) =>
        d.appName.toLowerCase().includes(f) ||
        d.version.toLowerCase().includes(f) ||
        d.triggeredBy.toLowerCase().includes(f) ||
        d.commitSha.includes(f),
    );
  }, [deployments, filter]);

  const succeeded = filtered.filter((d) => d.status === "Succeeded").length;
  const inProgress = filtered.filter((d) => d.status === "InProgress").length;
  const failed = filtered.filter((d) => d.status === "Failed" || d.status === "RolledBack").length;
  const successRate = filtered.length ? Math.round((succeeded / filtered.length) * 100) : 0;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Deployments"
        subtitle={selectedApp ? `Release activity for ${selectedApp.name}` : "Release activity"}
        right={<ScopeSelect />}
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Tile title="Total" value={isLoading ? null : filtered.length.toString()} sub="Workflow runs" />
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
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs px-2 rounded-sm text-primary"
              onClick={handleRefresh}
              disabled={isFetching}
              aria-label="Refresh deployments"
              title="Refresh deployment history now"
            >
              <RefreshCw className={`h-3.5 w-3.5 mr-1.5${isFetching ? " animate-spin" : ""}`} />
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
          ) : allEmpty ? (
            <div className="p-8 text-center space-y-3">
              <GitBranch className="h-8 w-8 mx-auto text-muted-foreground/40" />
              <div className="text-[14px] font-semibold text-foreground">No deployment history available</div>
              <div className="text-[12px] text-muted-foreground max-w-md mx-auto">
                Set <code className="bg-muted px-1 rounded">GITHUB_TOKEN</code> to pull live GitHub Actions run
                history. Repos: <code className="bg-muted px-1 rounded">Kinisis-Labs/GrailBabe</code>{" "}
                and <code className="bg-muted px-1 rounded">Kinisis-Labs/Orbit-Admin-Ctr</code>.
              </div>
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
                      {d.durationSec != null
                        ? `${Math.floor(d.durationSec / 60)}m ${d.durationSec % 60}s`
                        : "—"}
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
