import { useCallback, useMemo, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { listActivityLog, getListActivityLogQueryKey } from "@workspace/api-client-react";
import { useApps } from "@/hooks/use-apps";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Search, Download, RefreshCw, ScrollText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { PageHeader, StatusPill } from "@/components/page-header";
import { useSearch, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import type { ActivityEntry, AppSummary } from "@workspace/api-client-react";

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

const STATUS_TONE: Record<ActivityEntry["status"], "ok" | "warn" | "bad"> = {
  Succeeded: "ok",
  Started: "warn",
  Failed: "bad",
};

function categoryTone(category: string): "info" | "warn" | "ok" | "muted" | "bad" {
  const c = category.toLowerCase();
  if (c.includes("auth") || c.includes("policy") || c.includes("secur")) return "warn";
  if (c.includes("delete") || c.includes("failed")) return "bad";
  if (c.includes("cost") || c.includes("billing")) return "muted";
  return "info";
}

export default function ActivityLog() {
  const { data: apps, isLoading: appsLoading } = useApps();
  const [filter, setFilter] = useState("");

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

  const appsToQuery = useMemo(() => {
    if (!apps) return [];
    if (appTagScope === "all") return apps;
    return apps.filter((a) => getApplicationTag(a)?.toLowerCase() === appTagScope);
  }, [apps, appTagScope]);

  const activityQueries = useQueries({
    queries: appsToQuery.map((app) => ({
      queryKey: getListActivityLogQueryKey(app.id),
      queryFn: () => listActivityLog(app.id),
      staleTime: 5 * 60 * 1000,
    })),
  });

  const isLoading = appsLoading || activityQueries.some((q) => q.isLoading);
  const isFetching = activityQueries.some((q) => q.isFetching);
  const allEmpty =
    !isLoading &&
    appsToQuery.length > 0 &&
    activityQueries.every((q) => !q.isLoading && (q.data?.length ?? 0) === 0);

  const isGlobal = appTagScope === "all";

  function handleRefresh() {
    activityQueries.forEach((q) => void q.refetch());
  }

  const entries = useMemo(
    () =>
      activityQueries
        .flatMap((q) => q.data ?? [])
        .sort((a, b) => b.timestamp.localeCompare(a.timestamp)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activityQueries.map((q) => q.dataUpdatedAt).join(",")],
  );

  const rows = useMemo(() => {
    if (!filter) return entries;
    const f = filter.toLowerCase();
    return entries.filter(
      (e) =>
        e.actor.toLowerCase().includes(f) ||
        e.action.toLowerCase().includes(f) ||
        e.target.toLowerCase().includes(f) ||
        e.category.toLowerCase().includes(f),
    );
  }, [entries, filter]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Activity log"
        subtitle={appTagScope === "all" ? "Audit trail of operator and automation actions" : `Audit trail for ${appTagScope.charAt(0).toUpperCase() + appTagScope.slice(1)}`}
        right={<AppTagToggle value={appTagScope} onChange={setAppTagScope} />}
      />

      <div className="bg-card border border-border shadow-sm">
        <div className="flex items-center justify-between p-2 border-b border-border gap-2 flex-wrap">
          <h2 className="text-sm font-semibold px-2">{isLoading ? "…" : `${rows.length} events`}</h2>
          <div className="flex items-center gap-1">
            <div className="relative">
              <Search className="h-3.5 w-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter actor, action, target, category" className="h-7 w-80 pl-7 text-[12px] rounded-sm" />
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs px-2 rounded-sm text-primary"
              onClick={handleRefresh}
              disabled={isFetching}
              aria-label="Refresh activity log"
              title="Refresh activity log now"
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
            <div className="p-4 space-y-2"><Skeleton className="h-8" /><Skeleton className="h-8" /><Skeleton className="h-8" /></div>
          ) : allEmpty ? (
            <div className="p-8 text-center space-y-3">
              <ScrollText className="h-8 w-8 mx-auto text-muted-foreground/40" />
              <div className="text-[14px] font-semibold text-foreground">No activity in the last 30 days</div>
              <div className="text-[12px] text-muted-foreground max-w-md mx-auto">
                No Azure Activity Log entries found for {isGlobal ? "any tracked application" : "this application"} in the past 30 days.
              </div>
            </div>
          ) : (
            <Table className="text-[13px]">
              <TableHeader className="bg-muted/50 hover:bg-muted/50 border-b border-border">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="h-8 font-semibold text-foreground w-[180px]">Timestamp</TableHead>
                  <TableHead className="h-8 font-semibold text-foreground">Action</TableHead>
                  <TableHead className="h-8 font-semibold text-foreground">Category</TableHead>
                  <TableHead className="h-8 font-semibold text-foreground">Actor</TableHead>
                  <TableHead className="h-8 font-semibold text-foreground">Target</TableHead>
                  <TableHead className="h-8 font-semibold text-foreground">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((e) => (
                  <TableRow key={e.id} className="h-8 border-b border-border/50 hover:bg-muted/40">
                    <TableCell className="py-1 font-mono text-[12px] text-muted-foreground">{format(new Date(e.timestamp), "yyyy-MM-dd HH:mm:ss")}</TableCell>
                    <TableCell className="py-1 font-medium">{e.action}</TableCell>
                    <TableCell className="py-1"><StatusPill tone={categoryTone(e.category)}>{e.category}</StatusPill></TableCell>
                    <TableCell className="py-1 text-muted-foreground">{e.actor}</TableCell>
                    <TableCell className="py-1 font-mono text-[12px] text-muted-foreground">{e.target}</TableCell>
                    <TableCell className="py-1"><StatusPill tone={STATUS_TONE[e.status]}>{e.status}</StatusPill></TableCell>
                  </TableRow>
                ))}
                {rows.length === 0 && (
                  <TableRow><TableCell colSpan={6} className="text-center py-6 text-muted-foreground">No activity matches.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </div>
      </div>
    </div>
  );
}
