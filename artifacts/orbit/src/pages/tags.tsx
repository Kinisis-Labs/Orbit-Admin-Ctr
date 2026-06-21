import { useApps } from "@/hooks/use-apps";
import type { AppSummary, TagComplianceEntry } from "@workspace/api-client-react";
import { useGetTagCompliance } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { PageHeader } from "@/components/page-header";
import {
  Tag,
  AlertTriangle,
  CheckCircle2,
  Info,
  ChevronRight,
  RefreshCw,
  Layers,
  ExternalLink,
} from "lucide-react";
import { useState, Fragment } from "react";
import { cn } from "@/lib/utils";

const KNOWN_TAGS = ["CostCategory", "Application", "ServiceType", "CostCenter", "Owner", "Environment"] as const;
type KnownTag = (typeof KNOWN_TAGS)[number];

const TAG_LABELS: Record<KnownTag, string> = {
  CostCategory: "Cost Category",
  Application: "Application",
  ServiceType: "Service Type",
  CostCenter: "Cost Center",
  Owner: "Owner",
  Environment: "Environment",
};

const COST_CATEGORY_VALUES = [
  "Infrastructure",
  "WebApp",
  "BusinessOps",
  "DataPlatform",
  "Security",
  "AI",
  "Shared",
] as const;
type CostCategory = (typeof COST_CATEGORY_VALUES)[number];

const COST_CATEGORY_COLOR: Record<CostCategory, string> = {
  Infrastructure: "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30",
  WebApp: "bg-violet-500/15 text-violet-600 dark:text-violet-400 border-violet-500/30",
  BusinessOps: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30",
  DataPlatform: "bg-cyan-500/15 text-cyan-600 dark:text-cyan-400 border-cyan-500/30",
  Security: "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30",
  AI: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
  Shared: "bg-muted/60 text-muted-foreground border-border",
};

const ENVIRONMENT_COLOR: Record<string, string> = {
  Prod: "bg-green-500/15 text-green-600 dark:text-green-400 border-green-500/30",
  Dev: "bg-sky-500/15 text-sky-600 dark:text-sky-400 border-sky-500/30",
  Test: "bg-yellow-500/15 text-yellow-600 dark:text-yellow-500 border-yellow-500/30",
  Sandbox: "bg-muted/60 text-muted-foreground border-border",
};

