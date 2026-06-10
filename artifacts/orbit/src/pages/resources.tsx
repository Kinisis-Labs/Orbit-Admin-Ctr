import { useMemo } from "react";
import {
  useGetGlobalHealth,
  useListSlos,
  getGetNetworkQueryOptions,
  getGetInfrastructureQueryOptions,
} from "@workspace/api-client-react";
import type { SloRow, NetworkReport, InfrastructureReport, InfrastructureResource } from "@workspace/api-client-react";
import { useApps } from "@/hooks/use-apps";
import { useQueries } from "@tanstack/react-query";
import {
  BarChart, Bar, AreaChart, Area, ResponsiveContainer,
  XAxis, YAxis, Tooltip, CartesianGrid, Cell, ReferenceLine,
} from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import {
  CheckCircle2, AlertTriangle, XCircle, Wifi, Server,
  BarChart2, Activity, ChevronRight, Cloud, Globe,
} from "lucide-react";
import { format } from "date-fns";

// ─── helpers ────────────────────────────────────────────────────────────────

function shortType(raw: string): string {
  return raw.replace(/^microsoft\./i, "").replace(/\//g, " › ");
}

function statusColor(s: string): string {
  if (s === "healthy") return "text-emerald-500";
  if (s === "degraded") return "text-amber-500";
  return "text-red-500";
}

function statusDot(s: string): string {
  if (s === "healthy") return "bg-emerald-500";
  if (s === "degraded") return "bg-amber-400";
  return "bg-red-500";
}

const CHART_COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899"];

function appColor(idx: number) {
  return CHART_COLORS[idx % CHART_COLORS.length]!;
}

// ─── summary tile ────────────────────────────────────────────────────────────

function Tile({ label, value, sub, icon, tone }: {
  label: string;
  value: string | number | null;
  sub?: string;
  icon: React.ReactNode;
  tone?: "ok" | "warn" | "bad" | "neutral";
}) {
  const toneClass = tone === "ok" ? "text-emerald-500"
    : tone === "warn" ? "text-amber-500"
    : tone === "bad" ? "text-red-500"
    : "text-foreground";
  return (
    <div className="bg-card border border-border shadow-sm px-4 py-3 flex items-start gap-3">
      <div className="mt-0.5 text-muted-foreground">{icon}</div>
      <div className="min-w-0">
        <div className={`text-xl font-bold tabular-nums ${toneClass}`}>
          {value === null ? <Skeleton className="h-6 w-12 inline-block" /> : value}
        </div>
        <div className="text-[12px] font-medium text-muted-foreground">{label}</div>
        {sub && <div className="text-[11px] text-muted-foreground/60 mt-0.5">{sub}</div>}
      </div>
    </div>
  );
}

// ─── CPU / Memory section ────────────────────────────────────────────────────

function InfraHealthSection({ slos, loading }: { slos: SloRow[]; loading: boolean }) {
  const cpuData = slos.map((r) => ({
    name: r.appName,
    value: r.cpuPct,
    threshold: r.cpuThreshold,
  }));
  const memData = slos.map((r) => ({
    name: r.appName,
    value: r.memoryPct,
    threshold: r.memoryThreshold,
  }));

  const renderBars = (
    data: { name: string; value: number; threshold: number }[],
    label: string,
  ) => (
    <div className="flex-1 min-w-0">
      <h3 className="text-[12px] font-semibold text-muted-foreground uppercase tracking-wide mb-3">{label}</h3>
      {loading ? (
        <Skeleton className="h-28 w-full" />
      ) : data.length === 0 ? (
        <p className="text-[12px] text-muted-foreground/60">No data</p>
      ) : (
        <ResponsiveContainer width="100%" height={120}>
          <BarChart data={data} margin={{ top: 4, right: 4, left: -24, bottom: 0 }} barSize={28}>
            <CartesianGrid strokeDasharray="2 2" vertical={false} stroke="hsl(var(--border))" />
            <XAxis dataKey="name" fontSize={11} tickLine={false} axisLine={false} stroke="hsl(var(--muted-foreground))" />
            <YAxis domain={[0, 100]} fontSize={11} tickLine={false} axisLine={false} stroke="hsl(var(--muted-foreground))" tickFormatter={(v) => `${v}%`} />
            <Tooltip
              contentStyle={{ backgroundColor: "hsl(var(--card))", borderColor: "hsl(var(--border))", borderRadius: "2px", fontSize: "12px" }}
              formatter={(v: number) => [`${v.toFixed(1)}%`]}
            />
            <Bar dataKey="value" radius={[2, 2, 0, 0]}>
              {data.map((d, i) => (
                <Cell key={i} fill={d.value >= d.threshold ? "#ef4444" : d.value >= d.threshold * 0.85 ? "#f59e0b" : "#10b981"} />
              ))}
            </Bar>
            {data.map((d) => (
              <ReferenceLine key={d.name} y={d.threshold} stroke="#ef4444" strokeDasharray="3 3" strokeOpacity={0.5} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );

  return (
    <div className="bg-card border border-border shadow-sm">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
        <Activity className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-[13px] font-semibold">Infrastructure health</h2>
        <span className="text-[11px] text-muted-foreground/60 ml-1">Current utilisation vs. threshold</span>
      </div>
      <div className="px-4 py-4 flex gap-8">
        {renderBars(cpuData, "CPU %")}
        {renderBars(memData, "Memory %")}
      </div>
      {!loading && slos.length > 0 && (
        <div className="px-4 pb-4">
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-border/50 text-muted-foreground">
                  <th className="text-left py-2 pr-4 font-medium">App</th>
                  <th className="text-right py-2 pr-4 font-medium">Uptime</th>
                  <th className="text-right py-2 pr-4 font-medium">Error budget</th>
                  <th className="text-right py-2 pr-4 font-medium">P95 latency</th>
                  <th className="text-right py-2 pr-4 font-medium">Error rate</th>
                  <th className="text-right py-2 font-medium">SLO</th>
                </tr>
              </thead>
              <tbody>
                {slos.map((r) => {
                  const cpuOk = r.cpuPct < r.cpuThreshold;
                  const memOk = r.memoryPct < r.memoryThreshold;
                  const sloMet = r.uptimePct >= 99.9 && r.errorBudgetRemainingPct > 0 && r.p95LatencyMs < r.p95TargetMs && r.errorRatePct < r.errorTargetPct;
                  const meeting = sloMet && cpuOk && memOk;
                  return (
                    <tr key={r.appId} className="border-b border-border/30 last:border-0 hover:bg-muted/20 transition-colors">
                      <td className="py-2 pr-4">
                        <Link href={`/apps/${r.appId}`} className="font-medium text-primary hover:underline">
                          {r.appName}
                        </Link>
                      </td>
                      <td className="py-2 pr-4 text-right tabular-nums">{r.uptimePct.toFixed(1)}%</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{r.errorBudgetRemainingPct.toFixed(0)}%</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{r.p95LatencyMs < 1 ? "~0ms" : `~${Math.round(r.p95LatencyMs)}ms`}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{r.errorRatePct.toFixed(1)}%</td>
                      <td className="py-2 text-right">
                        <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm border text-[10px] font-semibold ${meeting ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "border-red-500/40 bg-red-500/10 text-red-500"}`}>
                          {meeting ? <CheckCircle2 className="h-2.5 w-2.5" /> : <XCircle className="h-2.5 w-2.5" />}
                          {meeting ? "Meeting" : "Breaching"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── CPU sparklines ──────────────────────────────────────────────────────────

function SparklineSection({ slos, loading }: { slos: SloRow[]; loading: boolean }) {
  const hasSeries = slos.some((r) => (r.cpuSeries?.length ?? 0) > 0 || (r.memorySeries?.length ?? 0) > 0);

  if (loading) return <Skeleton className="h-48 w-full" />;
  if (!hasSeries) return null;

  return (
    <div className="bg-card border border-border shadow-sm">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
        <BarChart2 className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-[13px] font-semibold">24-hour utilisation trends</h2>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-0 divide-y md:divide-y-0 md:divide-x divide-border">
        {["CPU %", "Memory %"].map((metric) => (
          <div key={metric} className="px-4 py-4">
            <h3 className="text-[12px] font-semibold text-muted-foreground mb-3">{metric} — last 24 h</h3>
            <div className="space-y-3">
              {slos.filter((r) => metric === "CPU %" ? (r.cpuSeries?.length ?? 0) > 0 : (r.memorySeries?.length ?? 0) > 0).map((r, idx) => {
                const points = metric === "CPU %" ? r.cpuSeries ?? [] : r.memorySeries ?? [];
                const color = appColor(idx);
                return (
                  <div key={r.appId}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[11px] font-medium" style={{ color }}>{r.appName}</span>
                      <span className="text-[11px] tabular-nums text-muted-foreground">
                        {points.length > 0 ? `${points[points.length - 1]!.value.toFixed(1)}%` : "—"}
                      </span>
                    </div>
                    <ResponsiveContainer width="100%" height={50}>
                      <AreaChart data={points} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
                        <defs>
                          <linearGradient id={`grad-${r.appId}-${metric}`} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor={color} stopOpacity={0.3} />
                            <stop offset="95%" stopColor={color} stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <XAxis dataKey="timestamp" hide />
                        <YAxis domain={[0, 100]} hide />
                        <Tooltip
                          contentStyle={{ backgroundColor: "hsl(var(--card))", borderColor: "hsl(var(--border))", fontSize: "11px", borderRadius: "2px" }}
                          labelFormatter={(v) => { try { return format(new Date(v as string), "HH:mm"); } catch { return v as string; } }}
                          formatter={(v: number) => [`${v.toFixed(1)}%`]}
                        />
                        <Area type="monotone" dataKey="value" stroke={color} strokeWidth={1.5} fill={`url(#grad-${r.appId}-${metric})`} dot={false} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Network health section ──────────────────────────────────────────────────

function NetworkSection({
  apps,
  networkResults,
  loading,
}: {
  apps: { id: string; name: string }[];
  networkResults: (NetworkReport | undefined)[];
  loading: boolean;
}) {
  const rows = apps.map((app, i) => ({
    app,
    report: networkResults[i],
  }));

  const allEndpoints = rows.flatMap(({ app, report }) =>
    (report?.endpoints ?? []).map((ep) => ({ ...ep, appId: app.id, appName: app.name }))
  );

  const latencyData = allEndpoints.map((ep) => ({
    name: ep.name,
    latency: ep.latencyMs,
    appName: ep.appName,
    status: ep.status,
  }));

  const yAxisWidth = Math.min(
    240,
    Math.max(140, ...latencyData.map((d) => d.name.length * 7)),
  );

  return (
    <div className="bg-card border border-border shadow-sm">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
        <Wifi className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-[13px] font-semibold">Network health</h2>
        <span className="text-[11px] text-muted-foreground/60 ml-1">Endpoint status across all apps</span>
      </div>

      {loading ? (
        <div className="p-4 space-y-2"><Skeleton className="h-6 w-full" /><Skeleton className="h-6 w-full" /></div>
      ) : allEndpoints.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
          <Wifi className="h-7 w-7 text-muted-foreground/30" strokeWidth={1.5} />
          <p className="text-[12px] text-muted-foreground/60">No endpoint data available</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-0 divide-y lg:divide-y-0 lg:divide-x divide-border">
          {/* latency bar chart */}
          <div className="px-4 py-4">
            <h3 className="text-[12px] font-semibold text-muted-foreground mb-3">Endpoint latency (ms)</h3>
            <ResponsiveContainer width="100%" height={Math.max(80, allEndpoints.length * 28)}>
              <BarChart data={latencyData} layout="vertical" margin={{ top: 0, right: 8, left: 0, bottom: 0 }} barSize={14}>
                <CartesianGrid strokeDasharray="2 2" horizontal={false} stroke="hsl(var(--border))" />
                <XAxis type="number" fontSize={11} tickLine={false} axisLine={false} stroke="hsl(var(--muted-foreground))" tickFormatter={(v) => `${v}ms`} />
                <YAxis type="category" dataKey="name" fontSize={11} tickLine={false} axisLine={false} stroke="hsl(var(--muted-foreground))" width={yAxisWidth} />
                <Tooltip
                  contentStyle={{ backgroundColor: "hsl(var(--card))", borderColor: "hsl(var(--border))", borderRadius: "2px", fontSize: "12px" }}
                  formatter={(v: number) => [`${v} ms`, "Latency"]}
                />
                <Bar dataKey="latency" radius={[0, 2, 2, 0]}>
                  {latencyData.map((d, i) => (
                    <Cell key={i} fill={d.status === "healthy" ? "#10b981" : d.status === "degraded" ? "#f59e0b" : "#ef4444"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* endpoint status table */}
          <div className="px-4 py-4">
            <h3 className="text-[12px] font-semibold text-muted-foreground mb-3">Endpoint status</h3>
            <div className="space-y-1">
              {allEndpoints.map((ep, i) => (
                <div key={i} className="flex items-center justify-between py-1.5 border-b border-border/30 last:border-0">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <div className={`h-1.5 w-1.5 rounded-full shrink-0 ${statusDot(ep.status)}`} />
                      <span className="text-[12px] font-medium truncate">{ep.name}</span>
                    </div>
                    <span className="text-[10px] text-muted-foreground/60 ml-3">{ep.appName} · {ep.region}</span>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-[11px] tabular-nums text-muted-foreground">{ep.latencyMs} ms</span>
                    <span className={`text-[10px] font-semibold ${statusColor(ep.status)}`}>{ep.status}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Resource inventory section ──────────────────────────────────────────────

function ResourceInventorySection({
  apps,
  infraResults,
  loading,
}: {
  apps: { id: string; name: string }[];
  infraResults: (InfrastructureReport | undefined)[];
  loading: boolean;
}) {
  const allResources = useMemo<(InfrastructureResource & { appName: string })[]>(() => {
    return apps.flatMap((app, i) =>
      (infraResults[i]?.resources ?? []).map((r) => ({ ...r, appName: app.name }))
    );
  }, [apps, infraResults]);

  const typeBreakdown = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of allResources) {
      const t = shortType(r.type);
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([type, count]) => ({ type, count }));
  }, [allResources]);

  const statusCounts = useMemo(() => {
    let ok = 0, warn = 0, bad = 0;
    for (const r of allResources) {
      if (r.status === "healthy") ok++;
      else if (r.status === "degraded") warn++;
      else bad++;
    }
    return { ok, warn, bad };
  }, [allResources]);

  return (
    <div className="bg-card border border-border shadow-sm">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
        <Server className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-[13px] font-semibold">Resource inventory</h2>
        {!loading && allResources.length > 0 && (
          <span className="text-[11px] text-muted-foreground/60 ml-1">
            {allResources.length} resources across {apps.length} apps
          </span>
        )}
      </div>

      {loading ? (
        <div className="p-4 space-y-2"><Skeleton className="h-6 w-full" /><Skeleton className="h-6 w-full" /></div>
      ) : allResources.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
          <Cloud className="h-7 w-7 text-muted-foreground/30" strokeWidth={1.5} />
          <p className="text-[12px] text-muted-foreground/60">No resource data available</p>
          <p className="text-[11px] text-muted-foreground/40">Configure AZURE_SUBSCRIPTION_IDS to enable live resource inventory</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-0 divide-y lg:divide-y-0 lg:divide-x divide-border">
          {/* type breakdown chart */}
          <div className="px-4 py-4">
            <h3 className="text-[12px] font-semibold text-muted-foreground mb-3">By resource type</h3>
            <ResponsiveContainer width="100%" height={Math.max(120, typeBreakdown.length * 26)}>
              <BarChart data={typeBreakdown} layout="vertical" margin={{ top: 0, right: 8, left: 0, bottom: 0 }} barSize={14}>
                <CartesianGrid strokeDasharray="2 2" horizontal={false} stroke="hsl(var(--border))" />
                <XAxis type="number" allowDecimals={false} fontSize={11} tickLine={false} axisLine={false} stroke="hsl(var(--muted-foreground))" />
                <YAxis type="category" dataKey="type" fontSize={10} tickLine={false} axisLine={false} stroke="hsl(var(--muted-foreground))" width={160} />
                <Tooltip
                  contentStyle={{ backgroundColor: "hsl(var(--card))", borderColor: "hsl(var(--border))", borderRadius: "2px", fontSize: "12px" }}
                  formatter={(v: number) => [v, "Resources"]}
                />
                <Bar dataKey="count" fill="#3b82f6" radius={[0, 2, 2, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* status + per-app counts */}
          <div className="px-4 py-4 flex flex-col gap-4">
            <div>
              <h3 className="text-[12px] font-semibold text-muted-foreground mb-3">Health status</h3>
              <div className="flex gap-4">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                  <span className="text-[13px] font-semibold">{statusCounts.ok}</span>
                  <span className="text-[11px] text-muted-foreground">Operational</span>
                </div>
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-500" />
                  <span className="text-[13px] font-semibold">{statusCounts.warn}</span>
                  <span className="text-[11px] text-muted-foreground">Degraded</span>
                </div>
                <div className="flex items-center gap-2">
                  <XCircle className="h-4 w-4 text-red-500" />
                  <span className="text-[13px] font-semibold">{statusCounts.bad}</span>
                  <span className="text-[11px] text-muted-foreground">Unhealthy</span>
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-[12px] font-semibold text-muted-foreground mb-2">Resources per app</h3>
              <div className="space-y-2">
                {apps.map((app, i) => {
                  const count = infraResults[i]?.resources.length ?? 0;
                  return (
                    <div key={app.id} className="flex items-center gap-2">
                      <Link href={`/apps/${app.id}`} className="text-[12px] text-primary hover:underline min-w-[100px]">
                        {app.name}
                      </Link>
                      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full bg-blue-500"
                          style={{ width: allResources.length > 0 ? `${(count / allResources.length) * 100}%` : "0%" }}
                        />
                      </div>
                      <span className="text-[11px] tabular-nums text-muted-foreground w-8 text-right">{count}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div>
              <h3 className="text-[12px] font-semibold text-muted-foreground mb-2">By region</h3>
              <div className="space-y-1">
                {(() => {
                  const regions = new Map<string, number>();
                  for (const r of allResources) {
                    regions.set(r.location, (regions.get(r.location) ?? 0) + 1);
                  }
                  return [...regions.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([region, count]) => (
                    <div key={region} className="flex items-center gap-2 text-[11px]">
                      <Globe className="h-3 w-3 text-muted-foreground/60 shrink-0" />
                      <span className="text-muted-foreground flex-1">{region}</span>
                      <span className="tabular-nums font-medium">{count}</span>
                    </div>
                  ));
                })()}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── main page ───────────────────────────────────────────────────────────────

export default function ResourcesPage() {
  const { data: apps } = useApps();
  const appList = apps ?? [];

  const { data: globalHealth, isLoading: globalLoading } = useGetGlobalHealth();
  const { data: slosData, isLoading: slosLoading } = useListSlos();
  const slos = slosData?.rows ?? [];

  const infraQueries = useQueries({
    queries: appList.map((app) => getGetInfrastructureQueryOptions(app.id)),
  });

  const networkQueries = useQueries({
    queries: appList.map((app) => getGetNetworkQueryOptions(app.id)),
  });

  const infraLoading = infraQueries.some((q) => q.isLoading);
  const networkLoading = networkQueries.some((q) => q.isLoading);
  const infraResults = infraQueries.map((q) => q.data as InfrastructureReport | undefined);
  const networkResults = networkQueries.map((q) => q.data as NetworkReport | undefined);

  const alertTone = globalHealth && globalHealth.activeAlerts > 0 ? "bad" : "ok";

  return (
    <div className="p-6 space-y-6 max-w-[1400px]">
      {/* breadcrumb */}
      <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
        <span>Resources</span>
        <ChevronRight className="h-3.5 w-3.5" />
        <span className="text-foreground font-medium">All resources</span>
      </div>

      <div>
        <h1 className="text-2xl font-bold tracking-tight">All resources</h1>
        <p className="text-sm text-muted-foreground mt-1">Cross-app infrastructure, network, and resource health overview</p>
      </div>

      {/* summary tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile
          icon={<Server className="h-4 w-4" />}
          label="Total apps"
          value={globalLoading ? null : (globalHealth?.totalApps ?? appList.length)}
        />
        <Tile
          icon={<CheckCircle2 className="h-4 w-4" />}
          label="Healthy"
          value={globalLoading ? null : (globalHealth?.healthy ?? "—")}
          tone={globalHealth && globalHealth.healthy === globalHealth.totalApps ? "ok" : "warn"}
        />
        <Tile
          icon={<AlertTriangle className="h-4 w-4" />}
          label="Active alerts"
          value={globalLoading ? null : (globalHealth?.activeAlerts ?? "—")}
          tone={alertTone}
        />
        <Tile
          icon={<Activity className="h-4 w-4" />}
          label="Avg CPU"
          value={slosLoading ? null : slos.length > 0 ? `${(slos.reduce((s, r) => s + r.cpuPct, 0) / slos.length).toFixed(1)}%` : "—"}
          tone={slos.length > 0 && slos.some((r) => r.cpuPct >= r.cpuThreshold) ? "bad" : "ok"}
        />
      </div>

      {/* infrastructure health + SLO table */}
      <InfraHealthSection slos={slos} loading={slosLoading} />

      {/* 24h sparklines if data is available */}
      <SparklineSection slos={slos} loading={slosLoading} />

      {/* network health */}
      <NetworkSection apps={appList} networkResults={networkResults} loading={networkLoading} />

      {/* resource inventory */}
      <ResourceInventorySection apps={appList} infraResults={infraResults} loading={infraLoading} />
    </div>
  );
}
