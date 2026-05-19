import { useGetGlobalCostSummary } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { Link } from "wouter";
import { Download, PieChart, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function Cost() {
  const { data: cost, isLoading } = useGetGlobalCostSummary();

  const formatCurrency = (amount: number, currency: string) => {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
  };

  const budgetPercent = cost ? (cost.monthToDate / cost.budget) * 100 : 0;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-foreground tracking-tight">Cost Management & Billing</h1>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
        <Tile
          title="Actual cost (MTD)"
          value={isLoading ? null : (cost ? formatCurrency(cost.monthToDate, cost.currency) : "$0.00")}
        />
        <Tile
          title="Forecasted cost"
          value={isLoading ? null : (cost ? formatCurrency(cost.forecast, cost.currency) : "$0.00")}
        />

        <div className="bg-card border border-border p-3 shadow-sm flex flex-col justify-between">
          <div className="text-[12px] text-muted-foreground font-medium mb-1">API usage (MTD)</div>
          {isLoading ? <Skeleton className="h-7 w-20 mt-1" /> : (
            <>
              <div className="text-xl font-semibold text-foreground mt-1 tabular-nums">
                {formatCurrency(cost?.apiCost || 0, cost?.currency || "USD")}
              </div>
              <div className="text-[11px] text-muted-foreground tabular-nums mt-0.5">
                {new Intl.NumberFormat("en-US").format(cost?.apiCalls || 0)} calls across all apps
              </div>
            </>
          )}
        </div>

        <div className="bg-card border border-border p-3 shadow-sm flex flex-col justify-between">
          <div className="text-[12px] text-muted-foreground font-medium mb-1">Budget utilization</div>
          {isLoading ? <Skeleton className="h-7 w-full mt-1" /> : (
            <div className="space-y-1 mt-1">
              <div className="flex justify-between text-[11px]">
                <span className="font-semibold text-foreground tabular-nums">{formatCurrency(cost?.monthToDate || 0, cost?.currency || "USD")}</span>
                <span className="text-muted-foreground tabular-nums">{formatCurrency(cost?.budget || 0, cost?.currency || "USD")}</span>
              </div>
              <Progress value={budgetPercent} className="h-1.5 rounded-none bg-muted" />
            </div>
          )}
        </div>
      </div>

      <div className="bg-card border border-border shadow-sm flex flex-col">
        {/* Action Toolbar */}
        <div className="flex items-center justify-between p-2 border-b border-border bg-card">
          <h2 className="text-sm font-semibold px-2">Cost by Application</h2>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" className="h-7 text-xs px-2 rounded-sm text-primary hover:text-primary hover:bg-primary/10">
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
              Refresh
            </Button>
            <Button variant="ghost" size="sm" className="h-7 text-xs px-2 rounded-sm text-primary hover:text-primary hover:bg-primary/10">
              <PieChart className="h-3.5 w-3.5 mr-1.5" />
              View Chart
            </Button>
            <Button variant="ghost" size="sm" className="h-7 text-xs px-2 rounded-sm text-primary hover:text-primary hover:bg-primary/10">
              <Download className="h-3.5 w-3.5 mr-1.5" />
              Download CSV
            </Button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <Table className="text-[13px]">
            <TableHeader className="bg-muted/50 hover:bg-muted/50 border-b border-border">
              <TableRow className="hover:bg-transparent">
                <TableHead className="h-8 font-semibold text-foreground">Resource Name</TableHead>
                <TableHead className="h-8 font-semibold text-foreground text-right w-[150px]">Cost</TableHead>
                <TableHead className="h-8 font-semibold text-foreground w-[200px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <TableRow key={i} className="h-8 border-b border-border/50">
                    <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-20 ml-auto" /></TableCell>
                    <TableCell><Skeleton className="h-2 w-full" /></TableCell>
                  </TableRow>
                ))
              ) : cost?.byApp.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="text-center py-6 text-muted-foreground">No cost data available</TableCell>
                </TableRow>
              ) : (
                cost?.byApp.map((item) => (
                  <TableRow key={item.appId} className="h-8 border-b border-border/50 hover:bg-muted/40">
                    <TableCell className="py-1 font-medium">
                      <Link href={`/apps/${item.appId}`} className="hover:underline text-primary">
                        {item.appName}
                      </Link>
                    </TableCell>
                    <TableCell className="py-1 text-right font-mono text-[12px]">
                      {formatCurrency(item.amount, cost.currency)}
                    </TableCell>
                    <TableCell className="py-1">
                      <Progress value={(item.amount / cost.monthToDate) * 100} className="h-1.5 rounded-none bg-muted" />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Cost by Resource (aggregated across apps) */}
        <div className="bg-card border border-border shadow-sm flex flex-col">
          <div className="flex items-center justify-between p-2 border-b border-border bg-card">
            <h2 className="text-sm font-semibold px-2">Cost by Resource</h2>
            <span className="text-[11px] text-muted-foreground pr-2">Aggregated across all apps</span>
          </div>
          <div className="overflow-x-auto">
            <Table className="text-[13px]">
              <TableHeader className="bg-muted/50 hover:bg-muted/50 border-b border-border">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="h-8 font-semibold text-foreground">Resource Type</TableHead>
                  <TableHead className="h-8 font-semibold text-foreground text-right w-[130px]">Cost (MTD)</TableHead>
                  <TableHead className="h-8 font-semibold text-foreground w-[160px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 4 }).map((_, i) => (
                    <TableRow key={i} className="h-8 border-b border-border/50">
                      <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-20 ml-auto" /></TableCell>
                      <TableCell><Skeleton className="h-2 w-full" /></TableCell>
                    </TableRow>
                  ))
                ) : (
                  cost?.byResource?.map((item) => (
                    <TableRow key={item.service} className="h-8 border-b border-border/50 hover:bg-muted/40">
                      <TableCell className="py-1 font-medium">{item.service}</TableCell>
                      <TableCell className="py-1 text-right font-mono text-[12px]">
                        {formatCurrency(item.amount, cost.currency)}
                      </TableCell>
                      <TableCell className="py-1">
                        <Progress value={(item.amount / (cost?.monthToDate || 1)) * 100} className="h-1.5 rounded-none bg-muted" />
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>

        {/* API usage by App (totals) */}
        <div className="bg-card border border-border shadow-sm flex flex-col">
          <div className="flex items-center justify-between p-2 border-b border-border bg-card">
            <h2 className="text-sm font-semibold px-2">API Usage by Application</h2>
            <span className="text-[11px] text-muted-foreground pr-2">
              {cost ? `${formatCurrency(cost.apiCost, cost.currency)} of ${formatCurrency(cost.monthToDate, cost.currency)} MTD` : ""}
            </span>
          </div>
          <div className="overflow-x-auto">
            <Table className="text-[13px]">
              <TableHeader className="bg-muted/50 hover:bg-muted/50 border-b border-border">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="h-8 font-semibold text-foreground">Application</TableHead>
                  <TableHead className="h-8 font-semibold text-foreground text-right w-[140px]">Calls (MTD)</TableHead>
                  <TableHead className="h-8 font-semibold text-foreground text-right w-[110px]">Unit ($/M)</TableHead>
                  <TableHead className="h-8 font-semibold text-foreground text-right w-[110px]">Cost</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i} className="h-8 border-b border-border/50">
                      <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-20 ml-auto" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-16 ml-auto" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-16 ml-auto" /></TableCell>
                    </TableRow>
                  ))
                ) : (
                  cost?.apiByApp?.map((row) => (
                    <TableRow key={row.appId} className="h-8 border-b border-border/50 hover:bg-muted/40">
                      <TableCell className="py-1 font-medium">
                        <Link href={`/apps/${row.appId}`} className="hover:underline text-primary">
                          {row.appName}
                        </Link>
                      </TableCell>
                      <TableCell className="py-1 text-right font-mono text-[12px] tabular-nums">
                        {new Intl.NumberFormat("en-US").format(row.totalCalls)}
                      </TableCell>
                      <TableCell className="py-1 text-right font-mono text-[12px] tabular-nums text-muted-foreground">
                        {formatCurrency(row.costPerMillion, cost.currency)}
                      </TableCell>
                      <TableCell className="py-1 text-right font-mono text-[12px] tabular-nums">
                        {formatCurrency(row.cost, cost.currency)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      </div>

      {/* Cost by API Name by App (flat) */}
      <div className="bg-card border border-border shadow-sm flex flex-col">
        <div className="flex items-center justify-between p-2 border-b border-border bg-card">
          <h2 className="text-sm font-semibold px-2">Cost by API Name (by Application)</h2>
          <span className="text-[11px] text-muted-foreground pr-2">
            Top {cost?.apiByName?.length ?? 0} endpoints, sorted by cost
          </span>
        </div>
        <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
          <Table className="text-[13px]">
            <TableHeader className="bg-muted/50 hover:bg-muted/50 border-b border-border sticky top-0 z-10">
              <TableRow className="hover:bg-transparent">
                <TableHead className="h-8 font-semibold text-foreground w-[180px]">Application</TableHead>
                <TableHead className="h-8 font-semibold text-foreground">API Name</TableHead>
                <TableHead className="h-8 font-semibold text-foreground text-right w-[160px]">Calls (MTD)</TableHead>
                <TableHead className="h-8 font-semibold text-foreground text-right w-[120px]">Cost</TableHead>
                <TableHead className="h-8 font-semibold text-foreground w-[140px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <TableRow key={i} className="h-8 border-b border-border/50">
                    <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-40" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-20 ml-auto" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-16 ml-auto" /></TableCell>
                    <TableCell><Skeleton className="h-2 w-full" /></TableCell>
                  </TableRow>
                ))
              ) : (
                cost?.apiByName?.map((row, idx) => {
                  const maxCost = cost.apiByName[0]?.cost || 1;
                  return (
                    <TableRow key={`${row.appId}-${row.apiName}-${idx}`} className="h-8 border-b border-border/50 hover:bg-muted/40">
                      <TableCell className="py-1 font-medium">
                        <Link href={`/apps/${row.appId}`} className="hover:underline text-primary">
                          {row.appName}
                        </Link>
                      </TableCell>
                      <TableCell className="py-1 font-mono text-[12px] text-foreground">{row.apiName}</TableCell>
                      <TableCell className="py-1 text-right font-mono text-[12px] tabular-nums text-muted-foreground">
                        {new Intl.NumberFormat("en-US").format(row.totalCalls)}
                      </TableCell>
                      <TableCell className="py-1 text-right font-mono text-[12px] tabular-nums">
                        {formatCurrency(row.cost, cost.currency)}
                      </TableCell>
                      <TableCell className="py-1">
                        <Progress value={(row.cost / maxCost) * 100} className="h-1.5 rounded-none bg-muted" />
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}

function Tile({ title, value }: { title: string; value: React.ReactNode }) {
  return (
    <div className="bg-card border border-border p-3 shadow-sm flex flex-col justify-between">
      <div className="text-[12px] text-muted-foreground font-medium mb-1 truncate">{title}</div>
      {value === null ? (
        <Skeleton className="h-7 w-20 mt-1" />
      ) : (
        <div className="text-xl font-semibold text-foreground mt-1 tabular-nums">{value}</div>
      )}
    </div>
  );
}
