import { useState } from "react";
import { useListGlobalAlerts } from "@workspace/api-client-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/status-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { Link } from "wouter";
import { Input } from "@/components/ui/input";

export default function Alerts() {
  const { data: alerts, isLoading } = useListGlobalAlerts();
  const [filter, setFilter] = useState("");

  const filteredAlerts = alerts?.filter(a => 
    a.title.toLowerCase().includes(filter.toLowerCase()) || 
    a.appName.toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <h1 className="text-2xl font-bold tracking-tight">Global Alerts</h1>
        <div className="w-full sm:w-72">
          <Input 
            placeholder="Filter alerts..." 
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
      </div>

      <div className="border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Time</TableHead>
              <TableHead>Severity</TableHead>
              <TableHead>App</TableHead>
              <TableHead>Title</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-48" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                </TableRow>
              ))
            ) : filteredAlerts?.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                  No active alerts found.
                </TableCell>
              </TableRow>
            ) : (
              filteredAlerts?.map((alert) => (
                <TableRow key={alert.id}>
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                    {format(new Date(alert.firedAt), "MMM d, HH:mm:ss")}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={alert.severity} />
                  </TableCell>
                  <TableCell className="font-medium">
                    <Link href={`/apps/${alert.appId}`} className="hover:underline text-primary">
                      {alert.appName}
                    </Link>
                  </TableCell>
                  <TableCell>{alert.title}</TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="text-[10px]">{alert.source}</Badge>
                  </TableCell>
                  <TableCell>
                    <span className="text-xs capitalize">{alert.status}</span>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
