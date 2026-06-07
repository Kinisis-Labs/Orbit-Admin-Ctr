import { useListServiceHealth } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { format, formatDistanceToNow } from "date-fns";
import { CheckCircle2, AlertTriangle, Activity } from "lucide-react";
import { PageHeader, StatusPill } from "@/components/page-header";
import type { ServiceHealthEvent } from "@workspace/api-client-react";

const TONE: Record<ServiceHealthEvent["status"], "ok" | "warn" | "bad" | "info"> = {
  Resolved: "ok",
  Advisory: "info",
  Active: "bad",
};
const SEV_TONE: Record<ServiceHealthEvent["severity"], "ok" | "warn" | "bad"> = {
  Low: "ok",
  Medium: "warn",
  High: "bad",
};

export default function ServiceHealth() {
  const { data, isLoading } = useListServiceHealth();
  const events = data?.events ?? [];
  const active = events.filter((e) => e.status === "Active");
  const isEmpty = !isLoading && events.length === 0;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Azure service health"
        subtitle="Active incidents, advisories, and planned maintenance affecting Azure services Orbit depends on"
      />

      {isLoading ? (
        <div className="border shadow-sm bg-card p-4 space-y-2">
          <Skeleton className="h-5 w-64" />
          <Skeleton className="h-4 w-96" />
        </div>
      ) : isEmpty ? (
        <div className={`border shadow-sm p-4 flex items-start gap-3 bg-emerald-500/5 border-emerald-500/30`}>
          <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0 mt-0.5" />
          <div>
            <div className="text-[14px] font-semibold text-foreground">All Azure services nominal</div>
            <div className="text-[12px] text-muted-foreground mt-0.5">No active incidents affecting Orbit's dependencies.</div>
          </div>
        </div>
      ) : (
        <div className={`border shadow-sm p-4 flex items-start gap-3 ${active.length === 0 ? "bg-emerald-500/5 border-emerald-500/30" : "bg-destructive/5 border-destructive/30"}`}>
          {active.length === 0 ? (
            <>
              <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0 mt-0.5" />
              <div>
                <div className="text-[14px] font-semibold text-foreground">All Azure services nominal</div>
                <div className="text-[12px] text-muted-foreground mt-0.5">No active incidents affecting Orbit's dependencies.</div>
              </div>
            </>
          ) : (
            <>
              <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
              <div>
                <div className="text-[14px] font-semibold text-foreground">{active.length} active Azure incident{active.length === 1 ? "" : "s"}</div>
                <div className="text-[12px] text-muted-foreground mt-0.5">Review impacted services below; Kinisis applications in those regions may be affected.</div>
              </div>
            </>
          )}
        </div>
      )}

      <div className="bg-card border border-border shadow-sm">
        <div className="p-2 border-b border-border"><h2 className="text-sm font-semibold px-2">Recent events</h2></div>
        {isLoading ? (
          <div className="p-4 space-y-2"><Skeleton className="h-8" /><Skeleton className="h-8" /></div>
        ) : (events?.length ?? 0) === 0 ? (
          <div className="p-8 text-center space-y-3">
            <Activity className="h-8 w-8 mx-auto text-muted-foreground/40" />
            <div className="text-[14px] font-semibold text-foreground">No service health events</div>
            <div className="text-[12px] text-muted-foreground">No incidents or advisories in the tracked subscriptions.</div>
          </div>
        ) : (
          <Table className="text-[13px]">
            <TableHeader className="bg-muted/50 hover:bg-muted/50 border-b border-border">
              <TableRow className="hover:bg-transparent">
                <TableHead className="h-8 font-semibold text-foreground">Title</TableHead>
                <TableHead className="h-8 font-semibold text-foreground">Service</TableHead>
                <TableHead className="h-8 font-semibold text-foreground">Region</TableHead>
                <TableHead className="h-8 font-semibold text-foreground">Severity</TableHead>
                <TableHead className="h-8 font-semibold text-foreground">Status</TableHead>
                <TableHead className="h-8 font-semibold text-foreground">Started</TableHead>
                <TableHead className="h-8 font-semibold text-foreground">Resolved</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(events ?? []).map((e) => (
                <TableRow key={e.id} className="h-8 border-b border-border/50 hover:bg-muted/40">
                  <TableCell className="py-1 font-medium">{e.title}</TableCell>
                  <TableCell className="py-1 text-muted-foreground">{e.service}</TableCell>
                  <TableCell className="py-1 text-muted-foreground">{e.region}</TableCell>
                  <TableCell className="py-1"><StatusPill tone={SEV_TONE[e.severity]}>{e.severity}</StatusPill></TableCell>
                  <TableCell className="py-1"><StatusPill tone={TONE[e.status]}>{e.status}</StatusPill></TableCell>
                  <TableCell className="py-1 text-muted-foreground" title={format(new Date(e.startedAt), "PPpp")}>{formatDistanceToNow(new Date(e.startedAt), { addSuffix: true })}</TableCell>
                  <TableCell className="py-1 text-muted-foreground">{e.resolvedAt ? formatDistanceToNow(new Date(e.resolvedAt), { addSuffix: true }) : "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
