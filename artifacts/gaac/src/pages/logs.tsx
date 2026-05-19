import { useMemo, useState } from "react";
import { useListApps } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Play, Download } from "lucide-react";
import { format } from "date-fns";
import { PageHeader } from "@/components/page-header";
import { buildLogs, type LogLine } from "@/lib/mock-data";

const LEVEL_COLOR: Record<LogLine["level"], string> = {
  INFO: "text-muted-foreground",
  WARN: "text-amber-500",
  ERROR: "text-destructive",
};

const SAMPLE_QUERIES = [
  "AppRequests | where ResultCode startswith '5' | take 50",
  "AppExceptions | summarize count() by Type",
  "AppDependencies | where DurationMs > 1000",
  "AppTraces | where SeverityLevel >= 2",
];

export default function Logs() {
  const { data: apps, isLoading } = useListApps();
  const [query, setQuery] = useState(SAMPLE_QUERIES[0]!);
  const [ran, setRan] = useState(SAMPLE_QUERIES[0]!);

  const rows = useMemo(() => (apps ? buildLogs(apps, ran, 60) : []), [apps, ran]);

  return (
    <div className="space-y-4">
      <PageHeader title="Log search" subtitle="KQL queries against the centralised Log Analytics workspace" />

      <div className="bg-card border border-border shadow-sm">
        <div className="p-2 border-b border-border flex items-center gap-2">
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold px-2">Query</span>
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") setRan(query); }}
            placeholder="KQL"
            className="h-8 text-[12px] font-mono rounded-sm flex-1"
          />
          <Button size="sm" className="h-8 rounded-sm" onClick={() => setRan(query)}>
            <Play className="h-3.5 w-3.5 mr-1.5" /> Run
          </Button>
          <Button variant="ghost" size="sm" className="h-8 rounded-sm text-primary">
            <Download className="h-3.5 w-3.5 mr-1.5" /> Export
          </Button>
        </div>
        <div className="px-2 pb-2 flex flex-wrap gap-1">
          {SAMPLE_QUERIES.map((q) => (
            <Button key={q} variant="ghost" size="sm" className="h-6 text-[11px] px-2 rounded-sm text-primary font-mono" onClick={() => { setQuery(q); setRan(q); }}>
              {q.length > 56 ? q.slice(0, 56) + "…" : q}
            </Button>
          ))}
        </div>
      </div>

      <div className="bg-card border border-border shadow-sm">
        <div className="p-2 border-b border-border flex items-center justify-between">
          <h2 className="text-sm font-semibold px-2">{rows.length} results</h2>
          <span className="text-[11px] text-muted-foreground px-2">Workspace: <span className="font-mono">law-gaac-prod</span></span>
        </div>
        {isLoading ? (
          <div className="p-4 space-y-2"><Skeleton className="h-6" /><Skeleton className="h-6" /></div>
        ) : (
          <div className="font-mono text-[12px] divide-y divide-border/50 max-h-[60vh] overflow-y-auto">
            {rows.map((r) => (
              <div key={r.id} className="px-3 py-1.5 hover:bg-muted/40 grid grid-cols-[170px_60px_120px_1fr] gap-2">
                <span className="text-muted-foreground">{format(new Date(r.timestamp), "yyyy-MM-dd HH:mm:ss")}</span>
                <span className={`${LEVEL_COLOR[r.level]} font-semibold`}>{r.level}</span>
                <span className="text-primary truncate">{r.appId}</span>
                <span className="text-foreground truncate">{r.message}</span>
              </div>
            ))}
            {rows.length === 0 && <div className="p-6 text-center text-muted-foreground text-[13px] font-sans">No log lines match.</div>}
          </div>
        )}
      </div>
    </div>
  );
}
