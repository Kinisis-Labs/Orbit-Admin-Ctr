import { useState, Fragment } from "react";
import { Link } from "wouter";
import {
  useListSlos,
  useListApps,
  useGetAppThresholds,
  useUpdateAppThresholds,
  getListSlosQueryKey,
} from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { PageHeader, StatusPill } from "@/components/page-header";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Activity, Settings2, ChevronDown, ChevronRight, Check, Loader2, ExternalLink, Wifi } from "lucide-react";
import {
  AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { format } from "date-fns";
import { useAuth, ADMIN_GROUP } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";

function DataSourceBadge({ dataSource }: { dataSource: "live" | "mock" | undefined }) {
  if (dataSource === "live") {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm border border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[10px] font-semibold uppercase tracking-wide select-none">
        <Wifi className="h-3 w-3" />
        Live — Azure Monitor
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm border border-border bg-muted text-muted-foreground text-[10px] font-semibold uppercase tracking-wide select-none">
      Demo data
    </span>
  );
}

type InfraTone = "ok" | "warn" | "bad";

function infraTone(pct: number, threshold: number): InfraTone {
  if (pct >= threshold) return "bad";
  if (pct >= threshold * 0.85) return "warn";
  return "ok";
}

function InfraBadge({ pct, threshold }: { pct: number; threshold: number }) {
  const tone = infraTone(pct, threshold);
  const label = tone === "bad" ? "Breach" : tone === "warn" ? "Warn" : "OK";
  return (
    <div className="flex items-center gap-2">
      <span className={`tabular-nums ${tone === "bad" ? "text-destructive font-medium" : tone === "warn" ? "text-yellow-600 font-medium" : ""}`}>
        {pct.toFixed(1)}%
      </span>
      <StatusPill tone={tone}>{label}</StatusPill>
    </div>
  );
}

type MetricPoint = { timestamp: string; value: number };

function TrendSparkline({
  appId,
  cpuSeries,
  memorySeries,
  cpuThreshold,
  memoryThreshold,
}: {
  appId: string;
  cpuSeries: MetricPoint[];
  memorySeries: MetricPoint[];
  cpuThreshold: number;
  memoryThreshold: number;
}) {
  return (
    <div className="bg-muted/30 border-t border-border/50">
      <div className="flex justify-end px-4 pt-2">
        <Link
          href={`/apps/${appId}?tab=infrastructure`}
          onClick={(e: React.MouseEvent) => e.stopPropagation()}
          className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
        >
          <ExternalLink className="h-3 w-3" />
          View infrastructure
        </Link>
      </div>
      <div className="grid grid-cols-2 gap-4 px-4 py-3">
      <div>
        <div className="text-[11px] font-semibold text-muted-foreground mb-1.5">
          CPU % — last 24h
          <span className="ml-1.5 text-[10px] font-normal opacity-60">threshold {cpuThreshold}%</span>
        </div>
        <div className="h-20">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={cpuSeries} margin={{ top: 2, right: 0, left: -28, bottom: 0 }}>
              <CartesianGrid strokeDasharray="2 2" vertical={false} stroke="hsl(var(--border))" />
              <XAxis
                dataKey="timestamp"
                tickFormatter={(v) => format(new Date(v), "HH:mm")}
                stroke="hsl(var(--muted-foreground))"
                fontSize={10}
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                stroke="hsl(var(--muted-foreground))"
                fontSize={10}
                tickLine={false}
                axisLine={false}
                domain={[0, 100]}
                tickFormatter={(v) => `${v}%`}
              />
              <Tooltip
                contentStyle={{ backgroundColor: "hsl(var(--card))", borderColor: "hsl(var(--border))", borderRadius: "2px", fontSize: "11px" }}
                labelFormatter={(v) => format(new Date(v), "HH:mm")}
                formatter={(v: number) => [`${v.toFixed(1)}%`, "CPU"]}
              />
              <Area
                type="step"
                dataKey="value"
                stroke="hsl(var(--primary))"
                strokeWidth={1.5}
                fillOpacity={0.1}
                fill="hsl(var(--primary))"
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div>
        <div className="text-[11px] font-semibold text-muted-foreground mb-1.5">
          Memory % — last 24h
          <span className="ml-1.5 text-[10px] font-normal opacity-60">threshold {memoryThreshold}%</span>
        </div>
        <div className="h-20">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={memorySeries} margin={{ top: 2, right: 0, left: -28, bottom: 0 }}>
              <CartesianGrid strokeDasharray="2 2" vertical={false} stroke="hsl(var(--border))" />
              <XAxis
                dataKey="timestamp"
                tickFormatter={(v) => format(new Date(v), "HH:mm")}
                stroke="hsl(var(--muted-foreground))"
                fontSize={10}
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                stroke="hsl(var(--muted-foreground))"
                fontSize={10}
                tickLine={false}
                axisLine={false}
                domain={[0, 100]}
                tickFormatter={(v) => `${v}%`}
              />
              <Tooltip
                contentStyle={{ backgroundColor: "hsl(var(--card))", borderColor: "hsl(var(--border))", borderRadius: "2px", fontSize: "11px" }}
                labelFormatter={(v) => format(new Date(v), "HH:mm")}
                formatter={(v: number) => [`${v.toFixed(1)}%`, "Memory"]}
              />
              <Area
                type="step"
                dataKey="value"
                stroke="hsl(var(--chart-2))"
                strokeWidth={1.5}
                fillOpacity={0.1}
                fill="hsl(var(--chart-2))"
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
      </div>
    </div>
  );
}

// --- Engineer group definition (mirrors orbitGroups.ts client-facing id) ---
const ENGINEER_GROUP = {
  id: "orbit-engineers",
  displayName: "Orbit-Engineers",
  description: "Operational actions on Kinisis applications.",
};

// --- Per-app threshold row (GET + optimistic PUT) ---
function ThresholdRow({ appId, appName }: { appId: string; appName: string }) {
  const { data, isLoading } = useGetAppThresholds(appId);
  const { mutateAsync, isPending } = useUpdateAppThresholds();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [cpu, setCpu] = useState<string>("");
  const [mem, setMem] = useState<string>("");
  const [saved, setSaved] = useState(false);

  const effective = {
    cpu: cpu !== "" ? cpu : data ? String(data.cpuThreshold) : "",
    mem: mem !== "" ? mem : data ? String(data.memoryThreshold) : "",
  };

  const handleSave = async () => {
    const cpuVal = parseFloat(effective.cpu);
    const memVal = parseFloat(effective.mem);
    if (!Number.isFinite(cpuVal) || cpuVal < 1 || cpuVal > 100) {
      toast({ title: "Invalid CPU threshold", description: "Must be between 1 and 100.", variant: "destructive" });
      return;
    }
    if (!Number.isFinite(memVal) || memVal < 1 || memVal > 100) {
      toast({ title: "Invalid memory threshold", description: "Must be between 1 and 100.", variant: "destructive" });
      return;
    }
    await mutateAsync(
      { appId, data: { cpuThreshold: cpuVal, memoryThreshold: memVal } },
      {
        onSuccess: () => {
          void queryClient.invalidateQueries({ queryKey: getListSlosQueryKey() });
          setSaved(true);
          setTimeout(() => setSaved(false), 2000);
          setCpu("");
          setMem("");
        },
        onError: () => {
          toast({ title: "Save failed", description: "Check your permissions.", variant: "destructive" });
        },
      },
    );
  };

  const dirty = cpu !== "" || mem !== "";

  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3 border-b border-border last:border-b-0">
      <div className="text-[13px] text-foreground min-w-[120px]">{appName}</div>
      {isLoading ? (
        <div className="flex gap-4 flex-1 justify-end"><Skeleton className="h-7 w-[80px]" /><Skeleton className="h-7 w-[80px]" /></div>
      ) : (
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1.5">
            <span className="text-[12px] text-muted-foreground w-[50px]">CPU</span>
            <Input
              type="number"
              min={1}
              max={100}
              placeholder={data ? String(data.cpuThreshold) : "80"}
              value={cpu}
              onChange={(e) => { setCpu(e.target.value); setSaved(false); }}
              className="h-7 w-[70px] rounded-sm text-[13px] text-right"
            />
            <span className="text-[12px] text-muted-foreground">%</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[12px] text-muted-foreground w-[60px]">Memory</span>
            <Input
              type="number"
              min={1}
              max={100}
              placeholder={data ? String(data.memoryThreshold) : "85"}
              value={mem}
              onChange={(e) => { setMem(e.target.value); setSaved(false); }}
              className="h-7 w-[70px] rounded-sm text-[13px] text-right"
            />
            <span className="text-[12px] text-muted-foreground">%</span>
          </div>
          <Button
            size="sm"
            variant={saved ? "default" : "outline"}
            className="h-7 rounded-sm text-[12px] min-w-[64px]"
            disabled={!dirty || isPending}
            onClick={() => void handleSave()}
          >
            {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : saved ? <><Check className="h-3 w-3 mr-1" />Saved</> : "Save"}
          </Button>
        </div>
      )}
    </div>
  );
}

