import { useMemo, useState } from "react";
import { useListApps, useGetApp } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { buildTags } from "@/lib/mock-data";

export default function Tags() {
  const { data: apps, isLoading } = useListApps();
  const [filter, setFilter] = useState("");

  // useGetApp per app would be N calls — but mock app records on list don't include `tags`.
  // We rebuild tag aggregation by reading the tag set lazily from list endpoint where available.
  const tagsResult = useMemo(() => {
    if (!apps) return [];
    return buildTags(apps.map((a) => ({ ...a, name: a.name, resourceGroup: a.resourceGroup, region: a.region, subscriptionId: a.subscriptionId ?? "", tags: (a as { tags?: Record<string, string> }).tags || {} })));
  }, [apps]);

  const rows = filter
    ? tagsResult.filter((t) => `${t.key}=${t.value}`.toLowerCase().includes(filter.toLowerCase()))
    : tagsResult;

  return (
    <div className="space-y-4">
      <PageHeader title="Tags" subtitle="Tag explorer across all Kinisis applications" />

      <div className="bg-card border border-border shadow-sm">
        <div className="p-2 border-b border-border flex items-center justify-between gap-2 flex-wrap">
          <h2 className="text-sm font-semibold px-2">{rows.length} unique tags</h2>
          <div className="relative">
            <Search className="h-3.5 w-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter key=value" className="h-7 w-72 pl-7 text-[12px] rounded-sm" />
          </div>
        </div>
        {isLoading ? (
          <div className="p-4 space-y-2"><Skeleton className="h-8" /><Skeleton className="h-8" /></div>
        ) : rows.length === 0 ? (
          <div className="p-6 text-center text-muted-foreground text-[13px]">
            No tag data is exposed by the current API. Tags are visible on individual application detail pages.
          </div>
        ) : (
          <Table className="text-[13px]">
            <TableHeader className="bg-muted/50 hover:bg-muted/50 border-b border-border">
              <TableRow className="hover:bg-transparent">
                <TableHead className="h-8 font-semibold text-foreground">Key</TableHead>
                <TableHead className="h-8 font-semibold text-foreground">Value</TableHead>
                <TableHead className="h-8 font-semibold text-foreground text-right">Apps</TableHead>
                <TableHead className="h-8 font-semibold text-foreground">Applied to</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((t) => (
                <TableRow key={`${t.key}=${t.value}`} className="border-b border-border/50 hover:bg-muted/40">
                  <TableCell className="py-1 font-mono text-[12px]">{t.key}</TableCell>
                  <TableCell className="py-1 font-mono text-[12px] text-primary">{t.value}</TableCell>
                  <TableCell className="py-1 text-right tabular-nums">{t.appCount}</TableCell>
                  <TableCell className="py-1 text-muted-foreground">{t.apps.join(", ")}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {apps && apps.length > 0 && tagsResult.length === 0 && <PerAppTagFallback appIds={apps.map((a) => a.id)} />}
    </div>
  );
}

// Fallback: the list endpoint doesn't include tags, so we hydrate per-app via getApp.
function PerAppTagFallback({ appIds }: { appIds: string[] }) {
  return (
    <div className="bg-card border border-border shadow-sm">
      <div className="p-2 border-b border-border"><h2 className="text-sm font-semibold px-2">Per-application tags</h2></div>
      <div className="divide-y divide-border/50">
        {appIds.map((id) => <AppTagRow key={id} appId={id} />)}
      </div>
    </div>
  );
}

function AppTagRow({ appId }: { appId: string }) {
  const { data } = useGetApp(appId);
  if (!data) return null;
  const entries = Object.entries(data.tags || {});
  return (
    <div className="px-3 py-2 grid grid-cols-[200px_1fr] gap-3 text-[13px] hover:bg-muted/40">
      <div className="font-medium text-primary">{data.name}</div>
      <div className="text-muted-foreground">
        {entries.length === 0 ? (
          <span className="italic">No tags</span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {entries.map(([k, v]) => (
              <span key={k} className="inline-flex items-center px-2 py-0.5 rounded-sm border border-border bg-muted/40 font-mono text-[11px]">
                {k}=<span className="text-foreground ml-0.5">{v}</span>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
