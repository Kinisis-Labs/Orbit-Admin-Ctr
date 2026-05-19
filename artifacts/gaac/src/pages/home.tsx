import { useGetGlobalHealth, useListApps, useListGlobalAlerts, useGetGlobalCostSummary } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Activity, AlertTriangle, Box, DollarSign } from "lucide-react";
import { Link } from "wouter";

export default function Home() {
  const { data: health, isLoading: healthLoading } = useGetGlobalHealth();
  const { data: apps, isLoading: appsLoading } = useListApps();
  const { data: alerts, isLoading: alertsLoading } = useListGlobalAlerts();
  const { data: cost, isLoading: costLoading } = useGetGlobalCostSummary();

  const formatCurrency = (amount: number, currency: string) => {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
  };

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">Global Overview</h1>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Applications</CardTitle>
            <Box className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {healthLoading ? <Skeleton className="h-8 w-16" /> : (
              <div className="text-2xl font-bold">{health?.totalApps || 0}</div>
            )}
            <p className="text-xs text-muted-foreground mt-1">
              Active resources
            </p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Global Health</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {healthLoading ? <Skeleton className="h-8 w-24" /> : (
              <div className="flex gap-2">
                <div className="text-2xl font-bold text-emerald-500">{health?.healthy || 0}</div>
                <div className="text-2xl font-bold text-amber-500">{health?.degraded || 0}</div>
                <div className="text-2xl font-bold text-red-500">{health?.unhealthy || 0}</div>
              </div>
            )}
            <p className="text-xs text-muted-foreground mt-1">
              Healthy / Degraded / Unhealthy
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Alerts</CardTitle>
            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {alertsLoading ? <Skeleton className="h-8 w-16" /> : (
              <div className="text-2xl font-bold">{alerts?.length || 0}</div>
            )}
            <p className="text-xs text-muted-foreground mt-1">
              Requiring attention
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">MTD Azure Spend</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {costLoading ? <Skeleton className="h-8 w-24" /> : (
              <div className="text-2xl font-bold">{cost ? formatCurrency(cost.monthToDate, cost.currency) : "$0.00"}</div>
            )}
            <p className="text-xs text-muted-foreground mt-1">
              Month to date
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Applications</CardTitle>
          <CardDescription>Monitored applications and their current status</CardDescription>
        </CardHeader>
        <CardContent>
          {appsLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Environment</TableHead>
                  <TableHead>Region</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Active Alerts</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {apps?.map((app) => (
                  <TableRow key={app.id}>
                    <TableCell className="font-medium">
                      <Link href={`/apps/${app.id}`} className="hover:underline text-primary">
                        {app.name}
                      </Link>
                    </TableCell>
                    <TableCell>{app.environment}</TableCell>
                    <TableCell>{app.region}</TableCell>
                    <TableCell>
                      <StatusBadge status={app.status} />
                    </TableCell>
                    <TableCell className="text-right">{app.activeAlerts || 0}</TableCell>
                  </TableRow>
                ))}
                {apps?.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground">
                      No applications found.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