// --- Threshold settings panel (collapsed by default) ---
function ThresholdSettings() {
  const { data: apps } = useListApps();
  const [open, setOpen] = useState(false);

  return (
    <div className="bg-card border border-border shadow-sm">
      <button
        type="button"
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-muted/40 transition-colors"
        onClick={() => setOpen((v) => !v)}
      >
        <div className="flex items-center gap-2">
          <Settings2 className="h-4 w-4 text-muted-foreground" />
          <span className="text-[13px] font-semibold text-foreground">Alert threshold settings</span>
          <span className="text-[11px] text-muted-foreground ml-1">— Orbit-Admins / Orbit-Engineers only</span>
        </div>
        {open ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
      </button>
      {open && (
        <div className="border-t border-border">
          <div className="px-4 py-3 border-b border-border bg-muted/20">
            <p className="text-[12px] text-muted-foreground">
              Set per-app CPU and memory thresholds. Changes persist to the database and are
              reflected immediately in the SLO badges above. Leave a field blank to keep the
              current value. Defaults: CPU 80%, Memory 85%.
            </p>
          </div>
          {(apps ?? []).map((app) => (
            <ThresholdRow key={app.id} appId={app.id} appName={app.name} />
          ))}
          {!apps && (
            <div className="p-4 space-y-2">
              <Skeleton className="h-8" />
              <Skeleton className="h-8" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function Health() {
  const { data, isLoading } = useListSlos();
  const slos = data?.rows;
  const dataSource = data?.dataSource;
  const { hasGroup } = useAuth();
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  const isEmpty = !isLoading && (slos?.length ?? 0) === 0;

  const canEditThresholds = hasGroup(ADMIN_GROUP.id) || hasGroup(ENGINEER_GROUP.id);

  const meetingUptime = (slos ?? []).filter((s) => s.uptimePct >= 99.9).length;
  const breachingErr = (slos ?? []).filter((s) => s.errorRatePct > s.errorTargetPct).length;
  const breachingLat = (slos ?? []).filter((s) => s.p95LatencyMs > s.p95TargetMs).length;
  const avgBudget = slos?.length
    ? slos.reduce((s, r) => s + r.errorBudgetRemainingPct, 0) / slos.length
    : 0;
  const breachingCpu = (slos ?? []).filter((s) => s.cpuPct >= s.cpuThreshold).length;
  const breachingMem = (slos ?? []).filter((s) => s.memoryPct >= s.memoryThreshold).length;

  function toggleRow(appId: string) {
    setExpandedRow((prev) => (prev === appId ? null : appId));
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Health & SLOs" subtitle="Service-level objectives and error budget burn across all applications" />

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
        <Tile title="Meeting 99.9% uptime" value={isLoading ? null : `${meetingUptime} / ${slos?.length ?? 0}`} sub="Across tracked applications" />
        <Tile title="Avg error budget left" value={isLoading ? null : `${avgBudget.toFixed(1)}%`} sub="Rolling 30-day window" />
        <Tile title="Breaching P95 latency" value={isLoading ? null : breachingLat.toString()} sub="Target: <500ms" />
        <Tile title="Breaching error rate" value={isLoading ? null : breachingErr.toString()} sub="Target: <1%" />
        <Tile title="CPU pressure" value={isLoading ? null : breachingCpu.toString()} sub="At or above 80% threshold" />
        <Tile title="Memory pressure" value={isLoading ? null : breachingMem.toString()} sub="At or above 85% threshold" />
      </div>

      <div className="bg-card border border-border shadow-sm">
        <div className="p-2 border-b border-border flex items-center justify-between">
          <h2 className="text-sm font-semibold px-2">Per-application SLOs</h2>
          {!isLoading && <div className="pr-2"><DataSourceBadge dataSource={dataSource} /></div>}
        </div>
        {isLoading ? (
          <div className="p-4 space-y-2"><Skeleton className="h-8" /><Skeleton className="h-8" /></div>
        ) : isEmpty ? (
          <div className="p-8 text-center space-y-3">
            <Activity className="h-8 w-8 mx-auto text-muted-foreground/40" />
            <div className="text-[14px] font-semibold text-foreground">SLO data not available</div>
            <div className="text-[12px] text-muted-foreground max-w-md mx-auto">
              SLO metrics are derived from Azure Monitor. Set{" "}
              <code className="bg-muted px-1 rounded">AZURE_SUBSCRIPTION_IDS</code>,{" "}
              <code className="bg-muted px-1 rounded">AZURE_CLIENT_ID</code>, and{" "}
              <code className="bg-muted px-1 rounded">AZURE_TENANT_ID</code> to enable live SLO tracking.
            </div>
          </div>
        ) : (
          <Table className="text-[13px]">
            <TableHeader className="bg-muted/50 hover:bg-muted/50 border-b border-border">
              <TableRow className="hover:bg-transparent">
                <TableHead className="h-8 w-8" />
                <TableHead className="h-8 font-semibold text-foreground">Application</TableHead>
                <TableHead className="h-8 font-semibold text-foreground">Env</TableHead>
                <TableHead className="h-8 font-semibold text-foreground text-right">Uptime</TableHead>
                <TableHead className="h-8 font-semibold text-foreground">Error budget remaining</TableHead>
                <TableHead className="h-8 font-semibold text-foreground text-right">P95 latency</TableHead>
                <TableHead className="h-8 font-semibold text-foreground text-right">Error rate</TableHead>
                <TableHead className="h-8 font-semibold text-foreground">CPU</TableHead>
                <TableHead className="h-8 font-semibold text-foreground">Memory</TableHead>
                <TableHead className="h-8 font-semibold text-foreground">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(slos ?? []).map((s) => {
                const latencyOk = s.p95LatencyMs <= s.p95TargetMs;
                const errOk = s.errorRatePct <= s.errorTargetPct;
                const cpuOk = infraTone(s.cpuPct, s.cpuThreshold) === "ok";
                const memOk = infraTone(s.memoryPct, s.memoryThreshold) === "ok";
                const overall = latencyOk && errOk && cpuOk && memOk && s.uptimePct >= 99.9
                  ? "ok"
                  : latencyOk && errOk && s.uptimePct >= 99.9
                    ? "warn"
                    : "bad";
                const isExpanded = expandedRow === s.appId;
                const hasSeries = (s.cpuSeries?.length ?? 0) > 0 || (s.memorySeries?.length ?? 0) > 0;
                return (
                  <Fragment key={s.appId}>
                    <TableRow
                      className={`h-8 border-b border-border/50 hover:bg-muted/40 ${hasSeries ? "cursor-pointer" : ""}`}
                      onClick={() => hasSeries && toggleRow(s.appId)}
                    >
                      <TableCell className="py-1 pl-3 pr-0 w-8">
                        {hasSeries ? (
                          isExpanded
                            ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                            : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                        ) : null}
                      </TableCell>
                      <TableCell className="py-1 font-medium">
                        <Link
                          href={`/apps/${s.appId}?tab=infrastructure`}
                          onClick={(e: React.MouseEvent) => e.stopPropagation()}
                          className="text-primary hover:underline"
                        >
                          {s.appName}
                        </Link>
                      </TableCell>
                      <TableCell className="py-1 text-muted-foreground">{s.environment}</TableCell>
                      <TableCell className="py-1 text-right tabular-nums">{s.uptimePct}%</TableCell>
                      <TableCell className="py-1">
                        <div className="flex items-center gap-2">
                          <Progress value={s.errorBudgetRemainingPct} className="h-1.5 rounded-none bg-muted w-32" />
                          <span className="text-[11px] tabular-nums text-muted-foreground w-10">{s.errorBudgetRemainingPct}%</span>
                        </div>
                      </TableCell>
                      <TableCell className={`py-1 text-right tabular-nums ${latencyOk ? "" : "text-destructive font-medium"}`}>{s.p95LatencyMs}ms</TableCell>
                      <TableCell className={`py-1 text-right tabular-nums ${errOk ? "" : "text-destructive font-medium"}`}>{s.errorRatePct}%</TableCell>
                      <TableCell className="py-1"><InfraBadge pct={s.cpuPct} threshold={s.cpuThreshold} /></TableCell>
                      <TableCell className="py-1"><InfraBadge pct={s.memoryPct} threshold={s.memoryThreshold} /></TableCell>
                      <TableCell className="py-1">
                        <Link
                          href={`/apps/${s.appId}?tab=infrastructure`}
                          onClick={(e: React.MouseEvent) => e.stopPropagation()}
                        >
                          <StatusPill tone={overall as "ok" | "warn" | "bad"}>{overall === "ok" ? "Meeting SLO" : overall === "warn" ? "At risk" : "Breaching"}</StatusPill>
                        </Link>
                      </TableCell>
                    </TableRow>
                    {isExpanded && hasSeries && (
                      <tr className="border-b border-border/50">
                        <td colSpan={10} className="p-0">
                          <TrendSparkline
                            appId={s.appId}
                            cpuSeries={(s.cpuSeries ?? []) as MetricPoint[]}
                            memorySeries={(s.memorySeries ?? []) as MetricPoint[]}
                            cpuThreshold={s.cpuThreshold}
                            memoryThreshold={s.memoryThreshold}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>

      {canEditThresholds && <ThresholdSettings />}
    </div>
  );
}

function Tile({ title, value, sub }: { title: string; value: string | null; sub: string }) {
  return (
    <div className="bg-card border border-border p-3 shadow-sm flex flex-col justify-between">
      <div className="text-[12px] text-muted-foreground font-medium mb-1">{title}</div>
      {value === null ? <Skeleton className="h-7 w-20 mb-1" /> : <div className="text-xl font-semibold tabular-nums mb-1">{value}</div>}
      <div className="text-[11px] text-muted-foreground truncate">{sub}</div>
    </div>
  );
}
