import { useListSlos } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { PageHeader, StatusPill } from "@/components/page-header";
import { Activity } from "lucide-react";

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

export default function Health() {
  const { data: slos, isLoading } = useListSlos();
  const isEmpty = !isLoading && (slos?.length ?? 0) === 0;

  const meetingUptime = (slos ?? []).filter((s) => s.uptimePct >= 99.9).length;
  const breachingErr = (slos ?? []).filter((s) => s.errorRatePct > s.errorTargetPct).length;
  const breachingLat = (slos ?? []).filter((s) => s.p95LatencyMs > s.p95TargetMs).length;
  const avgBudget = slos?.length
    ? slos.reduce((s, r) => s + r.errorBudgetRemainingPct, 0) / slos.length
    : 0;
  const breachingCpu = (slos ?? []).filter((s) => s.cpuPct >= s.cpuThreshold).length;
  const breachingMem = (slos ?? []).filter((s) => s.memoryPct >= s.memoryThreshold).length;

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
        <div className="p-2 border-b border-border">
          <h2 className="text-sm font-semibold px-2">Per-application SLOs</h2>
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
                return (
                  <TableRow key={s.appId} className="h-8 border-b border-border/50 hover:bg-muted/40">
                    <TableCell className="py-1 font-medium text-primary">{s.appName}</TableCell>
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
                    <TableCell className="py-1"><StatusPill tone={overall as "ok" | "warn" | "bad"}>{overall === "ok" ? "Meeting SLO" : overall === "warn" ? "At risk" : "Breaching"}</StatusPill></TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>
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
