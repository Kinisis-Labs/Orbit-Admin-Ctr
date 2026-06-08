import { useListGlobalEndpoints } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader, StatusPill } from "@/components/page-header";
import { DataSourceBadge } from "@/components/data-source-badge";
import { Network } from "lucide-react";
import type { GlobalEndpointRow } from "@workspace/api-client-react";

type EndpointStatus = GlobalEndpointRow["status"];

const TONE: Record<EndpointStatus, "ok" | "warn" | "bad" | "muted"> = {
  healthy: "ok",
  degraded: "warn",
  unhealthy: "bad",
  unknown: "muted",
};

export default function NetworkPage() {
  const { data, isLoading } = useListGlobalEndpoints();
  const eps = data?.endpoints ?? [];
  const isEmpty = !isLoading && eps.length === 0;

  const unhealthy = eps.filter((e) => e.status === "unhealthy").length;
  const degraded = eps.filter((e) => e.status === "degraded").length;
  const avgLatency = eps.length
    ? Math.round(eps.reduce((s, e) => s + e.latencyMs, 0) / eps.length)
    : 0;

  const dataSource = data?.dataSource;
  const dataAsOf = data?.dataAsOf;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Network"
        subtitle="Cross-application endpoint health, latency, and packet loss"
        right={dataSource ? <DataSourceBadge dataSource={dataSource} dataAsOf={dataAsOf} label="Azure Resource Graph" /> : undefined}
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Tile title="Endpoints monitored" value={isLoading ? null : eps.length.toString()} sub="Across all applications" />
        <Tile title="Avg latency" value={isLoading ? null : `${avgLatency}ms`} sub="P50 across endpoints" />
        <Tile title="Degraded" value={isLoading ? null : degraded.toString()} sub="Elevated latency or loss" />
        <Tile title="Unhealthy" value={isLoading ? null : unhealthy.toString()} sub="Failing probes" />
      </div>

      <div className="bg-card border border-border shadow-sm">
        <div className="p-2 border-b border-border"><h2 className="text-sm font-semibold px-2">Endpoints</h2></div>
        {isLoading ? (
          <div className="p-4 space-y-2"><Skeleton className="h-8" /><Skeleton className="h-8" /></div>
        ) : isEmpty ? (
          <div className="p-8 text-center space-y-3">
            <Network className="h-8 w-8 mx-auto text-muted-foreground/40" />
            <div className="text-[14px] font-semibold text-foreground">No network resources found</div>
            <div className="text-[12px] text-muted-foreground max-w-md mx-auto">
              Azure Resource Graph returned no networking resources (Front Door, Application Gateway, VNets,
              Network Watchers) in the tracked subscriptions. Check{" "}
              <code className="bg-muted px-1 rounded">/api/diagnostics</code> for details.
            </div>
          </div>
        ) : (
          <Table className="text-[13px]">
            <TableHeader className="bg-muted/50 hover:bg-muted/50 border-b border-border">
              <TableRow className="hover:bg-transparent">
                <TableHead className="h-8 font-semibold text-foreground">Application</TableHead>
                <TableHead className="h-8 font-semibold text-foreground">Endpoint</TableHead>
                <TableHead className="h-8 font-semibold text-foreground">Region</TableHead>
                <TableHead className="h-8 font-semibold text-foreground">Status</TableHead>
                <TableHead className="h-8 font-semibold text-foreground text-right">Latency</TableHead>
                <TableHead className="h-8 font-semibold text-foreground text-right">Packet loss</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {eps.map((e) => (
                <TableRow key={e.id} className="h-8 border-b border-border/50 hover:bg-muted/40">
                  <TableCell className="py-1 font-medium text-primary">{e.appName}</TableCell>
                  <TableCell className="py-1 font-medium">{e.name}</TableCell>
                  <TableCell className="py-1 text-muted-foreground">{e.region}</TableCell>
                  <TableCell className="py-1"><StatusPill tone={TONE[e.status]}>{e.status}</StatusPill></TableCell>
                  <TableCell className="py-1 text-right tabular-nums">{e.latencyMs}ms</TableCell>
                  <TableCell className={`py-1 text-right tabular-nums ${e.packetLossPercent > 0.2 ? "text-destructive" : ""}`}>{e.packetLossPercent}%</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}

function Tile({ title, value, sub }: { title: string; value: string | null; sub: string }) {
  return (
    <div className="bg-card border border-border shadow-sm p-3 space-y-0.5">
      <div className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide">{title}</div>
      {value === null ? <Skeleton className="h-7 w-16" /> : <div className="text-2xl font-bold tabular-nums">{value}</div>}
      <div className="text-[11px] text-muted-foreground">{sub}</div>
    </div>
  );
}
