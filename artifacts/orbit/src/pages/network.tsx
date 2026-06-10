import { useMemo } from "react";
import { useListGlobalEndpoints } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader, StatusPill } from "@/components/page-header";
import { DataSourceBadge } from "@/components/data-source-badge";
import { RefreshingBar } from "@/components/refreshing-bar";
import { Network } from "lucide-react";
import type { GlobalEndpointRow } from "@workspace/api-client-react";
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
  healthy: "#10b981",
  degraded: "#f59e0b",
  unhealthy: "#ef4444",
  unknown: "#64748b",
};

const STATUS_ORDER: EndpointStatus[] = ["unhealthy", "degraded", "unknown", "healthy"];

export default function NetworkPage() {
  const { data, isLoading, isFetching } = useListGlobalEndpoints();
  const eps = data?.endpoints ?? [];
  const isEmpty = !isLoading && eps.length === 0;

  const unhealthy = eps.filter((e) => e.status === "unhealthy").length;
  const degraded = eps.filter((e) => e.status === "degraded").length;
  const healthy = eps.filter((e) => e.status === "healthy").length;
  const unknown = eps.filter((e) => e.status === "unknown").length;
  const avgLatency = eps.length
    ? Math.round(eps.reduce((s, e) => s + e.latencyMs, 0) / eps.length)
    : 0;

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

  return (
    <div className="space-y-4">
      <RefreshingBar isFetching={isFetching} isLoading={isLoading} />
      <PageHeader
        title="Network"
        subtitle="Cross-application endpoint health, latency, and packet loss"
        right={dataSource ? <DataSourceBadge dataSource={dataSource} dataAsOf={dataAsOf} label="Azure Resource Graph" /> : undefined}
      />

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
                {/* Legend */}
                <div className="flex flex-wrap gap-x-4 gap-y-1 justify-center">
                  {(["healthy", "degraded", "unhealthy", "unknown"] as EndpointStatus[])
                    .filter((s) => eps.some((e) => e.status === s))
                    .map((s) => (
                      <div key={s} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        <span className="h-2 w-2 rounded-full shrink-0" style={{ background: STATUS_COLOR[s] }} />
                        <span className="capitalize">{s}</span>
                        <span className="font-semibold text-foreground">
                          {eps.filter((e) => e.status === s).length}
                        </span>
                      </div>
                    ))}
                </div>
              </div>
            )}
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

      {/* Packet loss chart */}
      {!isEmpty && (
        <div className="bg-card border border-border shadow-sm p-4">
          <h2 className="text-sm font-semibold mb-3">Packet loss by endpoint <span className="text-[11px] text-muted-foreground font-normal ml-1">% · green &lt;0.1% · amber &lt;0.5% · red ≥0.5%</span></h2>
          {isLoading ? (
            <Skeleton className="h-28 w-full" />
          ) : (
            <ResponsiveContainer width="100%" height={120}>
              <BarChart data={lossData} margin={{ left: 0, right: 16, top: 4, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.06)" />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11, fill: "#94a3b8" }}
                  axisLine={false}
                  tickLine={false}
                  interval={0}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: "#64748b" }}
                  tickFormatter={(v) => `${v}%`}
                  axisLine={false}
                  tickLine={false}
                  width={36}
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
                <Bar dataKey="loss" radius={[3, 3, 0, 0]} maxBarSize={40}>
                  {lossData.map((entry, idx) => (
                    <Cell key={idx} fill={entry.fill} fillOpacity={0.85} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
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
