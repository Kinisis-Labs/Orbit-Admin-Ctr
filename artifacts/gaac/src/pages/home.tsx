import { useGetGlobalHealth, useListApps, useListGlobalAlerts, useGetGlobalCostSummary } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RefreshCw, Filter, Download } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";

export default function Home() {
  const { data: health, isLoading: healthLoading } = useGetGlobalHealth();
  const { data: apps, isLoading: appsLoading } = useListApps();
  const { data: alerts, isLoading: alertsLoading } = useListGlobalAlerts();
  const { data: cost, isLoading: costLoading } = useGetGlobalCostSummary();

  const formatCurrency = (amount: number, currency: string) => {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
  };

  return (
    <div className="space-y-4">
      {/* Title */}
      <h1 className="text-xl font-semibold text-foreground tracking-tight">Dashboard</h1>
      
      {/* Dense KPI Tiles Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Tile 
          title="Total Applications" 
          value={healthLoading ? null : (health?.totalApps || 0)} 
          sub="Active resources" 
        />
        <Tile 
          title="Global Health" 
          value={healthLoading ? null : (health?.healthy || 0)} 
          sub={`${health?.degraded || 0} degraded, ${health?.unhealthy || 0} unhealthy`} 
        />
        <Tile 
          title="Active Alerts" 
          value={alertsLoading ? null : (alerts?.length || 0)} 
          sub="Requiring attention" 
        />
        <Tile 
          title="MTD Azure Spend" 
          value={costLoading ? null : (cost ? formatCurrency(cost.monthToDate, cost.currency) : "$0.00")} 
          sub="Month to date" 
        />
      </div>

      {/* Blade / Panel Style for Table */}
      <div className="bg-card border border-border shadow-sm flex flex-col">
        {/* Blade Header / Toolbar */}
        <div className="flex items-center justify-between p-2 border-b border-border bg-card">
          <h2 className="text-sm font-semibold px-2">App Services</h2>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" className="h-7 text-xs px-2 rounded-sm text-primary hover:text-primary hover:bg-primary/10">
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
              Refresh
            </Button>
            <Button variant="ghost" size="sm" className="h-7 text-xs px-2 rounded-sm text-primary hover:text-primary hover:bg-primary/10">
              <Filter className="h-3.5 w-3.5 mr-1.5" />
              Add filter
            </Button>
            <Button variant="ghost" size="sm" className="h-7 text-xs px-2 rounded-sm text-primary hover:text-primary hover:bg-primary/10">
              <Download className="h-3.5 w-3.5 mr-1.5" />
              Export
            </Button>
          </div>
        </div>

        {/* Table Content */}
        <div className="overflow-x-auto">
          {appsLoading ? (
            <div className="p-4 space-y-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : (
            <Table className="text-[13px]">
              <TableHeader className="bg-muted/50 hover:bg-muted/50 border-b border-border">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="h-8 font-semibold text-foreground w-[250px]">Name</TableHead>
                  <TableHead className="h-8 font-semibold text-foreground">Status</TableHead>
                  <TableHead className="h-8 font-semibold text-foreground">Environment</TableHead>
                  <TableHead className="h-8 font-semibold text-foreground">Location</TableHead>
                  <TableHead className="h-8 font-semibold text-foreground text-right">Alerts</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {apps?.map((app) => (
                  <TableRow key={app.id} className="h-8 border-b border-border/50 hover:bg-muted/40 cursor-pointer">
                    <TableCell className="py-1">
                      <Link href={`/apps/${app.id}`} className="text-primary hover:underline font-medium">
                        {app.name}
                      </Link>
                    </TableCell>
                    <TableCell className="py-1">
                      <StatusBadge status={app.status} />
                    </TableCell>
                    <TableCell className="py-1 text-muted-foreground">{app.environment}</TableCell>
                    <TableCell className="py-1 text-muted-foreground">{app.region}</TableCell>
                    <TableCell className="py-1 text-right tabular-nums">{app.activeAlerts || 0}</TableCell>
                  </TableRow>
                ))}
                {apps?.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-6 text-muted-foreground">
                      No applications found.
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

function Tile({ title, value, sub }: { title: string; value: React.ReactNode; sub: string }) {
  return (
    <div className="bg-card border border-border p-3 shadow-sm flex flex-col justify-between">
      <div className="text-[12px] text-muted-foreground font-medium mb-1 truncate">{title}</div>
      {value === null ? (
        <Skeleton className="h-7 w-20 mb-1" />
      ) : (
        <div className="text-xl font-semibold text-foreground mb-1 tabular-nums">{value}</div>
      )}
      <div className="text-[11px] text-muted-foreground truncate">{sub}</div>
    </div>
  );
}
