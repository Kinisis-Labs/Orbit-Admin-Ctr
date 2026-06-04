import { useState } from "react";
import { useParams } from "wouter";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  useGetApp, getGetAppQueryKey, 
  useGetInfrastructure, getGetInfrastructureQueryKey, 
  useGetNetwork, getGetNetworkQueryKey, 
  useGetCost, getGetCostQueryKey, 
  useGetLedger, getGetLedgerQueryKey, 
  useGetTelemetry, getGetTelemetryQueryKey, 
  useGetAppAlerts, getGetAppAlertsQueryKey,
  useSyncStripeSales,
  UserAuthType,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { format } from "date-fns";
import { 
  LineChart, Line, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from "recharts";
import { RefreshCw, Play, Square, Settings, Share, AlertTriangle, Lock, Wifi, WifiOff, Users, Building2, Globe, Smartphone } from "lucide-react";

const STALE_COST_THRESHOLD_MS = 24 * 60 * 60 * 1000;

function fmtDataAsOf(iso: string | undefined | null): string | null {
  if (!iso) return null;
  try {
    return format(new Date(iso), "MMM d, h:mm a bbb");
  } catch (e) {
    return null;
  }
}
import { Button } from "@/components/ui/button";
import { useAuth, COST_READER_GROUP } from "@/lib/auth";
import { AccessDenied } from "@/components/access-denied";
import { useToast } from "@/hooks/use-toast";

export default function AppDetail() {
  const params = useParams();
  const appId = params.appId!;
  const { hasGroup } = useAuth();
  const canSeeCost = hasGroup(COST_READER_GROUP.id);

  const { data: app, isLoading: appLoading } = useGetApp(appId, { query: { enabled: !!appId, queryKey: getGetAppQueryKey(appId) } });

  if (appLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (!app) {
    return (
      <div className="py-12 flex flex-col items-center justify-center text-center">
        <AlertTriangle className="h-8 w-8 text-muted-foreground mb-2" />
        <h2 className="text-lg font-semibold text-foreground">Resource not found</h2>
        <p className="text-sm text-muted-foreground mt-1">The resource '{appId}' could not be found.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Blade Title & Actions */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold tracking-tight">{app.name}</h1>
          </div>
        </div>

        {/* Global Resource Command Bar */}
        <div className="flex flex-wrap items-center gap-1 border-b border-border pb-2">
          <Button variant="ghost" size="sm" className="h-7 text-[13px] px-2 rounded-sm hover:bg-muted">
            <Play className="h-3.5 w-3.5 mr-1.5 text-[#7FBA00]" /> Start
          </Button>
          <Button variant="ghost" size="sm" className="h-7 text-[13px] px-2 rounded-sm hover:bg-muted">
            <RefreshCw className="h-3.5 w-3.5 mr-1.5 text-primary" /> Restart
          </Button>
          <Button variant="ghost" size="sm" className="h-7 text-[13px] px-2 rounded-sm hover:bg-muted">
            <Square className="h-3.5 w-3.5 mr-1.5 text-muted-foreground fill-current" /> Stop
          </Button>
          <div className="w-px h-4 bg-border mx-1" />
          <Button variant="ghost" size="sm" className="h-7 text-[13px] px-2 rounded-sm hover:bg-muted">
            <Settings className="h-3.5 w-3.5 mr-1.5 text-primary" /> Configuration
          </Button>
        </div>
      </div>

      <Tabs defaultValue="overview" className="w-full">
        {/* Azure Pivot / Tab Strip */}
        <TabsList className="flex h-10 w-full justify-start rounded-none border-b border-border bg-transparent p-0">
          <TabsTrigger value="overview" className="h-10 rounded-none border-b-2 border-transparent px-4 py-2 font-medium text-muted-foreground data-[state=active]:border-primary data-[state=active]:text-foreground data-[state=active]:shadow-none bg-transparent">Overview</TabsTrigger>
          <TabsTrigger value="infrastructure" className="h-10 rounded-none border-b-2 border-transparent px-4 py-2 font-medium text-muted-foreground data-[state=active]:border-primary data-[state=active]:text-foreground data-[state=active]:shadow-none bg-transparent">Infrastructure</TabsTrigger>
          <TabsTrigger value="network" className="h-10 rounded-none border-b-2 border-transparent px-4 py-2 font-medium text-muted-foreground data-[state=active]:border-primary data-[state=active]:text-foreground data-[state=active]:shadow-none bg-transparent">Network</TabsTrigger>
          <TabsTrigger value="telemetry" className="h-10 rounded-none border-b-2 border-transparent px-4 py-2 font-medium text-muted-foreground data-[state=active]:border-primary data-[state=active]:text-foreground data-[state=active]:shadow-none bg-transparent">Telemetry</TabsTrigger>
          <TabsTrigger value="cost" className="h-10 rounded-none border-b-2 border-transparent px-4 py-2 font-medium text-muted-foreground data-[state=active]:border-primary data-[state=active]:text-foreground data-[state=active]:shadow-none bg-transparent">
            <span className="inline-flex items-center gap-1.5">
              Cost
              {!canSeeCost && <Lock className="h-3 w-3" />}
            </span>
          </TabsTrigger>
          <TabsTrigger value="ledger" className="h-10 rounded-none border-b-2 border-transparent px-4 py-2 font-medium text-muted-foreground data-[state=active]:border-primary data-[state=active]:text-foreground data-[state=active]:shadow-none bg-transparent">
            <span className="inline-flex items-center gap-1.5">
              Ledger
              {!canSeeCost && <Lock className="h-3 w-3" />}
            </span>
          </TabsTrigger>
          <TabsTrigger value="alerts" className="h-10 rounded-none border-b-2 border-transparent px-4 py-2 font-medium text-muted-foreground data-[state=active]:border-primary data-[state=active]:text-foreground data-[state=active]:shadow-none bg-transparent">Alerts</TabsTrigger>
        </TabsList>
        
        <div className="mt-4">
          <TabsContent value="overview" className="space-y-4 m-0">
            <div className="bg-card border border-border shadow-sm p-4 text-[13px]">
              <h3 className="font-semibold text-sm mb-3">Essentials</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">
                <div className="flex flex-col gap-3">
                  <div className="grid grid-cols-3 gap-2">
                    <div className="text-muted-foreground font-medium">Resource group</div>
                    <div className="col-span-2 text-primary hover:underline cursor-pointer truncate">{app.resourceGroup}</div>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="text-muted-foreground font-medium">Status</div>
                    <div className="col-span-2"><StatusBadge status={app.status} /></div>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="text-muted-foreground font-medium">Location</div>
                    <div className="col-span-2">{app.region}</div>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="text-muted-foreground font-medium">Environment</div>
                    <div className="col-span-2">{app.environment}</div>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="text-muted-foreground font-medium">User auth</div>
                    <div className="col-span-2"><UserAuthBadge userAuth={app.userAuth} /></div>
                  </div>
                </div>
                <div className="flex flex-col gap-3">
                  <div className="grid grid-cols-3 gap-2">
                    <div className="text-muted-foreground font-medium">Subscription</div>
                    <div className="col-span-2 text-primary hover:underline cursor-pointer truncate">{app.subscriptionId}</div>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="text-muted-foreground font-medium">Tags</div>
                    <div className="col-span-2">
                      {Object.keys(app.tags || {}).length > 0 ? (
                        <div className="flex flex-col gap-0.5">
                          {Object.entries(app.tags || {}).map(([k, v]) => (
                            <span key={k} className="text-xs text-muted-foreground">
                              {k}: <span className="text-foreground">{v}</span>
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-muted-foreground italic">None</span>
                      )}
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="text-muted-foreground font-medium">Owners</div>
                    <div className="col-span-2">
                      {app.owners?.join(", ") || <span className="text-muted-foreground italic">Unassigned</span>}
                    </div>
                  </div>
                  {app.androidPackage && (
                    <div className="grid grid-cols-3 gap-2">
                      <div className="text-muted-foreground font-medium">Android package</div>
                      <div className="col-span-2">
                        <span className="inline-flex items-center gap-1.5 text-[12px]">
                          <Smartphone className="h-3.5 w-3.5 text-[#7FBA00] shrink-0" />
                          <span className="font-mono text-foreground break-all">{app.androidPackage}</span>
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
            {canSeeCost && <OverviewCostTile appId={appId} />}
          </TabsContent>
          
          <TabsContent value="infrastructure" className="m-0 space-y-4">
            <InfraTab appId={appId} />
          </TabsContent>

          <TabsContent value="network" className="m-0 space-y-4">
            <NetworkTab appId={appId} />
          </TabsContent>

          <TabsContent value="telemetry" className="m-0 space-y-4">
            <TelemetryTab appId={appId} />
          </TabsContent>

          <TabsContent value="cost" className="m-0 space-y-4">
            {canSeeCost ? (
              <CostTab appId={appId} />
            ) : (
              <AccessDenied resource={`Cost for ${app.name}`} requiredGroup={COST_READER_GROUP} />
            )}
          </TabsContent>

          <TabsContent value="ledger" className="m-0 space-y-4">
            {canSeeCost ? (
              <LedgerTab appId={appId} />
            ) : (
              <AccessDenied resource={`Ledger for ${app.name}`} requiredGroup={COST_READER_GROUP} />
            )}
          </TabsContent>

          <TabsContent value="alerts" className="m-0 space-y-4">
            <AlertsTab appId={appId} />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}

// ----------------------------------------------------------------------
// Auth type badge
// ----------------------------------------------------------------------

function UserAuthBadge({ userAuth }: { userAuth: string }) {
  if (userAuth === UserAuthType.clerk) {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm border border-violet-500/40 bg-violet-500/10 text-violet-600 dark:text-violet-400 text-[11px] font-semibold">
        <Users className="h-3 w-3" />
        Clerk
      </span>
    );
  }
  if (userAuth === UserAuthType.entra) {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm border border-sky-500/40 bg-sky-500/10 text-sky-600 dark:text-sky-400 text-[11px] font-semibold">
        <Building2 className="h-3 w-3" />
        Entra ID
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm border border-border bg-muted/40 text-muted-foreground text-[11px] font-semibold">
      <Globe className="h-3 w-3" />
      Public
    </span>
  );
}

// ----------------------------------------------------------------------
// Sub-components for tabs
// ----------------------------------------------------------------------

function DataSourceBadge({
  dataSource,
  dataAsOf,
  label,
}: {
  dataSource: "live" | "mock" | undefined;
  dataAsOf?: string | null;
  label?: string;
}) {
  if (!dataSource) return null;

  if (dataSource === "live") {
    const asOf = fmtDataAsOf(dataAsOf);
    const isStale = dataAsOf
      ? Date.now() - new Date(dataAsOf).getTime() > STALE_COST_THRESHOLD_MS
      : false;
    return (
      <span className="inline-flex items-center gap-1.5 select-none flex-wrap">
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm border border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[10px] font-semibold uppercase tracking-wide">
          <Wifi className="h-3 w-3" />
          Live — {label || "Azure Monitor"}
        </span>
        {asOf && (
          <span
            className={
              isStale
                ? "inline-flex items-center gap-0.5 text-[10px] text-amber-600 dark:text-amber-400"
                : "text-[10px] text-muted-foreground"
            }
          >
            {isStale && <AlertTriangle className="h-3 w-3" />}
            as of {asOf}
          </span>
        )}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm border border-border bg-muted/40 text-muted-foreground text-[10px] font-semibold uppercase tracking-wide select-none">
      <WifiOff className="h-3 w-3" />
      Demo data
    </span>
  );
}

function OverviewCostTile({ appId }: { appId: string }) {
  const { data, isLoading } = useGetCost(appId, undefined, { query: { enabled: !!appId, queryKey: getGetCostQueryKey(appId) } });

  if (isLoading) return <Skeleton className="h-20 w-full" />;
  if (!data) return null;

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: data.currency }).format(amount);

  const utilPct = Math.min((data.monthToDate / data.budget) * 100, 100);

  return (
    <div className="bg-card border border-border shadow-sm p-4 text-[13px]">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-sm">Cost snapshot</h3>
        <DataSourceBadge dataSource={data.dataSource} dataAsOf={data.dataAsOf} label="Azure Cost Management" />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="flex flex-col gap-1">
          <div className="text-[12px] text-muted-foreground font-medium">MTD spend</div>
          <div className="text-xl font-semibold tabular-nums">{formatCurrency(data.monthToDate)}</div>
        </div>
        <div className="flex flex-col gap-1">
          <div className="text-[12px] text-muted-foreground font-medium">Forecast</div>
          <div className="text-xl font-semibold tabular-nums text-muted-foreground">{formatCurrency(data.forecast)}</div>
        </div>
        <div className="md:col-span-2 flex flex-col justify-center gap-1.5">
          <div className="flex justify-between text-[12px]">
            <span className="text-muted-foreground font-medium">Budget utilization</span>
            <span className="tabular-nums text-foreground font-medium">
              {formatCurrency(data.monthToDate)} <span className="text-muted-foreground font-normal">of {formatCurrency(data.budget)}</span>
            </span>
          </div>
          <Progress value={utilPct} className="h-1.5 rounded-none bg-muted" />
          <div className="text-[11px] text-muted-foreground tabular-nums">{utilPct.toFixed(0)}% used</div>
        </div>
      </div>
    </div>
  );
}

function ForceRefreshButton({
  isRefreshing,
  onRefresh,
}: {
  isRefreshing: boolean;
  onRefresh: () => void;
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-6 px-2 text-[10px] rounded-sm text-muted-foreground hover:text-foreground hover:bg-muted gap-1"
      onClick={onRefresh}
      disabled={isRefreshing}
      title="Bypass cache and fetch latest data from Azure"
    >
      <RefreshCw className={`h-3 w-3${isRefreshing ? " animate-spin" : ""}`} />
      {isRefreshing ? "Refreshing…" : "Force refresh"}
    </Button>
  );
}

function useForceRefresh(url: string, queryKey: readonly unknown[]) {
  const queryClient = useQueryClient();
  const [isRefreshing, setIsRefreshing] = useState(false);

  const forceRefresh = async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    try {
      const res = await fetch(`${url}?refresh=true`, { credentials: "same-origin" });
      if (res.ok) {
        const data: unknown = await res.json();
        queryClient.setQueryData([...queryKey], data);
      }
    } finally {
      setIsRefreshing(false);
    }
  };

  return { isRefreshing, forceRefresh };
}

function isLiveMode(mode: string) {
  return mode === "entra";
}
function InfraTab({ appId }: { appId: string }) {
  const queryKey = getGetInfrastructureQueryKey(appId);
  const { data, isLoading } = useGetInfrastructure(appId, undefined, { query: { enabled: !!appId, queryKey } });
  const { isRefreshing, forceRefresh } = useForceRefresh(`/api/apps/${appId}/infrastructure`, queryKey);

  if (isLoading) return <Skeleton className="h-64 w-full" />;
  if (!data) return <div className="text-muted-foreground">No infrastructure data available</div>;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className="lg:col-span-1 bg-card border border-border shadow-sm flex flex-col">
        <div className="p-3 border-b border-border bg-card flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Resources</h2>
          <div className="flex items-center gap-2">
            {data.dataSource === "live" && (
              <ForceRefreshButton isRefreshing={isRefreshing} onRefresh={forceRefresh} />
            )}
            <DataSourceBadge dataSource={data.dataSource} />
          </div>
        </div>
        <div className="p-0 overflow-y-auto max-h-[500px]">
          <Table className="text-[12px]">
            <TableHeader className="bg-muted/50 border-b border-border">
              <TableRow className="hover:bg-transparent h-8">
                <TableHead className="font-semibold text-foreground">Name</TableHead>
                <TableHead className="font-semibold text-foreground w-[60px]">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.resources.map(res => (
                <TableRow key={res.id} className="h-8 hover:bg-muted/40">
                  <TableCell className="py-2">
                    <div className="font-medium text-primary hover:underline cursor-pointer">{res.name}</div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">{res.type} • {res.location}</div>
                  </TableCell>
                  <TableCell className="py-2"><StatusBadge status={res.status} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      <div className="lg:col-span-2 bg-card border border-border shadow-sm flex flex-col">
        <div className="p-3 border-b border-border bg-card">
          <h2 className="text-sm font-semibold">Metrics</h2>
        </div>
        <div className="p-4 space-y-6">
          {data.series.map((s, i) => (
            <div key={i} className="h-56">
              <h4 className="text-xs font-semibold mb-2 text-foreground">{s.name} ({s.unit})</h4>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={s.points} margin={{ top: 5, right: 0, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="2 2" vertical={false} stroke="hsl(var(--border))" />
                  <XAxis dataKey="timestamp" tickFormatter={(v) => format(new Date(v), "HH:mm")} stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', borderRadius: '2px', fontSize: '12px' }}
                    labelFormatter={(v) => format(new Date(v), "HH:mm:ss")}
                  />
                  <Area type="step" dataKey="value" stroke="hsl(var(--primary))" strokeWidth={1.5} fillOpacity={0.1} fill="hsl(var(--primary))" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function NetworkTab({ appId }: { appId: string }) {
  const { mode } = useAuth();
  const queryKey = getGetNetworkQueryKey(appId);
  const { data, isLoading } = useGetNetwork(appId, undefined, { query: { enabled: !!appId, queryKey } });
  const { isRefreshing, forceRefresh } = useForceRefresh(`/api/apps/${appId}/network`, queryKey);

  if (isLoading) return <Skeleton className="h-64 w-full" />;
  if (!data) return <div className="text-muted-foreground">No network data available</div>;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className="lg:col-span-1 bg-card border border-border shadow-sm flex flex-col">
        <div className="p-3 border-b border-border bg-card flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Endpoints</h2>
          {isLiveMode(mode) && (
            <ForceRefreshButton isRefreshing={isRefreshing} onRefresh={forceRefresh} />
          )}
        </div>
        <div className="p-0 overflow-y-auto max-h-[500px]">
          <Table className="text-[12px]">
            <TableHeader className="bg-muted/50 border-b border-border">
              <TableRow className="hover:bg-transparent h-8">
                <TableHead className="font-semibold text-foreground">Endpoint</TableHead>
                <TableHead className="font-semibold text-foreground text-right w-[60px]">Latency</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.endpoints.map((ep, i) => (
                <TableRow key={i} className="h-8 hover:bg-muted/40">
                  <TableCell className="py-2">
                    <div className="font-medium text-primary hover:underline cursor-pointer truncate w-[150px]">{ep.name}</div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <StatusBadge status={ep.status} />
                      <span className="text-[10px] text-muted-foreground">{ep.region}</span>
                    </div>
                  </TableCell>
                  <TableCell className="py-2 text-right tabular-nums">
                    {ep.latencyMs}ms
                    {ep.packetLossPercent !== undefined && ep.packetLossPercent > 0 && (
                      <div className="text-[10px] text-destructive">{ep.packetLossPercent}% loss</div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
      
      <div className="lg:col-span-2 bg-card border border-border shadow-sm flex flex-col">
        <div className="p-3 border-b border-border bg-card">
          <h2 className="text-sm font-semibold">Throughput</h2>
        </div>
        <div className="p-4 space-y-6">
          {data.throughput.map((s, i) => (
            <div key={i} className="h-56">
              <h4 className="text-xs font-semibold mb-2 text-foreground">{s.name} ({s.unit})</h4>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={s.points} margin={{ top: 5, right: 0, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="2 2" vertical={false} stroke="hsl(var(--border))" />
                  <XAxis dataKey="timestamp" tickFormatter={(v) => format(new Date(v), "HH:mm")} stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', borderRadius: '2px', fontSize: '12px' }}
                    labelFormatter={(v) => format(new Date(v), "HH:mm:ss")}
                  />
                  <Line type="linear" dataKey="value" stroke={i === 0 ? "hsl(var(--chart-2))" : "hsl(var(--primary))"} strokeWidth={1.5} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function TelemetryTab({ appId }: { appId: string }) {
  const queryKey = getGetTelemetryQueryKey(appId);
  const { data, isLoading } = useGetTelemetry(appId, undefined, { query: { enabled: !!appId, queryKey } });
  const { isRefreshing, forceRefresh } = useForceRefresh(`/api/apps/${appId}/telemetry`, queryKey);

  if (isLoading) return <Skeleton className="h-64 w-full" />;
  if (!data) return <div className="text-muted-foreground">No telemetry data available</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground font-medium">Key metrics (last 24 h)</span>
        <div className="flex items-center gap-2">
          {data.dataSource === "live" && (
            <ForceRefreshButton isRefreshing={isRefreshing} onRefresh={forceRefresh} />
          )}
          <DataSourceBadge dataSource={data.dataSource} />
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <div className="bg-card border border-border p-3 shadow-sm flex flex-col justify-between">
          <div className="text-[12px] text-muted-foreground font-medium mb-1">Requests / Min</div>
          <div className="text-xl font-semibold tabular-nums">{data.requestsPerMin.toLocaleString()}</div>
        </div>
        <div className="bg-card border border-border p-3 shadow-sm flex flex-col justify-between">
          <div className="text-[12px] text-muted-foreground font-medium mb-1">P95 Latency</div>
          <div className="text-xl font-semibold tabular-nums">{data.p95LatencyMs}ms</div>
        </div>
        <div className="bg-card border border-border p-3 shadow-sm flex flex-col justify-between">
          <div className="text-[12px] text-muted-foreground font-medium mb-1">Error Rate</div>
          <div className="text-xl font-semibold tabular-nums text-destructive">{data.errorRatePercent}%</div>
        </div>
        <div className="bg-card border border-border p-3 shadow-sm flex flex-col justify-between">
          <div className="text-[12px] text-muted-foreground font-medium mb-1">Availability</div>
          <div className="text-xl font-semibold tabular-nums text-[#7FBA00]">{data.availabilityPercent}%</div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-card border border-border shadow-sm flex flex-col">
          <div className="p-3 border-b border-border bg-card flex justify-between items-center">
            <h2 className="text-sm font-semibold">Application Metrics</h2>
          </div>
          <div className="p-4 space-y-6">
            {data.series.map((s, i) => (
              <div key={i} className="h-56">
                <h4 className="text-xs font-semibold mb-2 text-foreground">{s.name} ({s.unit})</h4>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={s.points} margin={{ top: 5, right: 0, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="2 2" vertical={false} stroke="hsl(var(--border))" />
                    <XAxis dataKey="timestamp" tickFormatter={(v) => format(new Date(v), "HH:mm")} stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} />
                    <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} />
                    <Tooltip 
                      contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', borderRadius: '2px', fontSize: '12px' }}
                      labelFormatter={(v) => format(new Date(v), "HH:mm:ss")}
                    />
                    <Line type="monotone" dataKey="value" stroke="hsl(var(--primary))" strokeWidth={1.5} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ))}
          </div>
        </div>
        
        <div className="lg:col-span-1 bg-card border border-border shadow-sm flex flex-col">
          <div className="p-3 border-b border-border bg-card">
            <h2 className="text-sm font-semibold">Top Exceptions</h2>
          </div>
          <div className="p-0">
            <Table className="text-[12px]">
              <TableBody>
                {data.topErrors.map((err, i) => (
                  <TableRow key={i} className="hover:bg-muted/40 border-b border-border/50">
                    <TableCell className="py-2.5">
                      <div className="font-mono text-xs text-destructive mb-1 break-all line-clamp-2 leading-tight">{err.message}</div>
                      <div className="flex justify-between text-muted-foreground text-[10px]">
                        <span>Count: {err.count}</span>
                        <span>{format(new Date(err.lastSeen), "MM/dd HH:mm")}</span>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      </div>
    </div>
  );
}

function CostTab({ appId }: { appId: string }) {
  const queryKey = getGetCostQueryKey(appId);
  const { data, isLoading } = useGetCost(appId, undefined, { query: { enabled: !!appId, queryKey } });
  const { isRefreshing, forceRefresh } = useForceRefresh(`/api/apps/${appId}/cost`, queryKey);

  if (isLoading) return <Skeleton className="h-64 w-full" />;
  if (!data) return <div className="text-muted-foreground">No cost data available</div>;

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: data.currency }).format(amount);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground font-medium">Month-to-date cost breakdown</span>
        <div className="flex items-center gap-2">
          {data.dataSource === "live" && (
            <ForceRefreshButton isRefreshing={isRefreshing} onRefresh={forceRefresh} />
          )}
          <DataSourceBadge dataSource={data.dataSource} dataAsOf={data.dataAsOf} label="Azure Cost Management" />
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
        <div className="bg-card border border-border p-3 shadow-sm flex flex-col justify-between">
          <div className="text-[12px] text-muted-foreground font-medium mb-1">Accumulated Cost (MTD)</div>
          <div className="text-xl font-semibold tabular-nums">{formatCurrency(data.monthToDate)}</div>
          {data.dataSource && (
            <div className="mt-2">
              <DataSourceBadge dataSource={data.dataSource} dataAsOf={data.dataAsOf} label="Azure Cost Management" />
            </div>
          )}
        </div>
        <div className="bg-card border border-border p-3 shadow-sm flex flex-col justify-between">
          <div className="text-[12px] text-muted-foreground font-medium mb-1">Forecast</div>
          <div className="text-xl font-semibold tabular-nums text-muted-foreground">{formatCurrency(data.forecast)}</div>
        </div>
        <div className="bg-card border border-border p-3 shadow-sm flex flex-col justify-between">
          <div className="text-[12px] text-muted-foreground font-medium mb-1">API usage (MTD)</div>
          <div className="text-xl font-semibold tabular-nums">{formatCurrency(data.apiUsage.cost)}</div>
          <div className="text-[11px] text-muted-foreground tabular-nums mt-0.5">
            {new Intl.NumberFormat("en-US").format(data.apiUsage.totalCalls)} calls
            <span className="mx-1">·</span>
            {formatCurrency(data.apiUsage.costPerMillion)}/M
          </div>
        </div>
        <div className="bg-card border border-border p-3 shadow-sm flex flex-col justify-between">
          <div className="text-[12px] text-muted-foreground font-medium mb-1">Budget Tracking</div>
          <div className="space-y-1 mt-1">
            <div className="flex justify-between text-[11px]">
              <span className="font-semibold tabular-nums text-foreground">{formatCurrency(data.monthToDate)}</span>
              <span className="text-muted-foreground tabular-nums">of {formatCurrency(data.budget)}</span>
            </div>
            <Progress value={(data.monthToDate / data.budget) * 100} className="h-1.5 rounded-none bg-muted" />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-card border border-border shadow-sm flex flex-col">
          <div className="p-3 border-b border-border bg-card">
            <h2 className="text-sm font-semibold">Daily Spend</h2>
          </div>
          <div className="p-4 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.daily} margin={{ top: 5, right: 0, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="2 2" vertical={false} stroke="hsl(var(--border))" />
                <XAxis dataKey="timestamp" tickFormatter={(v) => format(new Date(v), "MMM d")} stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis tickFormatter={(v) => `$${v}`} stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} />
                <Tooltip 
                  contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', borderRadius: '2px', fontSize: '12px' }}
                  labelFormatter={(v) => format(new Date(v), "MMM d, yyyy")}
                  formatter={(v: number) => [formatCurrency(v), 'Cost']}
                  cursor={{ fill: 'hsl(var(--muted))' }}
                />
                <Bar dataKey="value" fill="hsl(var(--primary))" radius={0} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="lg:col-span-1 bg-card border border-border shadow-sm flex flex-col">
          <div className="p-3 border-b border-border bg-card">
            <h2 className="text-sm font-semibold">By Service</h2>
          </div>
          <div className="p-0">
            <Table className="text-[12px]">
              <TableBody>
                {data.byService.map((svc, i) => (
                  <TableRow key={i} className="hover:bg-muted/40 border-b border-border/50">
                    <TableCell className="py-2.5">
                      <div className="flex justify-between font-medium mb-1.5">
                        <span>{svc.service}</span>
                        <span className="tabular-nums">{formatCurrency(svc.amount)}</span>
                      </div>
                      <Progress value={(svc.amount / data.monthToDate) * 100} className="h-1 rounded-none bg-muted" />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      </div>

      {/* Cost by API Name (per-app) */}
      <div className="bg-card border border-border shadow-sm flex flex-col">
        <div className="flex items-center justify-between p-2 border-b border-border bg-card">
          <h2 className="text-sm font-semibold px-2">Cost by API Name</h2>
          <span className="text-[11px] text-muted-foreground pr-2">
            {formatCurrency(data.apiUsage.cost)} of {formatCurrency(data.monthToDate)} MTD
            <span className="mx-1">·</span>
            {formatCurrency(data.apiUsage.costPerMillion)}/M calls
          </span>
        </div>
        <div className="overflow-x-auto">
          <Table className="text-[13px]">
            <TableHeader className="bg-muted/50 hover:bg-muted/50 border-b border-border">
              <TableRow className="hover:bg-transparent">
                <TableHead className="h-8 font-semibold text-foreground">API Name</TableHead>
                <TableHead className="h-8 font-semibold text-foreground text-right w-[160px]">Calls (MTD)</TableHead>
                <TableHead className="h-8 font-semibold text-foreground text-right w-[120px]">Cost</TableHead>
                <TableHead className="h-8 font-semibold text-foreground w-[160px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.apiUsage.byApi?.map((row, idx) => {
                const maxCost = data.apiUsage.byApi[0]?.cost || 1;
                return (
                  <TableRow key={`${row.name}-${idx}`} className="h-8 border-b border-border/50 hover:bg-muted/40">
                    <TableCell className="py-1 font-mono text-[12px] font-medium">{row.name}</TableCell>
                    <TableCell className="py-1 text-right font-mono text-[12px] tabular-nums text-muted-foreground">
                      {new Intl.NumberFormat("en-US").format(row.totalCalls)}
                    </TableCell>
                    <TableCell className="py-1 text-right font-mono text-[12px] tabular-nums">
                      {formatCurrency(row.cost)}
                    </TableCell>
                    <TableCell className="py-1">
                      <Progress value={(row.cost / maxCost) * 100} className="h-1.5 rounded-none bg-muted" />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}

function LedgerTab({ appId }: { appId: string }) {
  const { data, isLoading } = useGetLedger(appId, { query: { enabled: !!appId, queryKey: getGetLedgerQueryKey(appId) } });
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const stripeSyncEnabled = appId === "grailbabe";
  const syncStripe = useSyncStripeSales({
    mutation: {
      onSuccess: (result) => {
        queryClient.invalidateQueries({ queryKey: getGetLedgerQueryKey(appId) });
        toast({
          title: "Stripe sync complete",
          description: `${result.imported} imported, ${result.alreadyRecorded} already recorded, ${result.skipped} skipped. Net ${new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(result.net)}.`,
        });
      },
      onError: () => {
        toast({
          title: "Stripe sync failed",
          description: "Could not import Stripe charges. Check the server logs.",
          variant: "destructive",
        });
      },
    },
  });

  if (isLoading) return <Skeleton className="h-64 w-full" />;
  if (!data) return <div className="text-muted-foreground">No ledger data available</div>;

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: data.currency }).format(amount);

  const accountName = (code: string) =>
    data.accounts.find((a) => a.code === code)?.name ?? code;

  const recStatusClass =
    data.reconciliation.status === "reconciled"
      ? "text-[#7FBA00]"
      : data.reconciliation.status === "discrepancy"
        ? "text-destructive"
        : "text-amber-500";

  const txStatusClass = (status: string) =>
    status === "posted"
      ? "text-[#7FBA00]"
      : status === "failed"
        ? "text-destructive"
        : "text-amber-500";

  return (
    <div className="space-y-4">
      {/* Summary tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <div className="bg-card border border-border p-3 shadow-sm flex flex-col justify-between">
          <div className="text-[12px] text-muted-foreground font-medium mb-1">Settlement Position</div>
          <div className="text-xl font-semibold tabular-nums">{formatCurrency(data.totalBalance)}</div>
        </div>
        <div className="bg-card border border-border p-3 shadow-sm flex flex-col justify-between">
          <div className="text-[12px] text-muted-foreground font-medium mb-1">Reconciliation</div>
          <div className={`text-xl font-semibold capitalize ${recStatusClass}`}>{data.reconciliation.status}</div>
          <div className="text-[11px] text-muted-foreground mt-0.5">
            Last run {format(new Date(data.reconciliation.lastReconciledAt), "MM/dd HH:mm")}
          </div>
        </div>
        <div className="bg-card border border-border p-3 shadow-sm flex flex-col justify-between">
          <div className="text-[12px] text-muted-foreground font-medium mb-1">Unreconciled Entries</div>
          <div className="text-xl font-semibold tabular-nums">{data.reconciliation.unreconciledCount}</div>
        </div>
        <div className="bg-card border border-border p-3 shadow-sm flex flex-col justify-between">
          <div className="text-[12px] text-muted-foreground font-medium mb-1">Unreconciled Amount</div>
          <div className="text-xl font-semibold tabular-nums">{formatCurrency(data.reconciliation.unreconciledAmount)}</div>
        </div>
      </div>

      {/* Revenue & platform fees */}
      <div className="bg-card border border-border shadow-sm flex flex-col">
        <div className="flex items-center justify-between p-3 border-b border-border bg-card">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-semibold">Revenue &amp; Platform Fees</h2>
            {stripeSyncEnabled && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-[12px]"
                onClick={() => syncStripe.mutate({ appId })}
                disabled={syncStripe.isPending}
              >
                <RefreshCw className={`h-3.5 w-3.5 mr-1 ${syncStripe.isPending ? "animate-spin" : ""}`} />
                {syncStripe.isPending ? "Syncing Stripe…" : "Sync Stripe"}
              </Button>
            )}
          </div>
          <div className="flex items-center gap-4 text-[12px]">
            <div className="text-right">
              <span className="text-muted-foreground mr-1">Gross</span>
              <span className="font-semibold tabular-nums">{formatCurrency(data.revenue.grossRevenue)}</span>
            </div>
            <div className="text-right">
              <span className="text-muted-foreground mr-1">Fees</span>
              <span className="font-semibold tabular-nums text-destructive">−{formatCurrency(data.revenue.platformFees)}</span>
            </div>
            <div className="text-right">
              <span className="text-muted-foreground mr-1">Net</span>
              <span className="font-semibold tabular-nums text-[#7FBA00]">{formatCurrency(data.revenue.netRevenue)}</span>
            </div>
          </div>
        </div>
        <div className="overflow-x-auto">
          <Table className="text-[13px]">
            <TableHeader className="bg-muted/50 hover:bg-muted/50 border-b border-border">
              <TableRow className="hover:bg-transparent h-8">
                <TableHead className="font-semibold text-foreground">Platform</TableHead>
                <TableHead className="font-semibold text-foreground text-right w-[90px]">Fee Rate</TableHead>
                <TableHead className="font-semibold text-foreground text-right w-[120px]">Gross</TableHead>
                <TableHead className="font-semibold text-foreground text-right w-[120px]">Platform Fee</TableHead>
                <TableHead className="font-semibold text-foreground text-right w-[120px]">Net Cash</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.revenue.bySource.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-6 text-muted-foreground">
                    No revenue recorded for this app.
                  </TableCell>
                </TableRow>
              ) : (
                data.revenue.bySource.map((r) => (
                  <TableRow key={r.source} className="h-8 border-b border-border/50 hover:bg-muted/40">
                    <TableCell className="py-1.5 font-medium">{r.label}</TableCell>
                    <TableCell className="py-1.5 text-right tabular-nums text-muted-foreground">
                      {r.feeRate > 0 ? `${(r.feeRate * 100).toFixed(0)}%` : "—"}
                    </TableCell>
                    <TableCell className="py-1.5 text-right tabular-nums font-mono">{formatCurrency(r.gross)}</TableCell>
                    <TableCell className="py-1.5 text-right tabular-nums font-mono text-destructive">
                      {r.fee > 0 ? `−${formatCurrency(r.fee)}` : formatCurrency(0)}
                    </TableCell>
                    <TableCell className="py-1.5 text-right tabular-nums font-mono">{formatCurrency(r.net)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Account balances */}
        <div className="lg:col-span-1 bg-card border border-border shadow-sm flex flex-col">
          <div className="p-3 border-b border-border bg-card">
            <h2 className="text-sm font-semibold">Account Balances</h2>
          </div>
          <div className="p-0">
            <Table className="text-[12px]">
              <TableHeader className="bg-muted/50 border-b border-border">
                <TableRow className="hover:bg-transparent h-8">
                  <TableHead className="font-semibold text-foreground">Account</TableHead>
                  <TableHead className="font-semibold text-foreground text-right w-[110px]">Balance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.accounts.map((acct) => (
                  <TableRow key={acct.code} className="h-8 hover:bg-muted/40 border-b border-border/50">
                    <TableCell className="py-2">
                      <div className="font-medium">{acct.name}</div>
                      <div className="text-[10px] text-muted-foreground mt-0.5">
                        <span className="font-mono">{acct.code}</span>
                        <span className="mx-1">·</span>
                        <span className="capitalize">{acct.type}</span>
                      </div>
                    </TableCell>
                    <TableCell className="py-2 text-right tabular-nums font-mono">{formatCurrency(acct.balance)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>

        {/* Recent transactions */}
        <div className="lg:col-span-2 bg-card border border-border shadow-sm flex flex-col">
          <div className="p-3 border-b border-border bg-card">
            <h2 className="text-sm font-semibold">Recent Journal Entries</h2>
          </div>
          <div className="overflow-x-auto">
            <Table className="text-[13px]">
              <TableHeader className="bg-muted/50 hover:bg-muted/50 border-b border-border">
                <TableRow className="hover:bg-transparent h-8">
                  <TableHead className="font-semibold text-foreground w-[120px]">Posted</TableHead>
                  <TableHead className="font-semibold text-foreground">Description</TableHead>
                  <TableHead className="font-semibold text-foreground">Debit → Credit</TableHead>
                  <TableHead className="font-semibold text-foreground text-right w-[110px]">Amount</TableHead>
                  <TableHead className="font-semibold text-foreground w-[80px]">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.transactions.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-6 text-muted-foreground">
                      No ledger activity for this app.
                    </TableCell>
                  </TableRow>
                ) : (
                  data.transactions.map((tx) => (
                    <TableRow key={tx.id} className="h-8 border-b border-border/50 hover:bg-muted/40">
                      <TableCell className="py-1 text-xs text-muted-foreground whitespace-nowrap">
                        {format(new Date(tx.postedAt), "MM/dd HH:mm")}
                      </TableCell>
                      <TableCell className="py-1 font-medium text-[13px]">{tx.description}</TableCell>
                      <TableCell className="py-1 text-[11px] text-muted-foreground">
                        <span className="font-mono">{tx.debitAccount}</span> {accountName(tx.debitAccount)}
                        <span className="mx-1">→</span>
                        <span className="font-mono">{tx.creditAccount}</span> {accountName(tx.creditAccount)}
                      </TableCell>
                      <TableCell className="py-1 text-right font-mono tabular-nums">{formatCurrency(tx.amount)}</TableCell>
                      <TableCell className="py-1">
                        <span className={`text-xs capitalize ${txStatusClass(tx.status)}`}>{tx.status}</span>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      </div>
    </div>
  );
}

function AlertsTab({ appId }: { appId: string }) {
  const { mode } = useAuth();
  const queryKey = getGetAppAlertsQueryKey(appId);
  const { data: alerts, isLoading } = useGetAppAlerts(appId, undefined, { query: { enabled: !!appId, queryKey } });
  const { isRefreshing, forceRefresh } = useForceRefresh(`/api/apps/${appId}/alerts`, queryKey);

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="bg-card border border-border shadow-sm flex flex-col">
      <div className="flex items-center justify-between p-2 border-b border-border bg-card">
        <h2 className="text-sm font-semibold px-2">Alert Rules</h2>
        {isLiveMode(mode) && (
          <ForceRefreshButton isRefreshing={isRefreshing} onRefresh={forceRefresh} />
        )}
      </div>
      <div className="overflow-x-auto">
        <Table className="text-[13px]">
          <TableHeader className="bg-muted/50 hover:bg-muted/50 border-b border-border">
            <TableRow className="hover:bg-transparent h-8">
              <TableHead className="font-semibold text-foreground w-[120px]">Fired At</TableHead>
              <TableHead className="font-semibold text-foreground w-[100px]">Severity</TableHead>
              <TableHead className="font-semibold text-foreground">Alert Rule</TableHead>
              <TableHead className="font-semibold text-foreground">Signal</TableHead>
              <TableHead className="font-semibold text-foreground">State</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {alerts?.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-6 text-muted-foreground">
                  No active alerts.
                </TableCell>
              </TableRow>
            ) : (
              alerts?.map((alert) => (
                <TableRow key={alert.id} className="h-8 border-b border-border/50 hover:bg-muted/40">
                  <TableCell className="py-1 text-xs text-muted-foreground whitespace-nowrap">
                    {format(new Date(alert.firedAt), "MM/dd/yyyy HH:mm")}
                  </TableCell>
                  <TableCell className="py-1">
                    <StatusBadge status={alert.severity} />
                  </TableCell>
                  <TableCell className="py-1 font-medium text-[13px]">
                    {alert.title}
                  </TableCell>
                  <TableCell className="py-1 text-muted-foreground">
                    {alert.source}
                  </TableCell>
                  <TableCell className="py-1">
                    <span className="text-xs capitalize">{alert.status}</span>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
