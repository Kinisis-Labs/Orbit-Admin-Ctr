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
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { format } from "date-fns";
import { 
  LineChart, Line, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend 
} from "recharts";

export default function AppDetail() {
  const params = useParams();
  const appId = params.appId!;

  const { data: app, isLoading: appLoading } = useGetApp(appId, { query: { enabled: !!appId, queryKey: getGetAppQueryKey(appId) } });

  if (appLoading) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-10 w-1/3" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (!app) {
    return (
      <div className="p-6">
        <div className="text-center py-12">
          <h2 className="text-xl font-bold">Application Not Found</h2>
          <p className="text-muted-foreground mt-2">Could not find details for this application.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-bold tracking-tight">{app.name}</h1>
          <StatusBadge status={app.status} className="text-sm px-2.5 py-0.5" />
        </div>
        <p className="text-muted-foreground">{app.description}</p>
        <div className="flex flex-wrap gap-2 mt-2">
          <Badge variant="outline" className="border-primary/20 text-primary">{app.environment}</Badge>
          <Badge variant="outline">{app.region}</Badge>
          <Badge variant="outline">{app.resourceGroup}</Badge>
        </div>
      </div>

      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="grid w-full max-w-3xl grid-cols-6 mb-6 bg-card border">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="infrastructure">Infra</TabsTrigger>
          <TabsTrigger value="network">Network</TabsTrigger>
          <TabsTrigger value="telemetry">Telemetry</TabsTrigger>
          <TabsTrigger value="cost">Cost</TabsTrigger>
          <TabsTrigger value="alerts">Alerts</TabsTrigger>
        </TabsList>
        
        <TabsContent value="overview" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card className="lg:col-span-1">
              <CardHeader>
                <CardTitle className="text-sm">Metadata</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1">
                  <div className="text-xs text-muted-foreground">ID</div>
                  <div className="font-mono text-xs">{app.id}</div>
                </div>
                <div className="space-y-1">
                  <div className="text-xs text-muted-foreground">Subscription</div>
                  <div className="font-mono text-xs">{app.subscriptionId}</div>
                </div>
              </CardContent>
            </Card>

            <Card className="lg:col-span-1">
              <CardHeader>
                <CardTitle className="text-sm">Owners</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col gap-2">
                  {app.owners?.map((owner, i) => (
                    <div key={i} className="text-sm flex items-center gap-2">
                      <div className="h-6 w-6 rounded-full bg-primary/20 flex items-center justify-center text-primary text-xs font-bold">
                        {owner.charAt(0).toUpperCase()}
                      </div>
                      {owner}
                    </div>
                  ))}
                  {!app.owners?.length && <span className="text-sm text-muted-foreground">No owners listed</span>}
                </div>
              </CardContent>
            </Card>

            <Card className="lg:col-span-1">
              <CardHeader>
                <CardTitle className="text-sm">Tags</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(app.tags || {}).map(([key, val]) => (
                    <Badge key={key} variant="secondary" className="font-mono text-xs font-normal">
                      <span className="text-muted-foreground mr-1">{key}:</span> <span className="text-foreground">{val}</span>
                    </Badge>
                  ))}
                  {Object.keys(app.tags || {}).length === 0 && (
                    <span className="text-sm text-muted-foreground">No tags</span>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
        
        <TabsContent value="infrastructure" className="space-y-4">
          <InfraTab appId={appId} />
        </TabsContent>

        <TabsContent value="network" className="space-y-4">
          <NetworkTab appId={appId} />
        </TabsContent>

        <TabsContent value="telemetry" className="space-y-4">
          <TelemetryTab appId={appId} />
        </TabsContent>

        <TabsContent value="cost" className="space-y-4">
          <CostTab appId={appId} />
        </TabsContent>

        <TabsContent value="alerts" className="space-y-4">
          <AlertsTab appId={appId} />
        </TabsContent>
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
      <Card className="lg:col-span-1">
        <CardHeader>
          <CardTitle className="text-sm font-medium">Resources</CardTitle>
          <CardDescription>Provisioned cloud resources</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {data.resources.map(res => (
              <div key={res.id} className="flex items-start justify-between p-3 border border-border/50 bg-muted/20 rounded-md">
                <div className="space-y-1">
                  <div className="font-medium text-sm flex items-center gap-2">
                    {res.name}
                  </div>
                  <div className="text-xs text-muted-foreground">{res.type} • {res.location}</div>
                  <StatusBadge status={res.status} className="mt-1" />
                </div>
                <div className="text-right text-xs space-y-1.5 min-w-[80px]">
                  {res.cpuPercent !== undefined && (
                    <div className="space-y-1">
                      <div className="flex justify-between text-muted-foreground"><span>CPU</span> <span>{res.cpuPercent}%</span></div>
                      <Progress value={res.cpuPercent} className="h-1" />
                    </div>
                  )}
                  {res.memoryPercent !== undefined && (
                    <div className="space-y-1 mt-2">
                      <div className="flex justify-between text-muted-foreground"><span>Mem</span> <span>{res.memoryPercent}%</span></div>
                      <Progress value={res.memoryPercent} className="h-1" />
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="text-sm font-medium">Metrics</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {data.series.map((s, i) => (
            <div key={i} className="h-64">
              <h4 className="text-xs font-semibold mb-4 text-muted-foreground">{s.name} ({s.unit})</h4>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={s.points}>
                  <defs>
                    <linearGradient id={`color${i}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--color-primary)" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="var(--color-primary)" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-border)" opacity={0.5} />
                  <XAxis dataKey="timestamp" tickFormatter={(v) => format(new Date(v), "HH:mm")} stroke="var(--color-muted-foreground)" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis stroke="var(--color-muted-foreground)" fontSize={12} tickLine={false} axisLine={false} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: 'var(--color-card)', borderColor: 'var(--color-border)', borderRadius: '6px' }}
                    labelFormatter={(v) => format(new Date(v), "PPp")}
                  />
                  <Area type="monotone" dataKey="value" stroke="var(--color-primary)" fillOpacity={1} fill={`url(#color${i})`} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function NetworkTab({ appId }: { appId: string }) {
  const { data, isLoading } = useGetNetwork(appId, { query: { enabled: !!appId, queryKey: getGetNetworkQueryKey(appId) } });

  if (isLoading) return <Skeleton className="h-64 w-full" />;
  if (!data) return <div className="text-muted-foreground">No network data available</div>;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <Card className="lg:col-span-1">
        <CardHeader>
          <CardTitle className="text-sm font-medium">Endpoints</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {data.endpoints.map((ep, i) => (
              <div key={i} className="p-3 border border-border/50 bg-muted/20 rounded-md flex flex-col gap-2">
                <div className="flex justify-between items-center">
                  <div className="font-mono text-sm">{ep.name}</div>
                  <StatusBadge status={ep.status} />
                </div>
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{ep.region}</span>
                  <div className="flex gap-3">
                    <span>{ep.latencyMs}ms</span>
                    {ep.packetLossPercent !== undefined && <span>{ep.packetLossPercent}% loss</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
      
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="text-sm font-medium">Throughput</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {data.throughput.map((s, i) => (
            <div key={i} className="h-64">
              <h4 className="text-xs font-semibold mb-4 text-muted-foreground">{s.name} ({s.unit})</h4>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={s.points}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-border)" opacity={0.5} />
                  <XAxis dataKey="timestamp" tickFormatter={(v) => format(new Date(v), "HH:mm")} stroke="var(--color-muted-foreground)" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis stroke="var(--color-muted-foreground)" fontSize={12} tickLine={false} axisLine={false} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: 'var(--color-card)', borderColor: 'var(--color-border)', borderRadius: '6px' }}
                    labelFormatter={(v) => format(new Date(v), "PPp")}
                  />
                  <Line type="monotone" dataKey="value" stroke="var(--color-primary)" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function TelemetryTab({ appId }: { appId: string }) {
  const { data, isLoading } = useGetTelemetry(appId, { query: { enabled: !!appId, queryKey: getGetTelemetryQueryKey(appId) } });

  if (isLoading) return <Skeleton className="h-64 w-full" />;
  if (!data) return <div className="text-muted-foreground">No telemetry data available</div>;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground mb-1">Requests / Min</div>
            <div className="text-2xl font-bold">{data.requestsPerMin.toLocaleString()}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground mb-1">P95 Latency</div>
            <div className="text-2xl font-bold">{data.p95LatencyMs}ms</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground mb-1">Error Rate</div>
            <div className="text-2xl font-bold">{data.errorRatePercent}%</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground mb-1">Availability</div>
            <div className="text-2xl font-bold text-emerald-500">{data.availabilityPercent}%</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-sm font-medium">Application Metrics</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {data.series.map((s, i) => (
              <div key={i} className="h-64">
                <h4 className="text-xs font-semibold mb-4 text-muted-foreground">{s.name} ({s.unit})</h4>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={s.points}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-border)" opacity={0.5} />
                    <XAxis dataKey="timestamp" tickFormatter={(v) => format(new Date(v), "HH:mm")} stroke="var(--color-muted-foreground)" fontSize={12} tickLine={false} axisLine={false} />
                    <YAxis stroke="var(--color-muted-foreground)" fontSize={12} tickLine={false} axisLine={false} />
                    <Tooltip 
                      contentStyle={{ backgroundColor: 'var(--color-card)', borderColor: 'var(--color-border)', borderRadius: '6px' }}
                      labelFormatter={(v) => format(new Date(v), "PPp")}
                    />
                    <Line type="monotone" dataKey="value" stroke="var(--color-chart-2)" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ))}
          </CardContent>
        </Card>
        
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-sm font-medium">Top Errors</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {data.topErrors.map((err, i) => (
                <div key={i} className="text-sm">
                  <div className="font-mono text-xs text-destructive mb-1 break-all line-clamp-2">{err.message}</div>
                  <div className="flex justify-between text-muted-foreground text-[10px]">
                    <span>Seen {err.count} times</span>
                    <span>Last: {format(new Date(err.lastSeen), "MMM d, HH:mm")}</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
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
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground mb-1">MTD Cost</div>
            <div className="text-2xl font-bold">{formatCurrency(data.monthToDate)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground mb-1">Forecast</div>
            <div className="text-2xl font-bold">{formatCurrency(data.forecast)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground mb-1">Budget</div>
            <div className="text-2xl font-bold">{formatCurrency(data.budget)}</div>
            <Progress value={(data.monthToDate / data.budget) * 100} className="h-1 mt-2" />
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-sm font-medium">Daily Spend</CardTitle>
          </CardHeader>
          <CardContent className="h-64">
             <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.daily}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-border)" opacity={0.5} />
                  <XAxis dataKey="timestamp" tickFormatter={(v) => format(new Date(v), "MMM d")} stroke="var(--color-muted-foreground)" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis tickFormatter={(v) => `$${v}`} stroke="var(--color-muted-foreground)" fontSize={12} tickLine={false} axisLine={false} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: 'var(--color-card)', borderColor: 'var(--color-border)', borderRadius: '6px' }}
                    labelFormatter={(v) => format(new Date(v), "PP")}
                    formatter={(v: number) => [formatCurrency(v), 'Cost']}
                  />
                  <Bar dataKey="value" fill="var(--color-primary)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-sm font-medium">By Service</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {data.byService.map((svc, i) => (
                <div key={i}>
                  <div className="flex justify-between text-sm mb-1">
                    <span>{svc.service}</span>
                    <span className="font-mono">{formatCurrency(svc.amount)}</span>
                  </div>
                  <Progress value={(svc.amount / data.monthToDate) * 100} className="h-1.5" />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function AlertsTab({ appId }: { appId: string }) {
  const { data: alerts, isLoading } = useGetAppAlerts(appId, { query: { enabled: !!appId, queryKey: getGetAppAlertsQueryKey(appId) } });

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  return (
    <Card>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="px-4">Time</TableHead>
              <TableHead>Severity</TableHead>
              <TableHead>Title</TableHead>
              <TableHead>Source</TableHead>
              <TableHead className="px-4 text-right">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {alerts?.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                  No active alerts.
                </TableCell>
              </TableRow>
            ) : (
              alerts?.map((alert) => (
                <TableRow key={alert.id}>
                  <TableCell className="px-4 text-xs text-muted-foreground whitespace-nowrap">
                    {format(new Date(alert.firedAt), "MMM d, HH:mm")}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={alert.severity} />
                  </TableCell>
                  <TableCell className="font-medium text-sm">
                    {alert.title}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="text-[10px]">{alert.source}</Badge>
                  </TableCell>
                  <TableCell className="px-4 text-right">
                    <span className="text-xs capitalize">{alert.status}</span>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
