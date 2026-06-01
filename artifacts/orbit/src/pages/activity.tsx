import { useMemo, useState } from "react";
import { useListApps } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Search, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { PageHeader, StatusPill } from "@/components/page-header";
import { buildActivity, type ActivityEntry } from "@/lib/mock-data";
import { ScopeSelect } from "@/lib/scope";
import { useScope } from "@/lib/scope-context";

const STATUS_TONE: Record<ActivityEntry["status"], "ok" | "warn" | "bad"> = {
  Succeeded: "ok",
  Started: "warn",
  Failed: "bad",
};
const CAT_TONE: Record<ActivityEntry["category"], "info" | "warn" | "ok" | "muted" | "bad"> = {
  Authorization: "warn",
  Configuration: "info",
  Operation: "ok",
  Cost: "muted",
  Security: "bad",
};

export default function ActivityLog() {
  const { scope, isGlobal } = useScope();
  const { data: apps, isLoading } = useListApps();
  const [filter, setFilter] = useState("");

  const entries = useMemo(() => (apps ? buildActivity(apps, 120) : []), [apps]);
  const rows = useMemo(() => {
    let r = isGlobal ? entries : entries.filter((e) => e.appId === scope);
    if (filter) {
      const f = filter.toLowerCase();
      r = r.filter((e) =>
        e.actor.toLowerCase().includes(f) ||
        e.action.toLowerCase().includes(f) ||
        e.target.toLowerCase().includes(f) ||
        e.category.toLowerCase().includes(f),
      );
    }
    return r;
  }, [entries, scope, isGlobal, filter]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Activity log"
        subtitle="Audit trail of operator and automation actions across all subscriptions"
        right={<ScopeSelect />}
      />

      <div className="bg-card border border-border shadow-sm">
        <div className="flex items-center justify-between p-2 border-b border-border gap-2 flex-wrap">
          <h2 className="text-sm font-semibold px-2">{rows.length} events</h2>
          <div className="flex items-center gap-1">
            <div className="relative">
              <Search className="h-3.5 w-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter actor, action, target, category" className="h-7 w-80 pl-7 text-[12px] rounded-sm" />
            </div>
            <Button variant="ghost" size="sm" className="h-7 text-xs px-2 rounded-sm text-primary">
              <Download className="h-3.5 w-3.5 mr-1.5" />
              Export
            </Button>
          </div>
        </div>

        <div className="overflow-x-auto">
          {isLoading ? (
            <div className="p-4 space-y-2"><Skeleton className="h-8" /><Skeleton className="h-8" /><Skeleton className="h-8" /></div>
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
                    <TableCell className="py-1"><StatusPill tone={CAT_TONE[e.category]}>{e.category}</StatusPill></TableCell>
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
