import { useState } from "react";
import {
  useGetAppAlerts,
  useListApps,
  getGetAppAlertsQueryKey,
} from "@workspace/api-client-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/status-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";
import { Filter, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScopeSelect } from "@/lib/scope";
import { useScope } from "@/lib/scope-context";
import { useAuth } from "@/lib/auth";
import { useForceRefresh } from "@/hooks/use-force-refresh";
import { ForceRefreshButton } from "@/components/force-refresh-button";
import { useCsvExport } from "@/hooks/use-csv-export";
import { useToast } from "@/hooks/use-toast";
import { CsvToolbar } from "@/components/csv-toolbar";
import { InfraAlertHistory } from "@/components/infra-alert-history";
import { AlertConfigTable } from "@/components/alert-config-table";

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
  const { mode } = useAuth();

  const { data: apps } = useListApps();
  const selectedApp = apps?.find((a) => a.id === scope);

  const appQueryKey = getGetAppAlertsQueryKey(scope);

  const { data: appAlerts, isLoading, isFetching } = useGetAppAlerts(scope, undefined, {
    query: { enabled: !!scope, queryKey: appQueryKey },
  });

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
    "alerts",
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

        {isFetching && !isLoading && (
          <div className="h-0.5 w-full overflow-hidden bg-transparent">
            <div className="h-full bg-primary/60 animate-[progress-bar_1.2s_ease-in-out_infinite]" />
          </div>
        )}

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
      <InfraAlertHistory appId={scope} />
      <AlertConfigTable appId={scope} />
    </div>
  );
}
