import { useCallback, useMemo, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { listDeployments, getListDeploymentsQueryKey } from "@workspace/api-client-react";
import { useApps } from "@/hooks/use-apps";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Download, ExternalLink, RefreshCw, Search, GitBranch } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { ScopeSelect } from "@/lib/scope";
import { useScope } from "@/lib/scope-context";
import { PageHeader, StatusPill } from "@/components/page-header";
import { DataSourceBadge } from "@/components/data-source-badge";
import { cn } from "@/lib/utils";
import { useSearch, useLocation } from "wouter";
import type { Deployment } from "@workspace/api-client-react";

type DeploymentStatus = Deployment["status"];
type RunTypeFilter = "all" | "deploy" | "ci";

const SESSION_KEY = "deployments-run-type-filter";

function readStoredFilter(): RunTypeFilter {
  try {
    const v = sessionStorage.getItem(SESSION_KEY);
    if (v === "deploy" || v === "ci") return v;
  } catch {
    // sessionStorage unavailable
  }
  return "all";
}

const STATUS_TONE: Record<DeploymentStatus, "ok" | "warn" | "bad" | "info"> = {
  Succeeded: "ok",
  InProgress: "info",
  Failed: "bad",
  RolledBack: "warn",
};

function RunTypeBadge({ runType, status }: { runType: "deploy" | "ci"; status: DeploymentStatus }) {
  if (runType === "deploy") {
    return (
      <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
        Deploy
      </span>
    );
  }
  const isFailed = status === "Failed" || status === "RolledBack";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium border",
        isFailed
          ? "bg-destructive/10 text-destructive border-destructive/30"
          : "bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/20",
      )}
    >
      CI
    </span>
  );
}

const RUN_TYPE_OPTIONS: { value: RunTypeFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "deploy", label: "Deploy" },
  { value: "ci", label: "CI" },
];

