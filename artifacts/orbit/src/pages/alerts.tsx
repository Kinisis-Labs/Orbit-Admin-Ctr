import { useState, useEffect } from "react";
import { Link } from "wouter";
import { useAppAlerts } from "@/hooks/use-app-alerts";
import { useApps } from "@/hooks/use-apps";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/status-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";
import { AlertTriangle, ChevronDown, ChevronRight, Filter, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RefreshingBar } from "@/components/refreshing-bar";
import { ScopeSelect } from "@/lib/scope";
import { useScope } from "@/lib/scope-context";
import { useAuth } from "@/lib/auth";
import { useForceRefresh } from "@/hooks/use-force-refresh";
import { ForceRefreshButton } from "@/components/force-refresh-button";
import { useCsvExport } from "@/hooks/use-csv-export";
import { useToast } from "@/hooks/use-toast";
import { CsvToolbar } from "@/components/csv-toolbar";
import { InfraAlertHistory } from "@/components/infra-alert-history";
import { AlertConfigTable, ALERTS_INFRA_POLL_KEY } from "@/components/alert-config-table";
import { ViolationLogPanel } from "@/components/violation-log-panel";
import { markAllViolationsSeen } from "@/hooks/use-violation-log";
import { useActiveInfraViolations } from "@/hooks/use-active-infra-violations";
import { usePollingInterval } from "@/hooks/use-polling-interval";

type AlertRow = {
  id: string;
  title: string;
  appId: string;
  appName: string;
  severity: string;
  status: string;
  source: string;
  firedAt: string;
};

