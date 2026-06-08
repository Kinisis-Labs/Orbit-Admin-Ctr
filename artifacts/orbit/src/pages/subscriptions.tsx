import { useMemo } from "react";
import { useApps } from "@/hooks/use-apps";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/lib/auth";
import { COST_READER_GROUP } from "@/lib/auth-groups";
import { PageHeader, StatusPill } from "@/components/page-header";
import { Wifi } from "lucide-react";

export default function Subscriptions() {
  const { data: apps, isLoading } = useApps();
  const { hasGroup } = useAuth();
  const canSeeCost = hasGroup(COST_READER_GROUP.id);

  const isLive = apps != null && apps.some((a) => a.subscriptionName != null);
  const isLoaded = !isLoading && apps != null;

  const liveBadge = isLoaded ? (
    isLive ? (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm border border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[10px] font-semibold uppercase tracking-wide">
        <Wifi className="h-3 w-3" />
        Live
      </span>
    ) : (
      <span className="inline-flex items-center px-1.5 py-0.5 rounded-sm border border-border bg-muted text-muted-foreground text-[10px] font-semibold uppercase tracking-wide">
        Demo
      </span>
    )
  ) : null;

  const rows = useMemo(() => {
    if (!apps) return [];
    const bySubId = new Map<string, { name: string; displayName: string; apps: string[]; monthToDateCost: number }>();
    for (const app of apps) {
      const subId = app.subscriptionId ?? "unknown";
      const entry = bySubId.get(subId) ?? {
        name: subId,
        displayName: app.subscriptionName ?? subId,
        apps: [],
        monthToDateCost: 0,
      };
      entry.apps.push(app.name);
      entry.monthToDateCost += app.monthToDateCost;
      bySubId.set(subId, entry);
    }
    return Array.from(bySubId.entries())
      .map(([id, { displayName, apps: appNames, monthToDateCost }]) => ({
        id,
        displayName,
        ownerTeam: "Kinisis Platform",
        appCount: appNames.length,
        apps: appNames,
        monthToDateCost: Number(monthToDateCost.toFixed(2)),
        state: "Active",
      }))
      .sort((a, b) => b.monthToDateCost - a.monthToDateCost);
  }, [apps]);

  return (
    <div className="space-y-4">
      <PageHeader title="Subscriptions" subtitle="Azure subscriptions Orbit aggregates data from" right={liveBadge} />

      <div className="bg-card border border-border shadow-sm">
        <div className="p-2 border-b border-border"><h2 className="text-sm font-semibold px-2">{rows.length} subscriptions</h2></div>
        {isLoading ? (
          <div className="p-4 space-y-2"><Skeleton className="h-8" /><Skeleton className="h-8" /></div>
        ) : (
          <Table className="text-[13px]">
            <TableHeader className="bg-muted/50 hover:bg-muted/50 border-b border-border">
              <TableRow className="hover:bg-transparent">
                <TableHead className="h-8 font-semibold text-foreground">Subscription</TableHead>
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
                    <div className="font-medium">{s.displayName}</div>
                    <div className="font-mono text-[11px] text-muted-foreground mt-0.5">{s.id}</div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">{s.apps.join(", ")}</div>
                  </TableCell>
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