function RunTypeToggle({
  value,
  onChange,
}: {
  value: RunTypeFilter;
  onChange: (v: RunTypeFilter) => void;
}) {
  return (
    <div className="inline-flex items-center rounded-sm border border-border bg-muted/50 p-0.5 gap-0.5">
      {RUN_TYPE_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={cn(
            "h-6 px-2.5 text-[11px] font-medium rounded-[2px] transition-colors",
            value === opt.value
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
          aria-pressed={value === opt.value}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function parseTypeParam(search: string): RunTypeFilter | null {
  const v = new URLSearchParams(search).get("type");
  if (v === "deploy" || v === "ci" || v === "all") return v;
  return null;
}

export default function Deployments() {
  const { scope } = useScope();
  const { data: apps, isLoading: appsLoading } = useApps();
  const [filter, setFilter] = useState("");

  const search = useSearch();
  const [location, navigate] = useLocation();

  const runTypeFilter: RunTypeFilter = parseTypeParam(search) ?? readStoredFilter();

  const setRunTypeFilter = useCallback(
    (v: RunTypeFilter) => {
      try {
        if (v === "all") {
          sessionStorage.removeItem(SESSION_KEY);
        } else {
          sessionStorage.setItem(SESSION_KEY, v);
        }
      } catch {
        // sessionStorage unavailable
      }
      const params = new URLSearchParams(search);
      if (v === "all") {
        params.delete("type");
      } else {
        params.set("type", v);
      }
      const qs = params.toString();
      navigate(`${location}${qs ? `?${qs}` : ""}`, { replace: true });
    },
    [search, location, navigate],
  );

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
  const allEmpty =
    !isLoading && deploymentQueries.every((q) => !q.isLoading && (q.data?.deployments?.length ?? 0) === 0);

  const dataSource = deploymentQueries[0]?.data?.dataSource ?? undefined;
  const fetchedAt = deploymentQueries[0]?.data?.fetchedAt ?? undefined;

  function handleRefresh() {
    deploymentQueries.forEach((q) => void q.refetch());
  }

  const deployments = useMemo(
    () => deploymentQueries.flatMap((q) => q.data?.deployments ?? []),
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
        d.commitSha.includes(f) ||
        d.pipeline.toLowerCase().includes(f),
    );
  }, [deployments, filter]);

  const tableRows = useMemo(() => {
    if (runTypeFilter === "all") return filtered;
    return filtered.filter((d) => d.runType === runTypeFilter);
  }, [filtered, runTypeFilter]);

  const deployRuns = filtered.filter((d) => d.runType === "deploy");
  const ciRuns = filtered.filter((d) => d.runType === "ci");

  const succeeded = deployRuns.filter((d) => d.status === "Succeeded").length;
  const inProgress = deployRuns.filter((d) => d.status === "InProgress").length;
  const failed = deployRuns.filter((d) => d.status === "Failed" || d.status === "RolledBack").length;
  const successRate = deployRuns.length ? Math.round((succeeded / deployRuns.length) * 100) : 0;
  const ciFailures = ciRuns.filter((d) => d.status === "Failed" || d.status === "RolledBack").length;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Deployments"
        subtitle={selectedApp ? `Release activity for ${selectedApp.name}` : "Release activity"}
        right={
          <div className="flex items-center gap-2">
            {!isLoading && dataSource && (
              <DataSourceBadge dataSource={dataSource} dataAsOf={fetchedAt} label="GitHub Actions" />
            )}
            <ScopeSelect />
          </div>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <Tile title="Total deploys" value={isLoading ? null : deployRuns.length.toString()} sub="Deploy workflows" />
        <Tile title="Success rate" value={isLoading ? null : `${successRate}%`} sub={`${succeeded} succeeded`} />
        <Tile title="In progress" value={isLoading ? null : inProgress.toString()} sub="Active rollouts" />
        <Tile title="Deploy failures" value={isLoading ? null : failed.toString()} sub="Requires review" />
        <Tile
          title="CI failures"
          value={isLoading ? null : ciFailures.toString()}
          sub={`of ${ciRuns.length} CI runs`}
          highlight={ciFailures > 0}
          onClick={() => setRunTypeFilter(runTypeFilter === "ci" ? "all" : "ci")}
          active={runTypeFilter === "ci"}
        />
      </div>

      <div className="bg-card border border-border shadow-sm flex flex-col">
        <div className="flex items-center justify-between p-2 border-b border-border bg-card gap-2 flex-wrap">
          <div className="flex items-center gap-2 px-2">
            <h2 className="text-sm font-semibold">Workflow run history</h2>
            <RunTypeToggle value={runTypeFilter} onChange={setRunTypeFilter} />
            {runTypeFilter !== "all" && (
              <span className="text-[11px] text-muted-foreground">
                {tableRows.length} {tableRows.length === 1 ? "run" : "runs"}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <div className="relative">
              <Search className="h-3.5 w-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter app, pipeline, version, commit, deployer"
                className="h-7 w-80 pl-7 text-[12px] rounded-sm"
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
              <Skeleton className="h-8" />
              <Skeleton className="h-8" />
              <Skeleton className="h-8" />
            </div>
          ) : allEmpty ? (
            <div className="p-8 text-center space-y-3">
              <GitBranch className="h-8 w-8 mx-auto text-muted-foreground/40" />
              <div className="text-[14px] font-semibold text-foreground">No workflow history available</div>
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
                  <TableHead className="h-8 font-semibold text-foreground">Type</TableHead>
                  <TableHead className="h-8 font-semibold text-foreground">Pipeline</TableHead>
                  <TableHead className="h-8 font-semibold text-foreground">Version</TableHead>
                  <TableHead className="h-8 font-semibold text-foreground">Status</TableHead>
                  <TableHead className="h-8 font-semibold text-foreground">Triggered by</TableHead>
                  <TableHead className="h-8 font-semibold text-foreground">Commit</TableHead>
                  <TableHead className="h-8 font-semibold text-foreground">Started</TableHead>
                  <TableHead className="h-8 font-semibold text-foreground text-right">Duration</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tableRows.map((d) => {
                  const isFailedCi = d.runType === "ci" && (d.status === "Failed" || d.status === "RolledBack");
                  return (
                    <TableRow
                      key={d.id}
                      className={cn(
                        "h-8 border-b border-border/50 hover:bg-muted/40",
                        isFailedCi && "bg-destructive/5 hover:bg-destructive/10",
                      )}
                    >
                      <TableCell className="py-1 font-medium text-primary">{d.appName}</TableCell>
                      <TableCell className="py-1">
                        <RunTypeBadge runType={d.runType as "deploy" | "ci"} status={d.status} />
                      </TableCell>
                      <TableCell
                        className="py-1 text-muted-foreground text-[12px] max-w-[180px] truncate"
                        title={d.pipeline}
                      >
                        {d.pipeline}
                      </TableCell>
                      <TableCell className="py-1 font-mono text-[12px]">
                        {d.runUrl ? (
                          <a
                            href={d.runUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 hover:text-primary transition-colors"
                            title="Open in GitHub Actions"
                          >
                            {d.version}
                            <ExternalLink className="h-3 w-3 text-muted-foreground shrink-0" />
                          </a>
                        ) : (
                          d.version
                        )}
                      </TableCell>
                      <TableCell className="py-1">
                        <StatusPill tone={STATUS_TONE[d.status]}>{d.status}</StatusPill>
                      </TableCell>
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
                  );
                })}
                {tableRows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-6 text-muted-foreground">
                      No runs match.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </div>
      </div>
    </div>
  );
}

function Tile({
  title,
  value,
  sub,
  highlight,
  onClick,
  active,
}: {
  title: string;
  value: string | null;
  sub: string;
  highlight?: boolean;
  onClick?: () => void;
  active?: boolean;
}) {
  return (
    <div
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={onClick ? (e) => (e.key === "Enter" || e.key === " ") && onClick() : undefined}
      className={cn(
        "bg-card border border-border p-3 shadow-sm flex flex-col justify-between",
        highlight && "border-destructive/50 bg-destructive/5",
        onClick && "cursor-pointer select-none transition-colors",
        onClick && !active && "hover:bg-muted/40",
        active && "ring-2 ring-primary/40",
      )}
    >
      <div
        className={cn(
          "text-[12px] font-medium mb-1 truncate",
          highlight ? "text-destructive" : "text-muted-foreground",
        )}
      >
        {title}
      </div>
      {value === null ? (
        <Skeleton className="h-7 w-20 mb-1" />
      ) : (
        <div className={cn("text-xl font-semibold tabular-nums mb-1", highlight && "text-destructive")}>{value}</div>
      )}
      <div className="text-[11px] text-muted-foreground truncate">{sub}</div>
    </div>
  );
}
