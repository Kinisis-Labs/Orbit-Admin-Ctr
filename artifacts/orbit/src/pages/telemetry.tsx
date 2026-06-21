import { useMemo } from "react";
import {
  AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import {
  Activity, AlertTriangle, CheckCircle2, Clock, Cpu, HardDrive, Monitor, Globe,
} from "lucide-react";
import { useGetTelemetry } from "@workspace/api-client-react";
import type { MetricSeries, BrowserTelemetry, TopError } from "@workspace/api-client-react";
import { PageHeader, PanelCard, StatusPill } from "@/components/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { ScopeSelect } from "@/lib/scope";
import { useScope } from "@/lib/scope-context";
import { DataSourceBadge } from "@/components/data-source-badge";
import { RefreshingBar } from "@/components/refreshing-bar";

function fmtTime(iso: string): string {
  try {
    const d = new Date(iso);
    return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
  } catch {
    return iso;
  }
}

function errorTone(rate: number): "ok" | "warn" | "bad" {
  if (rate < 1) return "ok";
  if (rate < 5) return "warn";
  return "bad";
}

function availabilityTone(pct: number): "ok" | "warn" | "bad" {
  if (pct >= 99) return "ok";
  if (pct >= 95) return "warn";
  return "bad";
}

function infraTone(pct: number): "ok" | "warn" | "bad" {
  if (pct < 60) return "ok";
  if (pct < 80) return "warn";
  return "bad";
}

function toChartRows(series: MetricSeries) {
  return series.points.map((p) => ({ time: fmtTime(p.timestamp), value: p.value }));
}

function SeriesChart({ series }: { series: MetricSeries }) {
  const data = useMemo(() => toChartRows(series), [series]);
  const isPercentage = series.unit === "%";
  const color = isPercentage ? "#8b5cf6" : "#0ea5e9";
  const formatter = (v: number) => (isPercentage ? `${v}${series.unit}` : `${v} ${series.unit}`);

  return (
    <PanelCard title={`${series.name} — last 24h`}>
      <div className="p-3 h-52">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id={`grad-${series.name}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={color} stopOpacity={0.25} />
                <stop offset="95%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" strokeOpacity={0.5} />
            <XAxis dataKey="time" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} interval={4} />
            <YAxis
              tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
              width={40}
              tickFormatter={isPercentage ? (v) => `${v}%` : undefined}
            />
            <Tooltip
              contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 4, fontSize: 12 }}
              formatter={(v: number) => [formatter(v)]}
            />
            <Area
              type="monotone"
              dataKey="value"
              name={series.name}
              stroke={color}
              fill={`url(#grad-${series.name})`}
              strokeWidth={1.5}
              dot={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </PanelCard>
  );
}

function KpiTile({
  label,
  value,
  tone,
  icon,
  unit,
}: {
  label: string;
  value: string | null;
  tone: "ok" | "warn" | "bad" | "info";
  icon: React.ReactNode;
  unit?: string;
}) {
  return (
    <div className="bg-card border border-border rounded-sm p-3 flex flex-col gap-1.5 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide">{label}</span>
        {icon}
      </div>
      {value === null ? (
        <Skeleton className="h-8 w-20" />
      ) : (
        <span className="text-2xl font-bold text-foreground tabular-nums">
          {value}
          {unit && <span className="text-base font-medium text-muted-foreground ml-1">{unit}</span>}
        </span>
      )}
      <StatusPill tone={tone}>
        {tone === "ok" ? "Healthy" : tone === "warn" ? "Elevated" : tone === "bad" ? "Critical" : "Live"}
      </StatusPill>
    </div>
  );
}

function TopErrorsPanel({ errors, isLoading }: { errors: TopError[]; isLoading: boolean }) {
  if (isLoading) {
    return (
      <PanelCard title="Top Errors">
        <div className="p-4 space-y-2">
          <Skeleton className="h-8" />
          <Skeleton className="h-8" />
        </div>
      </PanelCard>
    );
  }

  if (errors.length === 0) {
    return (
      <PanelCard title="Top Errors">
        <div className="p-6 text-center text-[12px] text-muted-foreground">
          No errors recorded in the last 24 hours.
        </div>
      </PanelCard>
    );
  }

  return (
    <PanelCard title="Top Errors">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-[11px]">Message</TableHead>
            <TableHead className="text-[11px] text-right">Count</TableHead>
            <TableHead className="text-[11px] text-right">Last Seen</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {errors.map((e) => (
            <TableRow key={e.message} className="text-[13px]">
              <TableCell className="font-medium max-w-md truncate" title={e.message}>{e.message}</TableCell>
              <TableCell className="text-right tabular-nums">{e.count}</TableCell>
              <TableCell className="text-right tabular-nums text-muted-foreground">
                {new Date(e.lastSeen).toLocaleString()}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </PanelCard>
  );
}

function BrowserTelemetryPanel({ browser }: { browser: BrowserTelemetry }) {
  const series = browser.series ?? [];
  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold flex items-center gap-2">
        <Monitor className="h-4 w-4 text-muted-foreground" />
        Browser Telemetry
      </h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiTile
          label="Page Load P95"
          value={browser.pageLoadP95Ms.toString()}
          tone={browser.pageLoadP95Ms < 500 ? "ok" : browser.pageLoadP95Ms < 1500 ? "warn" : "bad"}
          icon={<Clock className="h-4 w-4 text-primary" />}
          unit="ms"
        />
        <KpiTile
          label="Browser Exceptions / h"
          value={browser.browserExceptionsPerHour.toString()}
          tone={browser.browserExceptionsPerHour < 10 ? "ok" : browser.browserExceptionsPerHour < 50 ? "warn" : "bad"}
          icon={<AlertTriangle className="h-4 w-4 text-primary" />}
        />
        <KpiTile
          label="Page Views / h"
          value={browser.pageViewsPerHour.toString()}
          tone="info"
          icon={<Activity className="h-4 w-4 text-primary" />}
        />
        <KpiTile
          label="Top Slow Pages"
          value={browser.topSlowPages.length.toString()}
          tone="info"
          icon={<Globe className="h-4 w-4 text-primary" />}
          unit="tracked"
        />
      </div>
      {series.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {series.map((s) => (
            <SeriesChart key={s.name} series={s} />
          ))}
        </div>
      )}
      {browser.topSlowPages.length > 0 && (
        <PanelCard title="Slowest Pages (P95 load time)">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-[11px]">Page</TableHead>
                <TableHead className="text-[11px] text-right">P95 Latency</TableHead>
                <TableHead className="text-[11px] text-right">Views</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {browser.topSlowPages.map((p) => (
                <TableRow key={p.name} className="text-[13px]">
                  <TableCell className="font-medium max-w-md truncate" title={p.name}>{p.name}</TableCell>
                  <TableCell className="text-right tabular-nums">{p.p95Ms} ms</TableCell>
                  <TableCell className="text-right tabular-nums">{p.count}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </PanelCard>
      )}
      {browser.topFailingUrls.length > 0 && (
        <PanelCard title="Top Failing AJAX Targets">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-[11px]">URL</TableHead>
                <TableHead className="text-[11px] text-right">Failures</TableHead>
                <TableHead className="text-[11px] text-right">Failure Rate</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {browser.topFailingUrls.map((u) => (
                <TableRow key={u.url} className="text-[13px]">
                  <TableCell className="font-medium max-w-md truncate" title={u.url}>{u.url}</TableCell>
                  <TableCell className="text-right tabular-nums">{u.failureCount}</TableCell>
                  <TableCell className="text-right tabular-nums">{u.failureRate}%</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </PanelCard>
      )}
    </div>
  );
}

export default function TelemetryPage() {
  const { scope } = useScope();
  const appId = scope === "global" ? "" : scope;
  const { data, isLoading, isFetching } = useGetTelemetry(appId);

  const series = data?.series ?? [];
  const isMock = data?.dataSource === "mock";

  return (
    <div className="space-y-4">
      <RefreshingBar isFetching={isFetching} isLoading={isLoading} />
      <PageHeader
        title="Telemetry"
        subtitle="Per-app performance telemetry from Azure Application Insights"
        right={
          <div className="flex items-center gap-3">
            {data && <DataSourceBadge dataSource={data.dataSource} dataAsOf={data.cachedAt} label="Azure Monitor" />}
            <ScopeSelect allowGlobal={false} />
          </div>
        }
      />

      {isMock && !isLoading && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-sm px-4 py-2 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
          <span className="text-[13px] text-amber-600 dark:text-amber-400 font-medium">
            Azure Monitor is not configured — showing placeholder telemetry. Set AZURE_LOG_ANALYTICS_WORKSPACE_ID on the API container to enable live data.
          </span>
        </div>
      )}

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiTile
          label="Requests / min"
          value={isLoading ? null : (data?.requestsPerMin ?? 0).toString()}
          tone="info"
          icon={<Activity className="h-4 w-4 text-primary" />}
        />
        <KpiTile
          label="P95 Latency"
          value={isLoading ? null : (data?.p95LatencyMs ?? 0).toString()}
          tone={isLoading ? "info" : data?.p95LatencyMs ? (data.p95LatencyMs < 200 ? "ok" : data.p95LatencyMs < 500 ? "warn" : "bad") : "info"}
          icon={<Clock className="h-4 w-4 text-primary" />}
          unit="ms"
        />
        <KpiTile
          label="Error Rate"
          value={isLoading ? null : `${data?.errorRatePercent ?? 0}%`}
          tone={isLoading ? "info" : errorTone(data?.errorRatePercent ?? 0)}
          icon={<AlertTriangle className="h-4 w-4 text-primary" />}
        />
        <KpiTile
          label="Availability"
          value={isLoading ? null : `${data?.availabilityPercent ?? 99.9}%`}
          tone={isLoading ? "info" : availabilityTone(data?.availabilityPercent ?? 99.9)}
          icon={<CheckCircle2 className="h-4 w-4 text-primary" />}
        />
        <KpiTile
          label="CPU"
          value={isLoading || data?.cpuPercent === undefined ? null : `${data.cpuPercent}%`}
          tone={isLoading ? "info" : infraTone(data?.cpuPercent ?? 0)}
          icon={<Cpu className="h-4 w-4 text-primary" />}
        />
        <KpiTile
          label="Memory"
          value={isLoading || data?.memoryPercent === undefined ? null : `${data.memoryPercent}%`}
          tone={isLoading ? "info" : infraTone(data?.memoryPercent ?? 0)}
          icon={<HardDrive className="h-4 w-4 text-primary" />}
        />
      </div>

      {/* Time-series charts */}
      {isLoading ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <Skeleton className="h-60" />
          <Skeleton className="h-60" />
        </div>
      ) : series.length === 0 ? (
        <PanelCard title="Telemetry Series">
          <div className="p-6 text-center text-[12px] text-muted-foreground">
            No time-series data available. Application Insights may not be receiving telemetry for this app.
          </div>
        </PanelCard>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {series.map((s) => (
            <SeriesChart key={s.name} series={s} />
          ))}
        </div>
      )}

      {/* Top errors */}
      <TopErrorsPanel errors={data?.topErrors ?? []} isLoading={isLoading} />

      {/* Browser telemetry */}
      {data?.browserTelemetry && <BrowserTelemetryPanel browser={data.browserTelemetry} />}
    </div>
  );
}
