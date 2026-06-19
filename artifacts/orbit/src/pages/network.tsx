import { useMemo } from "react";
import { useListGlobalEndpoints } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader, StatusPill } from "@/components/page-header";
import { DataSourceBadge } from "@/components/data-source-badge";
import { RefreshingBar } from "@/components/refreshing-bar";
import { Network, AlertTriangle, CheckCircle2, ChevronDown, ChevronUp } from "lucide-react";
import type { GlobalEndpointRow } from "@workspace/api-client-react";
import { useState } from "react";
import {
  PieChart, Pie, Cell,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ReferenceLine,
} from "recharts";

type EndpointStatus = GlobalEndpointRow["status"];

const TONE: Record<EndpointStatus, "ok" | "warn" | "bad" | "muted"> = {
  healthy: "ok",
  degraded: "warn",
  unhealthy: "bad",
  unknown: "muted",
};

const STATUS_COLOR: Record<EndpointStatus, string> = {
  healthy: "#8b5cf6",
  degraded: "#eab308",
  unhealthy: "#ef4444",
  unknown: "#c4b5fd",
};

const STATUS_ORDER: EndpointStatus[] = ["unhealthy", "degraded", "unknown", "healthy"];

export default function NetworkPage() {
  const { data, isLoading, isFetching } = useListGlobalEndpoints();
  const eps = useMemo(() => data?.endpoints ?? [], [data]);
  const isEmpty = !isLoading && eps.length === 0;

  const unhealthy = useMemo(() => eps.filter((e) => e.status === "unhealthy").length, [eps]);
  const degraded = useMemo(() => eps.filter((e) => e.status === "degraded").length, [eps]);
  const healthy = useMemo(() => eps.filter((e) => e.status === "healthy").length, [eps]);
  const unknown = useMemo(() => eps.filter((e) => e.status === "unknown").length, [eps]);
  const avgLatency = useMemo(() =>
    eps.length ? Math.round(eps.reduce((s, e) => s + e.latencyMs, 0) / eps.length) : 0,
    [eps],
  );

  const dataSource = data?.dataSource === "none" ? undefined : data?.dataSource;
  const dataAsOf = data?.dataAsOf;

  // Status donut data
  const statusPie = useMemo(() =>
    (["unhealthy", "degraded", "unknown", "healthy"] as EndpointStatus[])
      .map((s) => ({ name: s, value: eps.filter((e) => e.status === s).length }))
      .filter((d) => d.value > 0),
    [eps],
  );

  // Latency bar data — sorted descending, capped label
  const latencyData = useMemo(() =>
    [...eps]
      .sort((a, b) => b.latencyMs - a.latencyMs)
      .map((e) => ({
        label: e.name.length > 22 ? e.name.slice(0, 20) + "…" : e.name,
        latency: e.latencyMs,
        fill: STATUS_COLOR[e.status],
        status: e.status,
      })),
    [eps],
  );

  // Packet loss bar data — sorted descending
  const lossData = useMemo(() =>
    [...eps]
      .sort((a, b) => b.packetLossPercent - a.packetLossPercent)
      .map((e) => ({
        label: e.name.length > 22 ? e.name.slice(0, 20) + "…" : e.name,
        loss: e.packetLossPercent,
        fill: e.packetLossPercent > 0.5 ? "#ef4444" : e.packetLossPercent > 0.1 ? "#f59e0b" : "#10b981",
      })),
    [eps],
  );

  // Per-app breakdown
  const appBreakdown = useMemo(() => {
    type AppRec = { appId: string; appName: string; total: number; unhealthy: number; degraded: number; healthy: number; unknown: number; maxLatency: number; avgLatency: number };
    const appMap = new Map<string, AppRec>();
    for (const e of eps as GlobalEndpointRow[]) {
      if (!appMap.has(e.appId)) {
        appMap.set(e.appId, { appId: e.appId, appName: e.appName, total: 0, unhealthy: 0, degraded: 0, healthy: 0, unknown: 0, maxLatency: 0, avgLatency: 0 });
      }
      const rec = appMap.get(e.appId)!;
      rec.total++;
      if (e.status === "unhealthy") rec.unhealthy++;
      else if (e.status === "degraded") rec.degraded++;
      else if (e.status === "healthy") rec.healthy++;
      else rec.unknown++;
      if (e.latencyMs > rec.maxLatency) rec.maxLatency = e.latencyMs;
    }
    // compute avg latency per app
    for (const [appId, rec] of appMap) {
      const appEps = (eps as GlobalEndpointRow[]).filter((e) => e.appId === appId);
      rec.avgLatency = appEps.length ? Math.round(appEps.reduce((s: number, e: GlobalEndpointRow) => s + e.latencyMs, 0) / appEps.length) : 0;
    }
    return [...appMap.values()].sort((a, b) => (b.unhealthy + b.degraded) - (a.unhealthy + a.degraded));
  }, [eps]);

  // Worst endpoints (unhealthy/degraded first, then by latency)
  const worstEndpoints = useMemo(() =>
    [...eps]
      .filter((e) => e.status === "unhealthy" || e.status === "degraded")
      .sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || b.latencyMs - a.latencyMs)
      .slice(0, 5),
    [eps],
  );

  const hasAlerts = !isLoading && (unhealthy > 0 || degraded > 0);
  const allHealthy = !isLoading && eps.length > 0 && unhealthy === 0 && degraded === 0;

  return (
    <div className="space-y-4">
      <RefreshingBar isFetching={isFetching} isLoading={isLoading} />
      <PageHeader
        title="Network"
        subtitle="Cross-application endpoint health, latency, and packet loss"
        right={dataSource ? <DataSourceBadge dataSource={dataSource} dataAsOf={dataAsOf} label="Azure Resource Graph" /> : undefined}
      />

      {/* Health alert banner */}
      {hasAlerts && (
        <div className="bg-destructive/10 border border-destructive/30 rounded-sm px-4 py-2.5 flex items-start gap-3">
          <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <span className="text-[13px] font-semibold text-destructive">Network issues detected — </span>
            <span className="text-[13px] text-destructive/80">
              {unhealthy > 0 && `${unhealthy} unhealthy${degraded > 0 ? ", " : ""}`}
              {degraded > 0 && `${degraded} degraded`}
              {" "}endpoint{(unhealthy + degraded) !== 1 ? "s" : ""} across your applications
            </span>
          </div>
          {worstEndpoints.length > 0 && (
            <div className="hidden md:flex items-center gap-2 flex-wrap">
              {worstEndpoints.map((e) => (
                <span key={e.id} className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-sm bg-destructive/15 border border-destructive/30 text-destructive font-medium">
                  <span className="h-1.5 w-1.5 rounded-full bg-destructive inline-block shrink-0" />
                  {e.appName} · {e.name}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {allHealthy && (
        <div className="bg-green-500/10 border border-green-500/30 rounded-sm px-4 py-2 flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
          <span className="text-[13px] text-green-600 dark:text-green-400 font-medium">All {eps.length} endpoints are healthy</span>
        </div>
      )}

      {/* Stat tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Tile title="Endpoints monitored" value={isLoading ? null : eps.length.toString()} sub="Across all applications" />
        <Tile title="Avg latency" value={isLoading ? null : `${avgLatency}ms`} sub="P50 across endpoints" />
        <Tile title="Degraded" value={isLoading ? null : degraded.toString()} sub="Elevated latency or loss" warn={degraded > 0} />
        <Tile title="Unhealthy" value={isLoading ? null : unhealthy.toString()} sub="Failing probes" bad={unhealthy > 0} />
      </div>

      {/* Charts row */}
      {!isEmpty && (
        <div className="grid grid-cols-3 gap-4">
          {/* Left column: status donut + packet loss */}
          <div className="flex flex-col gap-4">
            {/* Status donut */}
            <div className="bg-card border border-border shadow-sm p-4 flex flex-col">
              <h2 className="text-sm font-semibold mb-3">Endpoint status</h2>
              {isLoading ? (
                <div className="flex-1 flex items-center justify-center"><Skeleton className="h-36 w-36 rounded-full" /></div>
              ) : (
                <div className="flex flex-col items-center gap-3">
                  <ResponsiveContainer width="100%" height={180}>
                    <PieChart>
                      <Pie
                        data={statusPie}
                        cx="50%"
                        cy="50%"
                        innerRadius={52}
                        outerRadius={82}
                        paddingAngle={statusPie.length > 1 ? 3 : 0}
                        dataKey="value"
                        strokeWidth={0}
                      >
                        {statusPie.map((entry) => (
                          <Cell key={entry.name} fill={STATUS_COLOR[entry.name as EndpointStatus]} />
                        ))}
                      </Pie>
                      <Tooltip
                        content={({ active, payload }) => {
                          if (!active || !payload?.length) return null;
                          const d = payload[0];
                          return (
                            <div className="bg-popover border border-border rounded px-2 py-1 text-[12px] shadow-md">
                              <span className="font-medium capitalize">{d.name}</span>
                              <span className="ml-2 text-muted-foreground">{d.value} endpoint{(d.value as number) !== 1 ? "s" : ""}</span>
                            </div>
                          );
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 justify-center">
                    {(["healthy", "degraded", "unhealthy", "unknown"] as EndpointStatus[])
                      .filter((s) => eps.some((e) => e.status === s))
                      .map((s) => (
                        <div key={s} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                          <span className="h-2 w-2 rounded-full shrink-0" style={{ background: STATUS_COLOR[s] }} />
                          <span className="capitalize">{s}</span>
                          <span className="font-semibold text-foreground">{eps.filter((e) => e.status === s).length}</span>
                        </div>
                      ))}
                  </div>
                </div>
              )}
            </div>

            {/* Packet loss — horizontal bar, same style as latency */}
            <div className="bg-card border border-border shadow-sm p-4 flex flex-col flex-1">
              <h2 className="text-sm font-semibold mb-3">Packet loss <span className="text-[11px] text-muted-foreground font-normal ml-1">% · sorted descending</span></h2>
              {isLoading ? (
                <div className="space-y-2"><Skeleton className="h-6 w-full" /><Skeleton className="h-6 w-4/5" /></div>
              ) : (
                <ResponsiveContainer width="100%" height={Math.max(120, lossData.length * 36)}>
                  <BarChart data={lossData} layout="vertical" margin={{ left: 0, right: 24, top: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="rgba(255,255,255,0.06)" />
                    <XAxis
                      type="number"
                      tick={{ fontSize: 11, fill: "#64748b" }}
                      tickFormatter={(v) => `${v}%`}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      type="category"
                      dataKey="label"
                      width={100}
                      tick={{ fontSize: 11, fill: "#94a3b8" }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip
                      cursor={{ fill: "rgba(255,255,255,0.04)" }}
                      content={({ active, payload }) => {
                        if (!active || !payload?.length) return null;
                        const d = payload[0].payload;
                        return (
                          <div className="bg-popover border border-border rounded px-2 py-1 text-[12px] shadow-md">
                            <span className="font-medium">{d.label}</span>
                            <span className="ml-2 text-muted-foreground">{d.loss}% loss</span>
                          </div>
                        );
                      }}
                    />
                    <Bar dataKey="loss" radius={[0, 3, 3, 0]} maxBarSize={22}>
                      {lossData.map((entry, idx) => (
                        <Cell key={idx} fill={entry.fill} fillOpacity={0.85} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Latency bar chart */}
          <div className="col-span-2 bg-card border border-border shadow-sm p-4 flex flex-col">
            <h2 className="text-sm font-semibold mb-3">Latency by endpoint <span className="text-[11px] text-muted-foreground font-normal ml-1">ms · sorted descending</span></h2>
            {isLoading ? (
              <div className="space-y-2 flex-1"><Skeleton className="h-6 w-full" /><Skeleton className="h-6 w-4/5" /><Skeleton className="h-6 w-3/5" /></div>
            ) : (
              <ResponsiveContainer width="100%" height={Math.max(160, latencyData.length * 36)}>
                <BarChart data={latencyData} layout="vertical" margin={{ left: 0, right: 24, top: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="rgba(255,255,255,0.06)" />
                  <XAxis
                    type="number"
                    tick={{ fontSize: 11, fill: "#64748b" }}
                    tickFormatter={(v) => `${v}ms`}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    type="category"
                    dataKey="label"
                    width={130}
                    tick={{ fontSize: 11, fill: "#94a3b8" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    cursor={{ fill: "rgba(255,255,255,0.04)" }}
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const d = payload[0].payload;
                      return (
                        <div className="bg-popover border border-border rounded px-2 py-1 text-[12px] shadow-md">
                          <span className="font-medium">{d.label}</span>
                          <span className="ml-2 text-muted-foreground">{d.latency}ms</span>
                          <span className="ml-2 capitalize" style={{ color: d.fill }}>({d.status})</span>
                        </div>
                      );
                    }}
                  />
                  <Bar dataKey="latency" radius={[0, 3, 3, 0]} maxBarSize={22}>
                    {latencyData.map((entry, idx) => (
                      <Cell key={idx} fill={entry.fill} fillOpacity={0.85} />
                    ))}
                  </Bar>
                  {avgLatency > 0 && (
                    <ReferenceLine x={avgLatency} stroke="#64748b" strokeDasharray="4 3" label={{ value: "avg", position: "insideTopRight", fontSize: 10, fill: "#64748b" }} />
                  )}
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      )}

      {/* Per-app breakdown */}
      {!isEmpty && appBreakdown.length > 0 && (
        <AppBreakdownPanel apps={appBreakdown} isLoading={isLoading} />
      )}

      {/* Endpoints table — half-height, scrollable */}
      <div className="bg-card border border-border shadow-sm">
        <div className="p-2 border-b border-border flex items-center justify-between">
          <h2 className="text-sm font-semibold px-2">Endpoints</h2>
          {!isLoading && eps.length > 0 && (
            <span className="text-[11px] text-muted-foreground px-2">{eps.length} total</span>
          )}
        </div>
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
          <div className="overflow-y-auto" style={{ maxHeight: 240 }}>
            <Table className="text-[13px]">
              <TableHeader className="bg-muted/50 hover:bg-muted/50 border-b border-border sticky top-0 z-10">
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
                {[...eps]
                  .sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status))
                  .map((e) => (
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
          </div>
        )}
      </div>
    </div>
  );
}

type AppRec = { appId: string; appName: string; total: number; unhealthy: number; degraded: number; healthy: number; unknown: number; maxLatency: number; avgLatency: number };

function AppBreakdownPanel({ apps, isLoading }: { apps: AppRec[]; isLoading: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? apps : apps.slice(0, 6);

  return (
    <div className="bg-card border border-border shadow-sm">
      <div className="p-2 border-b border-border flex items-center gap-2">
        <Network className="h-3.5 w-3.5 text-muted-foreground ml-2" />
        <h2 className="text-sm font-semibold">Health by application</h2>
        <span className="text-[11px] text-muted-foreground ml-1">{apps.length} application{apps.length !== 1 ? "s" : ""} monitored</span>
      </div>

      {isLoading ? (
        <div className="p-4 grid grid-cols-2 md:grid-cols-3 gap-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full" />)}
        </div>
      ) : (
        <>
          <div className="p-3 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {visible.map((app) => {
              const hasIssue = app.unhealthy > 0 || app.degraded > 0;
              const healthPct = app.total > 0 ? Math.round((app.healthy / app.total) * 100) : 100;
              return (
                <div
                  key={app.appId}
                  className={`p-3 rounded-sm border ${hasIssue ? "border-destructive/40 bg-destructive/5" : "border-border bg-muted/20"}`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[12px] font-semibold text-foreground">{app.appName}</span>
                    <span className="text-[11px] text-muted-foreground tabular-nums">{app.total} ep{app.total !== 1 ? "s" : ""}</span>
                  </div>
                  <div className="flex gap-1 mb-2">
                    <div className="flex-1 h-1.5 rounded-full overflow-hidden bg-muted flex">
                      {app.unhealthy > 0 && (
                        <div className="h-full bg-destructive" style={{ width: `${Math.round((app.unhealthy / app.total) * 100)}%` }} />
                      )}
                      {app.degraded > 0 && (
                        <div className="h-full bg-amber-500" style={{ width: `${Math.round((app.degraded / app.total) * 100)}%` }} />
                      )}
                      {app.unknown > 0 && (
                        <div className="h-full bg-muted-foreground/30" style={{ width: `${Math.round((app.unknown / app.total) * 100)}%` }} />
                      )}
                      {app.healthy > 0 && (
                        <div className="h-full bg-violet-500" style={{ width: `${Math.round((app.healthy / app.total) * 100)}%` }} />
                      )}
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-[11px]">
                    <div className="flex items-center gap-2">
                      {app.unhealthy > 0 && <span className="text-destructive font-medium">{app.unhealthy} down</span>}
                      {app.degraded > 0 && <span className="text-amber-500 font-medium">{app.degraded} degraded</span>}
                      {!hasIssue && <span className="text-green-500 font-medium">{healthPct}% healthy</span>}
                    </div>
                    <span className="text-muted-foreground tabular-nums">{app.avgLatency}ms avg</span>
                  </div>
                </div>
              );
            })}
          </div>
          {apps.length > 6 && (
            <button
              type="button"
              onClick={() => setExpanded((x) => !x)}
              className="w-full py-1.5 border-t border-border text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors flex items-center justify-center gap-1"
            >
              {expanded ? <><ChevronUp className="h-3 w-3" /> Show less</> : <><ChevronDown className="h-3 w-3" /> Show {apps.length - 6} more</>}
            </button>
          )}
        </>
      )}
    </div>
  );
}

function Tile({ title, value, sub, warn, bad }: { title: string; value: string | null; sub: string; warn?: boolean; bad?: boolean }) {
  return (
    <div className="bg-card border border-border shadow-sm p-3 space-y-0.5">
      <div className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide">{title}</div>
      {value === null ? (
        <Skeleton className="h-7 w-16" />
      ) : (
        <div className={`text-2xl font-bold tabular-nums ${bad ? "text-destructive" : warn ? "text-amber-500" : ""}`}>{value}</div>
      )}
      <div className="text-[11px] text-muted-foreground">{sub}</div>
    </div>
  );
}
