import { useMemo, useState } from "react";
import {
  LineChart, Line, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { Radio, AlertTriangle, CheckCircle2, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { PageHeader, PanelCard, StatusPill } from "@/components/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";

const MOCK_GENERATED_AT = new Date(Date.now() - 2 * 60 * 1000).toISOString();

type ProtoDistrib = { protocol: string; bytes: number; packets: number; color: string };
type RegionRow = {
  region: string;
  inboundMbps: number;
  outboundMbps: number;
  dropRate: number;
  retransmitRate: number;
  p99LatencyMs: number;
  trend: "up" | "down" | "stable";
};
type TimePoint = { time: string; inbound: number; outbound: number; drops: number; retransmits: number };

function useMockTelemetry() {
  const regions: RegionRow[] = [
    { region: "East US 2", inboundMbps: 412, outboundMbps: 389, dropRate: 0.12, retransmitRate: 0.41, p99LatencyMs: 18, trend: "stable" },
    { region: "East US",   inboundMbps: 287, outboundMbps: 261, dropRate: 0.08, retransmitRate: 0.29, p99LatencyMs: 23, trend: "down"   },
    { region: "Global",    inboundMbps: 94,  outboundMbps: 87,  dropRate: 0.19, retransmitRate: 0.55, p99LatencyMs: 44, trend: "stable" },
  ];

  const protocols: ProtoDistrib[] = [
    { protocol: "HTTPS",  bytes: 6_420_000_000, packets: 4_210_000, color: "#8b5cf6" },
    { protocol: "WSS",    bytes: 1_830_000_000, packets: 9_870_000, color: "#6366f1" },
    { protocol: "gRPC",   bytes: 940_000_000,   packets: 2_100_000, color: "#0ea5e9" },
    { protocol: "TCP",    bytes: 520_000_000,   packets: 880_000,   color: "#10b981" },
    { protocol: "UDP",    bytes: 210_000_000,   packets: 3_400_000, color: "#f59e0b" },
    { protocol: "Other",  bytes: 80_000_000,    packets: 190_000,   color: "#6b7280" },
  ];

  const now = Date.now();
  const timeSeries: TimePoint[] = Array.from({ length: 30 }, (_, i) => {
    const t = new Date(now - (29 - i) * 2 * 60 * 1000);
    const hh = t.getHours().toString().padStart(2, "0");
    const mm = t.getMinutes().toString().padStart(2, "0");
    const base = 350 + Math.sin(i / 4) * 80;
    return {
      time: `${hh}:${mm}`,
      inbound: Math.round(base + Math.random() * 40),
      outbound: Math.round(base * 0.92 + Math.random() * 35),
      drops: parseFloat((Math.random() * 0.5).toFixed(2)),
      retransmits: parseFloat((Math.random() * 1.2).toFixed(2)),
    };
  });

  const totals = {
    inboundMbps: regions.reduce((s, r) => s + r.inboundMbps, 0),
    outboundMbps: regions.reduce((s, r) => s + r.outboundMbps, 0),
    avgDropRate: parseFloat((regions.reduce((s, r) => s + r.dropRate, 0) / regions.length).toFixed(2)),
    avgRetransmit: parseFloat((regions.reduce((s, r) => s + r.retransmitRate, 0) / regions.length).toFixed(2)),
  };

  return { regions, protocols, timeSeries, totals };
}

function fmtBytes(bytes: number) {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(0)} MB`;
  return `${(bytes / 1e3).toFixed(0)} KB`;
}

function fmtPkts(n: number) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
  return `${n}`;
}

function TrendIcon({ trend }: { trend: "up" | "down" | "stable" }) {
  if (trend === "up")     return <TrendingUp   className="h-4 w-4 text-destructive" />;
  if (trend === "down")   return <TrendingDown  className="h-4 w-4 text-emerald-500" />;
  return <Minus className="h-4 w-4 text-muted-foreground" />;
}

function dropTone(rate: number): "ok" | "warn" | "bad" {
  if (rate < 0.15) return "ok";
  if (rate < 0.35) return "warn";
  return "bad";
}

export default function TelemetryPage() {
  const { regions, protocols, timeSeries, totals } = useMockTelemetry();
  const [sortCol, setSortCol] = useState<keyof RegionRow>("inboundMbps");
  const [sortAsc, setSortAsc] = useState(false);

  const sorted = useMemo(() => {
    return [...regions].sort((a, b) => {
      const av = a[sortCol] as number | string;
      const bv = b[sortCol] as number | string;
      if (typeof av === "number" && typeof bv === "number") {
        return sortAsc ? av - bv : bv - av;
      }
      return sortAsc
        ? String(av).localeCompare(String(bv))
        : String(bv).localeCompare(String(av));
    });
  }, [regions, sortCol, sortAsc]);

  function handleSort(col: keyof RegionRow) {
    if (col === sortCol) setSortAsc((p) => !p);
    else { setSortCol(col); setSortAsc(false); }
  }

  const totalProtoBytes = protocols.reduce((s, p) => s + p.bytes, 0);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Network Telemetry"
        subtitle="Real-time traffic throughput, drop rates, retransmissions, and protocol distribution across all regions"
        right={
          <span className="text-[11px] text-muted-foreground">
            Refreshed {new Date(MOCK_GENERATED_AT).toLocaleTimeString()}
          </span>
        }
      />

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Total Inbound",     value: `${totals.inboundMbps} Mbps`,  tone: "info"  as const, icon: <TrendingDown className="h-4 w-4 text-primary" /> },
          { label: "Total Outbound",    value: `${totals.outboundMbps} Mbps`, tone: "info"  as const, icon: <TrendingUp   className="h-4 w-4 text-primary" /> },
          { label: "Avg Drop Rate",     value: `${totals.avgDropRate}%`,       tone: dropTone(totals.avgDropRate), icon: <AlertTriangle  className="h-4 w-4" /> },
          { label: "Avg Retransmit",    value: `${totals.avgRetransmit}%`,     tone: dropTone(totals.avgRetransmit / 3), icon: <CheckCircle2 className="h-4 w-4" /> },
        ].map((kpi) => (
          <div key={kpi.label} className="bg-card border border-border rounded-sm p-3 flex flex-col gap-1.5 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide">{kpi.label}</span>
              {kpi.icon}
            </div>
            <span className="text-2xl font-bold text-foreground">{kpi.value}</span>
            <StatusPill tone={kpi.tone}>
              {kpi.tone === "ok" ? "Nominal" : kpi.tone === "warn" ? "Elevated" : kpi.tone === "bad" ? "Critical" : "Live"}
            </StatusPill>
          </div>
        ))}
      </div>

      {/* Traffic timeseries */}
      <PanelCard title="Throughput — last 60 min (Mbps)">
        <div className="p-3 h-52">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={timeSeries} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="inGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#8b5cf6" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="outGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#0ea5e9" stopOpacity={0.20} />
                  <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" strokeOpacity={0.5} />
              <XAxis dataKey="time" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} interval={4} />
              <YAxis tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} width={36} />
              <Tooltip
                contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 4, fontSize: 12 }}
                labelStyle={{ color: "var(--foreground)", fontWeight: 600 }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Area type="monotone" dataKey="inbound"  name="Inbound"  stroke="#8b5cf6" fill="url(#inGrad)"  strokeWidth={1.5} dot={false} />
              <Area type="monotone" dataKey="outbound" name="Outbound" stroke="#0ea5e9" fill="url(#outGrad)" strokeWidth={1.5} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </PanelCard>

      {/* Drop & Retransmit timeseries */}
      <PanelCard title="Drop Rate & Retransmission Rate (%) — last 60 min">
        <div className="p-3 h-44">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={timeSeries} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" strokeOpacity={0.5} />
              <XAxis dataKey="time" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} interval={4} />
              <YAxis tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} width={36} tickFormatter={(v) => `${v}%`} />
              <Tooltip
                contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 4, fontSize: 12 }}
                formatter={(v: number) => [`${v}%`]}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="drops"       name="Drop Rate"     stroke="#ef4444" strokeWidth={1.5} dot={false} />
              <Line type="monotone" dataKey="retransmits" name="Retransmit Rate" stroke="#f59e0b" strokeWidth={1.5} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </PanelCard>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {/* Protocol distribution */}
        <PanelCard title="Protocol Distribution">
          <div className="p-3 space-y-2">
            {protocols.map((p) => {
              const pct = ((p.bytes / totalProtoBytes) * 100).toFixed(1);
              return (
                <div key={p.protocol} className="space-y-0.5">
                  <div className="flex items-center justify-between text-[12px]">
                    <span className="font-medium text-foreground">{p.protocol}</span>
                    <span className="text-muted-foreground tabular-nums">{fmtBytes(p.bytes)} · {fmtPkts(p.packets)} pkts</span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{ width: `${pct}%`, background: p.color }}
                    />
                  </div>
                  <div className="text-[10px] text-muted-foreground text-right">{pct}%</div>
                </div>
              );
            })}
          </div>
        </PanelCard>

        {/* Per-region bar chart */}
        <div className="lg:col-span-2">
          <PanelCard title="Throughput by Region (Mbps)">
            <div className="p-3 h-52">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={regions.map((r) => ({ name: r.region.replace(" ", "\n"), inbound: r.inboundMbps, outbound: r.outboundMbps }))}
                  margin={{ top: 4, right: 8, left: 0, bottom: 0 }}
                  barGap={2}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" strokeOpacity={0.5} vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 9, fill: "var(--muted-foreground)" }} />
                  <YAxis tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} width={36} />
                  <Tooltip
                    contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 4, fontSize: 12 }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="inbound"  name="Inbound"  fill="#8b5cf6" radius={[2, 2, 0, 0]} maxBarSize={24} />
                  <Bar dataKey="outbound" name="Outbound" fill="#0ea5e9" radius={[2, 2, 0, 0]} maxBarSize={24} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </PanelCard>
        </div>
      </div>

      {/* Per-region table */}
      <PanelCard title="Region Breakdown">
        <Table>
          <TableHeader>
            <TableRow>
              {(
                [
                  ["region",         "Region"],
                  ["inboundMbps",    "Inbound (Mbps)"],
                  ["outboundMbps",   "Outbound (Mbps)"],
                  ["dropRate",       "Drop Rate %"],
                  ["retransmitRate", "Retransmit %"],
                  ["p99LatencyMs",   "P99 Latency"],
                  ["trend",          "Trend"],
                ] as [keyof RegionRow, string][]
              ).map(([col, label]) => (
                <TableHead
                  key={col}
                  className="text-[11px] cursor-pointer select-none hover:text-foreground transition-colors"
                  onClick={() => handleSort(col)}
                >
                  {label}
                  {sortCol === col && (
                    <span className="ml-1 text-[10px]">{sortAsc ? "▲" : "▼"}</span>
                  )}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((r) => (
              <TableRow key={r.region} className="text-[13px]">
                <TableCell className="font-medium">{r.region}</TableCell>
                <TableCell className="tabular-nums">{r.inboundMbps}</TableCell>
                <TableCell className="tabular-nums">{r.outboundMbps}</TableCell>
                <TableCell>
                  <StatusPill tone={dropTone(r.dropRate)}>{r.dropRate}%</StatusPill>
                </TableCell>
                <TableCell>
                  <StatusPill tone={dropTone(r.retransmitRate / 3)}>{r.retransmitRate}%</StatusPill>
                </TableCell>
                <TableCell className="tabular-nums">{r.p99LatencyMs} ms</TableCell>
                <TableCell><TrendIcon trend={r.trend} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </PanelCard>
    </div>
  );
}
