import { useApps } from "@/hooks/use-apps";
import type { AppSummary } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/page-header";
import { Tag } from "lucide-react";

const KNOWN_TAGS = ["workload", "environment", "owner", "cost-center", "criticality"] as const;
type KnownTag = (typeof KNOWN_TAGS)[number];

const TAG_LABELS: Record<KnownTag, string> = {
  workload: "Workload",
  environment: "Environment",
  owner: "Owner",
  "cost-center": "Cost Center",
  criticality: "Criticality",
};

function criticalityVariant(value: string | undefined): "default" | "secondary" | "destructive" | "outline" {
  switch (value?.toLowerCase()) {
    case "mission-critical": return "destructive";
    case "high": return "default";
    case "medium": return "secondary";
    case "low": return "outline";
    default: return "outline";
  }
}

function criticalityClass(value: string | undefined): string {
  switch (value?.toLowerCase()) {
    case "mission-critical": return "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30";
    case "high": return "bg-orange-500/15 text-orange-600 dark:text-orange-400 border-orange-500/30";
    case "medium": return "bg-yellow-500/15 text-yellow-600 dark:text-yellow-600 border-yellow-500/30";
    case "low": return "bg-green-500/15 text-green-600 dark:text-green-400 border-green-500/30";
    default: return "bg-muted/50 text-muted-foreground border-border";
  }
}

function TagCell({ tag, value }: { tag: KnownTag; value: string | undefined }) {
  if (!value) return <span className="text-muted-foreground/50 text-[12px] italic">—</span>;

  if (tag === "criticality") {
    return (
      <span className={`inline-flex items-center px-1.5 py-0.5 rounded-sm border text-[11px] font-medium ${criticalityClass(value)}`}>
        {value}
      </span>
    );
  }

  if (tag === "environment") {
    return (
      <span className="inline-flex items-center px-1.5 py-0.5 rounded-sm border border-border bg-muted/40 text-[11px] font-mono">
        {value}
      </span>
    );
  }

  return <span className="text-[12px] text-foreground">{value}</span>;
}

function getTag(app: AppSummary, key: KnownTag): string | undefined {
  const tags = app.tags as Record<string, string> | undefined;
  return tags?.[key];
}

function extraTags(app: AppSummary): [string, string][] {
  const tags = app.tags as Record<string, string> | undefined;
  if (!tags) return [];
  return Object.entries(tags).filter(([k]) => !(KNOWN_TAGS as readonly string[]).includes(k));
}

export default function Tags() {
  const { data: apps, isLoading } = useApps();

  return (
    <div className="space-y-4">
      <PageHeader title="Tags" subtitle="Azure resource-group tags across all Kinisis applications" />

      <div className="bg-card border border-border shadow-sm">
        <div className="p-2 border-b border-border flex items-center gap-2">
          <Tag className="h-3.5 w-3.5 text-muted-foreground ml-2" />
          <h2 className="text-sm font-semibold">Standard tag inventory</h2>
          <span className="text-[11px] text-muted-foreground ml-1">Five well-known Kinisis tag keys applied to every resource group</span>
        </div>

        {isLoading ? (
          <div className="p-4 space-y-2">
            <Skeleton className="h-8" />
            <Skeleton className="h-8" />
            <Skeleton className="h-8" />
          </div>
        ) : (
          <Table className="text-[13px]">
            <TableHeader className="bg-muted/50 border-b border-border">
              <TableRow className="hover:bg-transparent">
                <TableHead className="h-8 font-semibold text-foreground w-[160px]">Application</TableHead>
                {KNOWN_TAGS.map((tag) => (
                  <TableHead key={tag} className="h-8 font-semibold text-foreground">
                    <span className="font-mono text-[11px] text-muted-foreground">{tag}</span>
                    <span className="block text-[10px] font-normal text-muted-foreground/70">{TAG_LABELS[tag]}</span>
                  </TableHead>
                ))}
                <TableHead className="h-8 font-semibold text-foreground text-right">Extra tags</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(apps ?? []).map((app) => {
                const extras = extraTags(app);
                return (
                  <TableRow key={app.id} className="border-b border-border/50 hover:bg-muted/40">
                    <TableCell className="py-1.5 font-medium text-primary">{app.name}</TableCell>
                    {KNOWN_TAGS.map((tag) => (
                      <TableCell key={tag} className="py-1.5">
                        <TagCell tag={tag} value={getTag(app, tag)} />
                      </TableCell>
                    ))}
                    <TableCell className="py-1.5 text-right">
                      {extras.length === 0 ? (
                        <span className="text-muted-foreground/50 text-[12px] italic">—</span>
                      ) : (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded-sm border border-border bg-muted/40 text-[11px] font-mono text-muted-foreground">
                          +{extras.length}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>

      {!isLoading && apps && apps.length > 0 && (
        <CoverageCard apps={apps} />
      )}
    </div>
  );
}

function CoverageCard({ apps }: { apps: AppSummary[] }) {
  const coverage = KNOWN_TAGS.map((tag) => {
    const tagged = apps.filter((a) => !!getTag(a, tag)).length;
    const pct = Math.round((tagged / apps.length) * 100);
    return { tag, tagged, total: apps.length, pct };
  });

  return (
    <div className="bg-card border border-border shadow-sm">
      <div className="p-2 border-b border-border">
        <h2 className="text-sm font-semibold px-2">Tag coverage</h2>
      </div>
      <div className="p-3 grid grid-cols-5 gap-3">
        {coverage.map(({ tag, tagged, total, pct }) => (
          <div key={tag} className="space-y-1">
            <div className="text-[11px] font-mono text-muted-foreground">{tag}</div>
            <div className="text-lg font-semibold tabular-nums">
              {pct}%
            </div>
            <div className="text-[11px] text-muted-foreground">{tagged}/{total} apps</div>
            <div className="h-1 bg-muted rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${pct === 100 ? "bg-green-500" : pct >= 50 ? "bg-yellow-500" : "bg-red-500"}`}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
