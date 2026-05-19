import { useMemo } from "react";
import { useListApps } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth, COST_READER_GROUP } from "@/lib/auth";
import { PageHeader, StatusPill } from "@/components/page-header";
import { buildSubscriptions } from "@/lib/mock-data";

export default function Subscriptions() {
  const { data: apps, isLoading } = useListApps();
  const { hasGroup } = useAuth();
  const canSeeCost = hasGroup(COST_READER_GROUP.id);

  const rows = useMemo(
    () => (apps ? buildSubscriptions(apps.map((a) => ({ ...a, subscriptionId: a.subscriptionId ?? "", region: a.region, resourceGroup: a.resourceGroup }))) : []),
    [apps],
  );

  return (
    <div className="space-y-4">
      <PageHeader title="Subscriptions" subtitle="Azure subscriptions Orbit Command Center aggregates data from" />

      <div className="bg-card border border-border shadow-sm">
        <div className="p-2 border-b border-border"><h2 className="text-sm font-semibold px-2">{rows.length} subscriptions</h2></div>
        {isLoading ? (
          <div className="p-4 space-y-2"><Skeleton className="h-8" /><Skeleton className="h-8" /></div>
        ) : (
          <Table className="text-[13px]">
            <TableHeader className="bg-muted/50 hover:bg-muted/50 border-b border-border">
              <TableRow className="hover:bg-transparent">
                <TableHead className="h-8 font-semibold text-foreground">Name</TableHead>
                <TableHead className="h-8 font-semibold text-foreground">Subscription ID</TableHead>
                <TableHead className="h-8 font-semibold text-foreground">Owner team</TableHead>
                <TableHead className="h-8 font-semibold text-foreground text-right">Applications</TableHead>
                <TableHead className="h-8 font-semibold text-foreground text-right">MTD cost</TableHead>
                <TableHead className="h-8 font-semibold text-foreground">State</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((s) => (
                <TableRow key={s.id} className="h-8 border-b border-border/50 hover:bg-muted/40 align-top">
                  <TableCell className="py-2">
                    <div className="font-medium text-primary">{s.name}</div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">{s.apps.join(", ")}</div>
                  </TableCell>
                  <TableCell className="py-2 font-mono text-[12px] text-muted-foreground">{s.id}</TableCell>
                  <TableCell className="py-2 text-muted-foreground">{s.ownerTeam}</TableCell>
                  <TableCell className="py-2 text-right tabular-nums">{s.appCount}</TableCell>
                  <TableCell className="py-2 text-right tabular-nums">
                    {canSeeCost ? `$${s.monthToDateCost.toFixed(2)}` : <span className="text-muted-foreground italic">Restricted</span>}
                  </TableCell>
                  <TableCell className="py-2"><StatusPill tone="ok">{s.state}</StatusPill></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