export default function Alerts() {
  const { toast } = useToast();
  const { scope } = useScope();
  const [filter, setFilter] = useState("");

  useEffect(() => {
    markAllViolationsSeen();
  }, []);
  const [thresholdsOpen, setThresholdsOpen] = useState(() => {
    try {
      return localStorage.getItem("orbit:thresholdsOpen") === "true";
    } catch {
      return false;
    }
  });

  const toggleThresholds = (open: boolean) => {
    try {
      localStorage.setItem("orbit:thresholdsOpen", String(open));
    } catch {
      // ignore
    }
    setThresholdsOpen(open);
  };
  const { mode } = useAuth();
  const [infraPollInterval] = usePollingInterval(ALERTS_INFRA_POLL_KEY);
  const activeViolations = useActiveInfraViolations(infraPollInterval);

  const { data: apps } = useApps();
  const selectedApp = apps?.find((a) => a.id === scope);

  const { data: appAlerts, isLoading, isFetching, queryKey: appQueryKey } = useAppAlerts(scope);

  const { isRefreshing, isCoolingDown, forceRefresh } = useForceRefresh(`/api/apps/${scope}/alerts`, appQueryKey);

  const rows: AlertRow[] | undefined = appAlerts?.map((a) => ({
    ...a,
    appId: scope,
    appName: selectedApp?.name ?? scope,
  }));

  const filteredAlerts = rows?.filter(
    (a) =>
      a.title.toLowerCase().includes(filter.toLowerCase()) ||
      a.appName.toLowerCase().includes(filter.toLowerCase()),
  );

  const csvHeaders = ["Fired At", "Severity", "Alert Rule / Title", "Signal Type", "State"];
  const csvRows = filteredAlerts?.map((a) => [
    format(new Date(a.firedAt), "MM/dd/yyyy HH:mm"),
    a.severity,
    a.title,
    a.source,
    a.status,
  ]);
  const { copied, disabled: csvDisabled, handleExport, handleCopy } = useCsvExport(
    csvRows ?? null,
    csvHeaders,
    `alerts-${selectedApp?.name ?? scope}`,
    () => toast({ title: "No alerts to export", description: "There are no alert rows in the current view." }),
  );

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-foreground tracking-tight">
            {`Alerts — ${selectedApp?.name ?? ""}`}
          </h1>
          <p className="text-[12px] text-muted-foreground mt-0.5">
            {`Scoped to ${selectedApp?.name ?? "application"}`}
          </p>
        </div>
        <ScopeSelect />
      </div>

      {activeViolations.length > 0 && (
        <div className="border border-destructive/40 bg-destructive/8 rounded-sm shadow-sm overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-destructive/30 bg-destructive/12">
            <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0" />
            <h2 className="text-sm font-semibold text-destructive">
              Active infra violations
            </h2>
            <span className="ml-1 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-destructive text-white text-[10px] font-bold leading-none">
              {activeViolations.length}
            </span>
          </div>
          <div className="overflow-x-auto">
            <Table className="text-[13px]">
              <TableHeader className="bg-destructive/6 border-b border-destructive/20">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="h-8 font-semibold text-foreground w-[180px]">App</TableHead>
                  <TableHead className="h-8 font-semibold text-foreground w-[90px]">Metric</TableHead>
                  <TableHead className="h-8 font-semibold text-foreground">Current vs threshold</TableHead>
                  <TableHead className="h-8 font-semibold text-foreground w-[120px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {activeViolations.map((v) => {
                  const over = v.value - v.threshold;
                  const pct = v.threshold > 0 ? (over / v.threshold) * 100 : 0;
                  const pillColor = pct > 25
                    ? "border-destructive/40 bg-destructive/10 text-destructive"
                    : "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400";
                  const metricLabel = v.metric === "cpu" ? "CPU" : "Memory";
                  const metricColor = v.metric === "cpu"
                    ? "border-blue-500/40 bg-blue-500/10 text-blue-600 dark:text-blue-400"
                    : "border-purple-500/40 bg-purple-500/10 text-purple-600 dark:text-purple-400";
                  return (
                    <TableRow
                      key={`${v.appId}:${v.metric}`}
                      className="h-9 border-b border-destructive/15 last:border-0 hover:bg-destructive/5"
                    >
                      <TableCell className="py-1 font-medium">{v.appName}</TableCell>
                      <TableCell className="py-1">
                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded-sm border text-[10px] font-semibold ${metricColor}`}>
                          {metricLabel}
                        </span>
                      </TableCell>
                      <TableCell className="py-1">
                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded-sm border text-[10px] font-semibold ${pillColor}`}>
                          {v.value.toFixed(1)}%&nbsp;
                          <span className="opacity-70">(+{over.toFixed(1)}% over {v.threshold.toFixed(0)}%)</span>
                        </span>
                      </TableCell>
                      <TableCell className="py-1 text-right">
                        <Link
                          href={`/apps/${v.appId}?tab=infrastructure`}
                          className="text-[11px] text-primary hover:underline whitespace-nowrap"
                        >
                          View infrastructure →
                        </Link>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      <div className="bg-card border border-border shadow-sm flex flex-col">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between p-2 border-b border-border bg-card gap-2">
          <div className="flex items-center gap-1">
            {mode === "entra" && (
              <ForceRefreshButton
                isRefreshing={isRefreshing}
                isCoolingDown={isCoolingDown}
                onRefresh={() => void forceRefresh()}
              />
            )}
            <Button variant="ghost" size="sm" className="h-7 text-xs px-2 rounded-sm text-primary hover:text-primary hover:bg-primary/10">
              <Filter className="h-3.5 w-3.5 mr-1.5" />
              Manage filters
            </Button>
            <span className="text-[11px] text-muted-foreground pl-2 tabular-nums">
              {rows ? `${filteredAlerts?.length ?? 0} of ${rows.length}` : ""}
            </span>
          </div>

          <div className="flex items-center gap-1 flex-wrap justify-end">
            <div className="relative w-full sm:w-64">
              <Search className="h-3.5 w-3.5 absolute left-2 top-1.5 text-muted-foreground" />
              <Input
                placeholder="Search by name..."
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="h-7 pl-7 text-xs rounded-sm focus-visible:ring-1 focus-visible:ring-primary border-muted-foreground/30"
              />
            </div>
            <CsvToolbar
              handleExport={handleExport}
              handleCopy={handleCopy}
              disabled={csvDisabled}
              copied={copied}
            />
          </div>
        </div>

        <RefreshingBar isFetching={isFetching} isLoading={isLoading} />

        <div className={`overflow-x-auto transition-opacity duration-200 ${isFetching && !isLoading ? "opacity-60" : "opacity-100"}`}>
          <Table className="text-[13px]">
            <TableHeader className="bg-muted/50 hover:bg-muted/50 border-b border-border">
              <TableRow className="hover:bg-transparent">
                <TableHead className="h-8 font-semibold text-foreground w-[120px]">Fired At</TableHead>
                <TableHead className="h-8 font-semibold text-foreground w-[100px]">Severity</TableHead>
                <TableHead className="h-8 font-semibold text-foreground w-1/3">Alert Rule / Title</TableHead>
                <TableHead className="h-8 font-semibold text-foreground">Signal Type</TableHead>
                <TableHead className="h-8 font-semibold text-foreground">State</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i} className="h-8 border-b border-border/50">
                    <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-48" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                  </TableRow>
                ))
              ) : filteredAlerts?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                    No matching alerts found.
                  </TableCell>
                </TableRow>
              ) : (
                filteredAlerts?.map((alert) => (
                  <TableRow key={alert.id} className="h-8 border-b border-border/50 hover:bg-muted/40">
                    <TableCell className="py-1 text-xs text-muted-foreground whitespace-nowrap">
                      {format(new Date(alert.firedAt), "MM/dd/yyyy HH:mm")}
                    </TableCell>
                    <TableCell className="py-1">
                      <StatusBadge status={alert.severity} />
                    </TableCell>
                    <TableCell className="py-1">{alert.title}</TableCell>
                    <TableCell className="py-1 text-muted-foreground">{alert.source}</TableCell>
                    <TableCell className="py-1">
                      <span className="text-xs capitalize">{alert.status}</span>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>
      <ViolationLogPanel />
      <InfraAlertHistory appId={scope} />
      <div className="bg-card border border-border shadow-sm flex flex-col">
        <button
          type="button"
          onClick={() => toggleThresholds(!thresholdsOpen)}
          className="flex items-center gap-2 p-3 text-left hover:bg-muted/40 transition-colors"
        >
          {thresholdsOpen ? (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          )}
          <span className="text-sm font-semibold">Infra alert thresholds — all apps</span>
          <span className="ml-1 text-[11px] text-muted-foreground font-normal">
            {thresholdsOpen ? "click to collapse" : "click to expand"}
          </span>
        </button>
        {thresholdsOpen && <AlertConfigTable />}
      </div>
    </div>
  );
}