function TagCell({ tag, value }: { tag: KnownTag; value: string | undefined }) {
  if (!value) return <span className="text-muted-foreground/50 text-[12px] italic">—</span>;
  if (tag === "CostCategory") {
    const color =
      COST_CATEGORY_COLOR[value as CostCategory] ??
      "bg-muted/50 text-muted-foreground border-border";
    return (
      <span
        className={`inline-flex items-center px-1.5 py-0.5 rounded-sm border text-[11px] font-medium ${color}`}
      >
        {value}
      </span>
    );
  }
  if (tag === "Environment") {
    const color = ENVIRONMENT_COLOR[value] ?? "bg-muted/60 text-muted-foreground border-border";
    return (
      <span
        className={`inline-flex items-center px-1.5 py-0.5 rounded-sm border text-[11px] font-mono ${color}`}
      >
        {value}
      </span>
    );
  }
  if (tag === "Owner") {
    return (
      <span className="inline-flex items-center px-1.5 py-0.5 rounded-sm border border-border bg-muted/40 text-[11px] text-muted-foreground">
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

// ─── Compliance section ────────────────────────────────────────────────────

const SCOPE_LABEL: Record<TagComplianceEntry["scope"], string> = {
  subscription: "Subscription",
  "resource-group": "Resource Group",
  resource: "Resource",
};

const SCOPE_ORDER: Record<TagComplianceEntry["scope"], number> = {
  subscription: 0,
  "resource-group": 1,
  resource: 2,
};

function scopeIcon(scope: TagComplianceEntry["scope"]): string {
  switch (scope) {
    case "subscription":
      return "◈";
    case "resource-group":
      return "▣";
    case "resource":
      return "◻";
    default:
      return "◻";
  }
}

function shortenType(type: string): string {
  // e.g. "microsoft.containerapp/containerapps" → "ContainerApps"
  const parts = type.split("/");
  const leaf = parts[parts.length - 1] ?? type;
  return leaf
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .split(/(?=[A-Z])/)
    .join(" ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

type GroupedSub = {
  subscriptionId: string;
  rgs: Map<string, TagComplianceEntry[]>; // rg name → resources in that rg
  subEntries: TagComplianceEntry[]; // subscription-scope entries
  rgEntries: TagComplianceEntry[]; // resource-group-scope entries
};

function groupBySubscription(entries: TagComplianceEntry[]): GroupedSub[] {
  const subMap = new Map<string, GroupedSub>();
  for (const entry of entries) {
    const sub = entry.subscriptionId;
    if (!subMap.has(sub)) {
      subMap.set(sub, { subscriptionId: sub, rgs: new Map(), subEntries: [], rgEntries: [] });
    }
    const group = subMap.get(sub)!;
    if (entry.scope === "subscription") {
      group.subEntries.push(entry);
    } else if (entry.scope === "resource-group") {
      group.rgEntries.push(entry);
    } else {
      const rg = entry.resourceGroup ?? "(no resource group)";
      if (!group.rgs.has(rg)) group.rgs.set(rg, []);
      group.rgs.get(rg)!.push(entry);
    }
  }
  return [...subMap.values()];
}

function azurePortalUrl(resourceId: string): string {
  return `https://portal.azure.com/#@/resource${encodeURIComponent(resourceId)}/tags`;
}

function MissingTagBadge({ tag }: { tag: string }) {
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded-sm border border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400 text-[10px] font-mono">
      {tag}
    </span>
  );
}

function ComplianceRow({ entry, indent = 0 }: { entry: TagComplianceEntry; indent?: number }) {
  const portalUrl = azurePortalUrl(entry.id);
  return (
    <TableRow className="border-b border-border/40 hover:bg-muted/30">
      <TableCell className="py-1.5" style={{ paddingLeft: `${(indent + 1) * 16}px` }}>
        <span className="text-muted-foreground/60 text-[11px] mr-1.5 select-none">
          {scopeIcon(entry.scope)}
        </span>
        <a
          href={portalUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-[12px] font-medium text-foreground hover:text-primary hover:underline group"
          title="Open in Azure Portal → Tags"
        >
          {entry.name || entry.id.split("/").pop()}
          <ExternalLink className="h-3 w-3 opacity-0 group-hover:opacity-60 transition-opacity shrink-0" />
        </a>
      </TableCell>
      <TableCell className="py-1.5">
        <span className="text-[11px] text-muted-foreground">{SCOPE_LABEL[entry.scope]}</span>
      </TableCell>
      <TableCell className="py-1.5">
        <span className="text-[10px] text-muted-foreground/70 font-mono truncate max-w-[200px] block">
          {shortenType(entry.type)}
        </span>
      </TableCell>
      <TableCell className="py-1.5">
        <div className="flex flex-wrap gap-1">
          {entry.missingTags.map((t: string) => (
            <MissingTagBadge key={t} tag={t} />
          ))}
        </div>
      </TableCell>
    </TableRow>
  );
}

function SubscriptionGroup({ group }: { group: GroupedSub }) {
  const [open, setOpen] = useState(true);
  const totalInSub =
    group.subEntries.length +
    group.rgEntries.length +
    [...group.rgs.values()].reduce((s, rs) => s + rs.length, 0);

  return (
    <>
      <TableRow
        className="border-b border-border/60 bg-muted/20 cursor-pointer hover:bg-muted/40 select-none"
        onClick={() => setOpen((o) => !o)}
      >
        <TableCell colSpan={4} className="py-1.5 pl-3">
          <div className="flex items-center gap-2">
            <ChevronRight
              className={cn(
                "h-3.5 w-3.5 text-muted-foreground transition-transform",
                open && "rotate-90",
              )}
            />
            <span className="text-[11px] font-mono text-muted-foreground">
              {group.subscriptionId}
            </span>
            <Badge
              variant="outline"
              className="text-[10px] px-1 py-0 h-4 border-red-500/40 text-red-500"
            >
              {totalInSub} non-compliant
            </Badge>
          </div>
        </TableCell>
      </TableRow>

      {open && (
        <>
          {group.subEntries.map((e) => (
            <ComplianceRow key={e.id} entry={e} indent={0} />
          ))}
          {group.rgEntries.map((e) => (
            <ComplianceRow key={e.id} entry={e} indent={0} />
          ))}
          {[...group.rgs.entries()].map(([rg, resources]) => (
            <Fragment key={`rg-${rg}`}>
              <TableRow className="border-b border-border/30 bg-muted/10">
                <TableCell colSpan={4} className="py-1 pl-8">
                  <span className="text-[10px] text-muted-foreground/70 font-mono">{rg}</span>
                </TableCell>
              </TableRow>
              {resources.map((e) => (
                <ComplianceRow key={e.id} entry={e} indent={2} />
              ))}
            </Fragment>
          ))}
        </>
      )}
    </>
  );
}

function ComplianceSummary({
  total,
  nonCompliant,
  entries,
}: {
  total: number;
  nonCompliant: number;
  entries: TagComplianceEntry[];
}) {
  const pctCompliant = total > 0 ? Math.round(((total - nonCompliant) / total) * 100) : 100;

  const byTag = KNOWN_TAGS.map((tag) => ({
    tag,
    missing: entries.filter((e) => e.missingTags.includes(tag)).length,
  }));

  return (
    <div className="p-3 border-b border-border grid grid-cols-2 gap-4">
      <div className="space-y-2">
        <div className="flex items-baseline gap-2">
          <span
            className={cn(
              "text-2xl font-semibold tabular-nums",
              pctCompliant === 100
                ? "text-green-500"
                : pctCompliant >= 80
                  ? "text-yellow-500"
                  : "text-red-500",
            )}
          >
            {pctCompliant}%
          </span>
          <span className="text-[12px] text-muted-foreground">compliant</span>
        </div>
        <div className="text-[11px] text-muted-foreground">
          {total - nonCompliant} of {total} resources fully tagged
        </div>
        <div className="h-1.5 bg-muted rounded-full overflow-hidden w-48">
          <div
            className={cn(
              "h-full rounded-full",
              pctCompliant === 100
                ? "bg-green-500"
                : pctCompliant >= 80
                  ? "bg-yellow-500"
                  : "bg-red-500",
            )}
            style={{ width: `${pctCompliant}%` }}
          />
        </div>
      </div>
      <div className="space-y-1">
        <div className="text-[11px] font-medium text-muted-foreground mb-1.5">
          Missing by tag key
        </div>
        {byTag.map(({ tag, missing }) => (
          <div key={tag} className="flex items-center gap-2 text-[11px]">
            <span className="font-mono text-muted-foreground w-28 shrink-0">{tag}</span>
            <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden">
              <div
                className={cn(
                  "h-full rounded-full",
                  missing === 0 ? "bg-green-500" : missing < 5 ? "bg-yellow-500" : "bg-red-500",
                )}
                style={{ width: total > 0 ? `${Math.round((missing / total) * 100)}%` : "0%" }}
              />
            </div>
            {missing > 0 ? (
              <span className="text-red-500 w-8 text-right tabular-nums">{missing}</span>
            ) : (
              <span className="text-green-500 w-8 text-right">✓</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function TagComplianceCard() {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const { data, isLoading, refetch } = useGetTagCompliance();

  async function handleRefresh() {
    setIsRefreshing(true);
    await refetch();
    setIsRefreshing(false);
  }

  if (isLoading) {
    return (
      <div className="bg-card border border-border shadow-sm">
        <div className="p-2 border-b border-border flex items-center gap-2">
          <AlertTriangle className="h-3.5 w-3.5 text-muted-foreground ml-2" />
          <h2 className="text-sm font-semibold">Tag compliance</h2>
        </div>
        <div className="p-4 space-y-2">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
        </div>
      </div>
    );
  }

  if (!data || data.dataSource === "unavailable") {
    return (
      <div className="bg-card border border-border shadow-sm">
        <div className="p-2 border-b border-border flex items-center gap-2">
          <AlertTriangle className="h-3.5 w-3.5 text-muted-foreground ml-2" />
          <h2 className="text-sm font-semibold">Tag compliance</h2>
          <span className="text-[11px] text-muted-foreground ml-1">
            Live scan across subscriptions → RGs → resources
          </span>
        </div>
        <Alert className="m-3 border-border/60">
          <Info className="h-4 w-4" />
          <AlertDescription className="text-sm">
            Azure is not configured — set{" "}
            <code className="text-xs bg-muted px-1 rounded">AZURE_SUBSCRIPTION_IDS</code> on the
            Container App to enable live tag scanning.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (data.dataSource === "error") {
    return (
      <div className="bg-card border border-border shadow-sm">
        <div className="p-2 border-b border-border flex items-center gap-2">
          <AlertTriangle className="h-3.5 w-3.5 text-destructive ml-2" />
          <h2 className="text-sm font-semibold">Tag compliance</h2>
          <span className="text-[11px] text-muted-foreground ml-1">
            Live scan across subscriptions → RGs → resources
          </span>
          <button
            type="button"
            onClick={() => void handleRefresh()}
            disabled={isRefreshing}
            aria-label="Retry tag compliance scan"
            title="Retry scan"
            className={`ml-auto flex items-center justify-center rounded p-1 transition-colors ${
              isRefreshing
                ? "cursor-not-allowed text-primary opacity-60"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
            }`}
          >
            <RefreshCw className={`h-3.5 w-3.5${isRefreshing ? " animate-spin" : ""}`} />
          </button>
        </div>
        <Alert variant="destructive" className="m-3">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription className="text-sm space-y-1">
            <p>{data.errorMessage ?? "Tag compliance scan failed — Azure returned an error."}</p>
            <p className="text-xs opacity-70">
              Check the API server logs for the full error detail. Use the refresh button to retry.
            </p>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const { totalScanned, nonCompliantCount, entries, scannedAt } = data;
  const grouped = groupBySubscription(
    [...entries].sort((a, b) => SCOPE_ORDER[a.scope] - SCOPE_ORDER[b.scope]),
  );

  return (
    <div className="bg-card border border-border shadow-sm">
      <div className="p-2 border-b border-border flex items-center gap-2">
        <AlertTriangle className="h-3.5 w-3.5 text-muted-foreground ml-2" />
        <h2 className="text-sm font-semibold">Tag compliance</h2>
        <span className="text-[11px] text-muted-foreground ml-1">
          Live scan · {totalScanned} resources
        </span>
        {nonCompliantCount === 0 ? (
          <span className="flex items-center gap-1 text-[11px] text-green-500">
            <CheckCircle2 className="h-3.5 w-3.5" /> All compliant
          </span>
        ) : (
          <Badge variant="destructive" className="text-[10px] px-1.5">
            {nonCompliantCount} missing tags
          </Badge>
        )}
        <button
          type="button"
          onClick={() => void handleRefresh()}
          disabled={isRefreshing || isLoading}
          aria-label="Refresh tag compliance scan"
          title="Re-scan now (bypasses 15-min cache)"
          className={`ml-auto flex items-center justify-center rounded p-1 transition-colors ${
            isRefreshing
              ? "cursor-not-allowed text-primary opacity-60"
              : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
          }`}
        >
          <RefreshCw className={`h-3.5 w-3.5${isRefreshing ? " animate-spin" : ""}`} />
        </button>
      </div>

      {nonCompliantCount === 0 ? (
        <div className="p-6 text-center space-y-1">
          <CheckCircle2 className="h-8 w-8 text-green-500 mx-auto" />
          <p className="text-sm font-medium">All {totalScanned} resources are fully tagged</p>
          <p className="text-[11px] text-muted-foreground">
            Scanned at {new Date(scannedAt).toLocaleTimeString()}
          </p>
        </div>
      ) : (
        <>
          <ComplianceSummary
            total={totalScanned}
            nonCompliant={nonCompliantCount}
            entries={entries}
          />
          <Table className="text-[12px]">
            <TableHeader className="bg-muted/50 border-b border-border">
              <TableRow className="hover:bg-transparent">
                <TableHead className="h-7 font-semibold text-foreground text-[11px]">
                  Resource
                </TableHead>
                <TableHead className="h-7 font-semibold text-foreground text-[11px]">
                  Scope
                </TableHead>
                <TableHead className="h-7 font-semibold text-foreground text-[11px]">
                  Type
                </TableHead>
                <TableHead className="h-7 font-semibold text-foreground text-[11px]">
                  Missing tags
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {grouped.map((g) => (
                <SubscriptionGroup key={g.subscriptionId} group={g} />
              ))}
            </TableBody>
          </Table>
          <div className="px-3 py-2 border-t border-border/50 text-[10px] text-muted-foreground">
            Scanned at {new Date(scannedAt).toLocaleString()} · refreshes every 15 min
          </div>
        </>
      )}
    </div>
  );
}

// ─── Application tag inventory ─────────────────────────────────────────────

function ApplicationTagInventory() {
  const { data, isLoading } = useGetTagCompliance();

  const rows = (() => {
    const counts = data?.applicationTagCounts;
    if (!counts) return null;
    return (Object.entries(counts) as [string, number][])
      .filter(([k]) => k !== "(untagged)")
      .sort((a, b) => b[1] - a[1])
      .map(([appTag, total]) => {
        const nonCompliant = data?.entries
          ? data.entries.filter((e) => {
              const tags = e.tags as Record<string, string> | undefined | null;
              const val = tags?.["Application"] ?? tags?.["application"];
              return val === appTag;
            }).length
          : 0;
        return { appTag, total, nonCompliant };
      });
  })();

  const untagged = data?.applicationTagCounts?.["(untagged)"] ?? 0;
  const totalScanned = data?.totalScanned ?? 0;

  return (
    <div className="bg-card border border-border shadow-sm">
      <div className="p-2 border-b border-border flex items-center gap-2">
        <Tag className="h-3.5 w-3.5 text-muted-foreground ml-2" />
        <h2 className="text-sm font-semibold">Tag inventory</h2>
        <span className="text-[11px] text-muted-foreground ml-1">
          Grouped by <span className="font-mono">Application</span> tag · Azure resource scan
        </span>
        {totalScanned > 0 && (
          <span className="text-[11px] text-muted-foreground ml-auto">{totalScanned} resources</span>
        )}
      </div>

      {isLoading ? (
        <div className="p-4 space-y-2">
          <Skeleton className="h-8" />
          <Skeleton className="h-8" />
          <Skeleton className="h-8" />
        </div>
      ) : !data || data.dataSource === "unavailable" ? (
        <div className="p-4 text-[12px] text-muted-foreground italic">
          Azure not configured — set{" "}
          <code className="text-xs bg-muted px-1 rounded">AZURE_SUBSCRIPTION_IDS</code> to enable
          tag scanning.
        </div>
      ) : !rows || rows.length === 0 ? (
        <div className="p-4 text-[12px] text-muted-foreground italic">
          No <span className="font-mono">Application</span> tags found on scanned resources yet.
        </div>
      ) : (
        <Table className="text-[13px]">
          <TableHeader className="bg-muted/50 border-b border-border">
            <TableRow className="hover:bg-transparent">
              <TableHead className="h-8 font-semibold text-foreground w-[200px]">
                Application tag
              </TableHead>
              <TableHead className="h-8 font-semibold text-foreground text-right">
                Resources
              </TableHead>
              <TableHead className="h-8 font-semibold text-foreground text-right">
                Non-compliant
              </TableHead>
              <TableHead className="h-8 font-semibold text-foreground text-right">
                Compliance
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(({ appTag, total, nonCompliant }) => {
              const pct = total > 0 ? Math.round(((total - nonCompliant) / total) * 100) : 100;
              const colorClass =
                COST_CATEGORY_COLOR[appTag as CostCategory] ??
                "bg-muted/50 text-muted-foreground border-border";
              return (
                <TableRow key={appTag} className="border-b border-border/50 hover:bg-muted/40">
                  <TableCell className="py-2">
                    <span
                      className={`inline-flex items-center px-1.5 py-0.5 rounded-sm border text-[11px] font-medium ${colorClass}`}
                    >
                      {appTag}
                    </span>
                  </TableCell>
                  <TableCell className="py-2 text-right tabular-nums text-[12px]">{total}</TableCell>
                  <TableCell className="py-2 text-right tabular-nums text-[12px]">
                    {nonCompliant === 0 ? (
                      <span className="text-green-500">0</span>
                    ) : (
                      <span className="text-destructive">{nonCompliant}</span>
                    )}
                  </TableCell>
                  <TableCell className="py-2 text-right">
                    <span
                      className={`text-[11px] font-medium ${pct === 100 ? "text-green-500" : pct >= 80 ? "text-amber-500" : "text-destructive"}`}
                    >
                      {pct}%
                    </span>
                  </TableCell>
                </TableRow>
              );
            })}
            {untagged > 0 && (
              <TableRow className="border-b border-border/40 bg-muted/10">
                <TableCell className="py-2">
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded-sm border border-dashed border-border text-[11px] text-muted-foreground/60 italic">
                    (untagged)
                  </span>
                </TableCell>
                <TableCell className="py-2 text-right tabular-nums text-[12px] text-muted-foreground">
                  {untagged}
                </TableCell>
                <TableCell className="py-2 text-right tabular-nums text-[12px] text-destructive">
                  {untagged}
                </TableCell>
                <TableCell className="py-2 text-right">
                  <span className="text-[11px] font-medium text-destructive">0%</span>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────────

export default function Tags() {
  const { data: apps, isLoading } = useApps();

  return (
    <div className="space-y-4">
      <PageHeader
        title="Tags"
        subtitle="Azure tagging strategy — CostCategory, Application, ServiceType, Owner, Environment"
      />

      <CostCategoryRollupPanel apps={apps ?? []} isLoading={isLoading} />

      <ApplicationTagInventory />

      {!isLoading && apps && apps.length > 0 && <CoverageCard apps={apps} />}

      <TagComplianceCard />
    </div>
  );
}

const STRATEGY_SCHEMA: {
  tag: KnownTag;
  required: boolean;
  values: string[];
  description: string;
}[] = [
  {
    tag: "CostCategory",
    required: true,
    values: ["Infrastructure", "WebApp", "BusinessOps", "DataPlatform", "Security", "AI", "Shared"],
    description: "Top-level cost reporting category",
  },
  {
    tag: "Application",
    required: true,
    values: ["Orbit", "Atlas", "Flora", "Constellation", "Shared", "InternalOps"],
    description: "Which product or system owns this resource",
  },
  {
    tag: "Environment",
    required: true,
    values: ["Prod", "Dev", "Test", "Sandbox"],
    description: "Deployment environment",
  },
  {
    tag: "ServiceType",
    required: false,
    values: [
      "AppService",
      "Database",
      "Storage",
      "Networking",
      "Monitoring",
      "AI",
      "Identity",
      "Automation",
    ],
    description: "Azure service category",
  },
  {
    tag: "Owner",
    required: false,
    values: ["Platform", "Operations", "Marketing", "Engineering"],
    description: "Team responsible for this resource",
  },
];

function CostCategoryRollupPanel({ apps, isLoading }: { apps: AppSummary[]; isLoading: boolean }) {
  const { data: compliance } = useGetTagCompliance();

  // Build rollup from applicationTagCounts — populated by the backend across ALL scanned
  // resources (not just non-compliant ones), so the numbers are always accurate.
  const { rollup, untagged, total, sourceLabel } = (() => {
    const counts = compliance?.applicationTagCounts;
    const scanned = compliance?.totalScanned ?? 0;
    if (counts && scanned > 0) {
      const untaggedCount = counts["(untagged)"] ?? 0;
      const rollupData = (Object.entries(counts) as [string, number][])
        .filter(([k]) => k !== "(untagged)")
        .sort((a, b) => b[1] - a[1])
        .map(([app, count]) => ({ cat: app, count }));
      return {
        rollup: rollupData,
        untagged: untaggedCount,
        total: scanned,
        sourceLabel: `${scanned} resources scanned`,
      };
    }
    // Fallback: app-level records (before compliance data loads)
    const rollupData = COST_CATEGORY_VALUES.map((cat) => ({
      cat,
      count: apps.filter((a) => getTag(a, "CostCategory") === cat).length,
    })).filter((r) => r.count > 0);
    const untaggedCount = apps.filter((a) => !getTag(a, "CostCategory")).length;
    return {
      rollup: rollupData,
      untagged: untaggedCount,
      total: apps.length,
      sourceLabel: `${apps.length} apps tracked`,
    };
  })();

  return (
    <div className="bg-card border border-border shadow-sm">
      <div className="p-2 border-b border-border flex items-center gap-2">
        <Layers className="h-3.5 w-3.5 text-muted-foreground ml-2" />
        <h2 className="text-sm font-semibold">Tag strategy overview</h2>
        <span className="text-[11px] text-muted-foreground ml-1">
          Based on Azure Cost Tagging Strategy · {sourceLabel}
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-border">
        <div className="p-4">
          <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-3">
            Application tag breakdown (by resource)
          </div>
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-6 w-4/5" />
            </div>
          ) : rollup.length === 0 ? (
            <div className="text-[12px] text-muted-foreground italic py-2">
              No <span className="font-mono">Application</span> tags found — apply the{" "}
              <span className="font-mono">Application</span> tag in Azure portal to populate this
              view.
            </div>
          ) : (
            <div className="space-y-2">
              {rollup.map(({ cat, count }) => {
                const colorClass =
                  COST_CATEGORY_COLOR[cat as CostCategory] ??
                  "bg-muted/50 text-muted-foreground border-border";
                const pct = total > 0 ? Math.round((count / total) * 100) : 0;
                return (
                  <div key={cat} className="flex items-center gap-3">
                    <span
                      className={`inline-flex items-center px-1.5 py-0.5 rounded-sm border text-[11px] font-medium w-28 shrink-0 ${colorClass}`}
                    >
                      {cat}
                    </span>
                    <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full bg-primary/60 transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="text-[11px] tabular-nums text-muted-foreground w-14 text-right">
                      {count} resource{count !== 1 ? "s" : ""}
                    </span>
                  </div>
                );
              })}
              {untagged > 0 && (
                <div className="flex items-center gap-3">
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded-sm border border-dashed border-border text-[11px] text-muted-foreground/60 w-28 shrink-0 italic">
                    untagged
                  </span>
                  <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full bg-destructive/40 transition-all"
                      style={{ width: `${Math.round((untagged / total) * 100)}%` }}
                    />
                  </div>
                  <span className="text-[11px] tabular-nums text-muted-foreground w-14 text-right">
                    {untagged} app{untagged !== 1 ? "s" : ""}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="p-4">
          <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-3">
            Tag schema reference
          </div>
          <div className="space-y-2">
            {STRATEGY_SCHEMA.map(({ tag, required, values, description }) => (
              <div key={tag} className="flex items-start gap-2.5">
                <div className="w-24 shrink-0 pt-0.5">
                  <span className="font-mono text-[11px] text-foreground">{tag}</span>
                  {required ? (
                    <span className="ml-1 text-[9px] font-semibold text-red-500 uppercase">
                      req
                    </span>
                  ) : (
                    <span className="ml-1 text-[9px] text-muted-foreground/60 uppercase">opt</span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[10px] text-muted-foreground mb-1">{description}</div>
                  <div className="flex flex-wrap gap-1">
                    {values.map((v) => (
                      <span
                        key={v}
                        className="inline-flex items-center px-1 py-0.5 rounded-sm bg-muted/60 border border-border text-[10px] font-mono text-muted-foreground"
                      >
                        {v}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function CoverageCard({ apps }: { apps: AppSummary[] }) {
  const { data: compliance } = useGetTagCompliance();

  const { coverage, total, unit } = (() => {
    // Prefer live Azure scan coverage when available: it counts tags across every
    // scanned resource, so ServiceType and CostCenter are included correctly.
    if (compliance && compliance.dataSource === "live" && compliance.totalScanned > 0) {
      const tagCoverageByKey = compliance.tagCoverageByKey;
      return {
        coverage: KNOWN_TAGS.map((tag) => {
          const tagged = tagCoverageByKey[tag] ?? 0;
          return {
            tag,
            tagged,
            pct: Math.round((tagged / compliance.totalScanned) * 100),
          };
        }),
        total: compliance.totalScanned,
        unit: "resources",
      };
    }
    // Fallback to app-level records when Azure scan data is not yet available.
    return {
      coverage: KNOWN_TAGS.map((tag) => {
        const tagged = apps.filter((a) => !!getTag(a, tag)).length;
        return { tag, tagged, pct: apps.length > 0 ? Math.round((tagged / apps.length) * 100) : 0 };
      }),
      total: apps.length,
      unit: "apps",
    };
  })();

  return (
    <div className="bg-card border border-border shadow-sm">
      <div className="p-2 border-b border-border flex items-center gap-2">
        <h2 className="text-sm font-semibold px-2">Tag coverage</h2>
        <span className="text-[11px] text-muted-foreground">
          {total} {unit} scanned
        </span>
      </div>
      <div className="p-3 grid grid-cols-6 gap-3">
        {coverage.map(({ tag, tagged, pct }) => (
          <div key={tag} className="space-y-1">
            <div className="text-[11px] font-mono text-muted-foreground">{tag}</div>
            <div className="text-lg font-semibold tabular-nums">{pct}%</div>
            <div className="text-[11px] text-muted-foreground">
              {tagged}/{total} {unit}
            </div>
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
