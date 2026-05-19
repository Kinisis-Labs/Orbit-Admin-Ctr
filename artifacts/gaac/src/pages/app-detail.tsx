import { useParams } from "wouter";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  useGetApp, getGetAppQueryKey, 
  useGetInfrastructure, getGetInfrastructureQueryKey, 
  useGetNetwork, getGetNetworkQueryKey, 
  useGetCost, getGetCostQueryKey, 
  useGetTelemetry, getGetTelemetryQueryKey, 
  useGetAppAlerts, getGetAppAlertsQueryKey 
} from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { format } from "date-fns";
import { 
  LineChart, Line, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from "recharts";
import { RefreshCw, Play, Square, Settings, Share, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function AppDetail() {
  const params = useParams();
  const appId = params.appId!;

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
          <TabsTrigger value="cost" className="h-10 rounded-none border-b-2 border-transparent px-4 py-2 font-medium text-muted-foreground data-[state=active]:border-primary data-[state=active]:text-foreground data-[state=active]:shadow-none bg-transparent">Cost</TabsTrigger>
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
                </div>
              </div>
            </div>
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
            <CostTab appId={appId} />
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
// Sub-components for tabs
// ----------------------------------------------------------------------

function InfraTab({ appId }: { appId: string }) {
  const { data, isLoading } = useGetInfrastructure(appId, { query: { enabled: !!appId, queryKey: getGetInfrastructureQueryKey(appId) } });

  if (isLoading) return <Skeleton className="h-64 w-full" />;
  if (!data) return <div className="text-muted-foreground">No infrastructure data available</div>;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className="lg:col-span-1 bg-card border border-border shadow-sm flex flex-col">
        <div className="p-3 border-b border-border bg-card">
          <h2 className="text-sm font-semibold">Resources</h2>
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
  const { data, isLoading } = useGetNetwork(appId, { query: { enabled: !!appId, queryKey: getGetNetworkQueryKey(appId) } });

  if (isLoading) return <Skeleton className="h-64 w-full" />;
  if (!data) return <div className="text-muted-foreground">No network data available</div>;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className="lg:col-span-1 bg-card border border-border shadow-sm flex flex-col">
        <div className="p-3 border-b border-border bg-card">
          <h2 className="text-sm font-semibold">Endpoints</h2>
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
  const { data, isLoading } = useGetTelemetry(appId, { query: { enabled: !!appId, queryKey: getGetTelemetryQueryKey(appId) } });

  if (isLoading) return <Skeleton className="h-64 w-full" />;
  if (!data) return <div className="text-muted-foreground">No telemetry data available</div>;

  return (
    <div className="space-y-4">
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
  const { data, isLoading } = useGetCost(appId, { query: { enabled: !!appId, queryKey: getGetCostQueryKey(appId) } });

  if (isLoading) return <Skeleton className="h-64 w-full" />;
  if (!data) return <div className="text-muted-foreground">No cost data available</div>;

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: data.currency }).format(amount);
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <div className="bg-card border border-border p-3 shadow-sm flex flex-col justify-between">
          <div className="text-[12px] text-muted-foreground font-medium mb-1">Accumulated Cost (MTD)</div>
          <div className="text-xl font-semibold tabular-nums">{formatCurrency(data.monthToDate)}</div>
        </div>
        <div className="bg-card border border-border p-3 shadow-sm flex flex-col justify-between">
          <div className="text-[12px] text-muted-foreground font-medium mb-1">Forecast</div>
          <div className="text-xl font-semibold tabular-nums text-muted-foreground">{formatCurrency(data.forecast)}</div>
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
    </div>
  );
}

function AlertsTab({ appId }: { appId: string }) {
  const { data: alerts, isLoading } = useGetAppAlerts(appId, { query: { enabled: !!appId, queryKey: getGetAppAlertsQueryKey(appId) } });

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="bg-card border border-border shadow-sm flex flex-col">
      <div className="flex items-center justify-between p-2 border-b border-border bg-card">
        <h2 className="text-sm font-semibold px-2">Alert Rules</h2>
        <Button variant="ghost" size="sm" className="h-7 text-xs px-2 rounded-sm text-primary hover:text-primary hover:bg-primary/10">
          <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
          Refresh
        </Button>
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
