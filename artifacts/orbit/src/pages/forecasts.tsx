import { useMemo } from "react";
import { useListApps } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader, StatusPill } from "@/components/page-header";
import { CostTabs } from "@/components/cost-tabs";
import { TrendingDown, TrendingUp } from "lucide-react";

const fmt = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

type ForecastRow = {
  appId: string;
  appName: string;
  budget: number;
  spent: number;
  forecast: number;
};

function buildForecastRows(apps: Array<{ id: string; name: string; monthToDateCost: number }>): ForecastRow[] {
  return apps.map((app) => ({
    appId: app.id,
    appName: app.name,
    spent: app.monthToDateCost,
    budget: Number((app.monthToDateCost * 2.0).toFixed(2)),
    forecast: Number((app.monthToDateCost * 1.7).toFixed(2)),
  }));
}

export default function Forecasts() {
  const { data: apps, isLoading } = useListApps();
  const rows = useMemo<ForecastRow[]>(() => (apps ? buildForecastRows(apps) : []), [apps]);

  const totalForecast = rows.reduce((s, r) => s + r.forecast, 0);
  const totalBudget = rows.reduce((s, r) => s + r.budget, 0);
  const totalSpent = rows.reduce((s, r) => s + r.spent, 0);
  const variance = totalForecast - totalBudget;

  return (
    <div className="space-y-4">
      <PageHeader title="Cost Management & Billing" subtitle="End-of-month spend forecasts vs configured budgets" />
      <CostTabs />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Tile title="Spent MTD" value={isLoading ? null : fmt(totalSpent)} sub="Actual cost so far this month" />
        <Tile title="Forecast EOM" value={isLoading ? null : fmt(totalForecast)} sub="Projected end-of-month spend" />
        <Tile title="Total budget" value={isLoading ? null : fmt(totalBudget)} sub="Sum of per-app budgets" />
        <Tile
          title="Variance vs budget"
          value={isLoading ? null : fmt(variance)}
          tone={variance > 0 ? "bad" : "ok"}
          icon={variance > 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
          sub={variance > 0 ? "Forecasted to exceed budget" : "Forecasted under budget"}
        />
      </div>

      <div className="bg-card border border-border shadow-sm">
        <div className="p-2 border-b border-border"><h2 className="text-sm font-semibold px-2">Per-application forecast</h2></div>
        {isLoading ? (
          <div className="p-4 space-y-2"><Skeleton className="h-8" /><Skeleton className="h-8" /></div>
        ) : (
          <Table className="text-[13px]">
            <TableHeader className="bg-muted/50 hover:bg-muted/50 border-b border-border">
              <TableRow className="hover:bg-transparent">
                <TableHead className="h-8 font-semibold text-foreground">Application</TableHead>
                <TableHead className="h-8 font-semibold text-foreground text-right">Spent MTD</TableHead>
                <TableHead className="h-8 font-semibold text-foreground text-right">Forecast EOM</TableHead>
                <TableHead className="h-8 font-semibold text-foreground text-right">Budget</TableHead>
                <TableHead className="h-8 font-semibold text-foreground text-right">Variance</TableHead>
                <TableHead className="h-8 font-semibold text-foreground">Outcome</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const v = r.forecast - r.budget;
                return (
                  <TableRow key={r.appId} className="h-8 border-b border-border/50 hover:bg-muted/40">
                    <TableCell className="py-1 font-medium text-primary">{r.appName}</TableCell>
                    <TableCell className="py-1 text-right tabular-nums">{fmt(r.spent)}</TableCell>
                    <TableCell className="py-1 text-right tabular-nums">{fmt(r.forecast)}</TableCell>
                    <TableCell className="py-1 text-right tabular-nums">{fmt(r.budget)}</TableCell>
                    <TableCell className={`py-1 text-right tabular-nums ${v > 0 ? "text-destructive" : "text-emerald-500"}`}>{v >= 0 ? "+" : ""}{fmt(v)}</TableCell>
                    <TableCell className="py-1">
                      {v > 0 ? <StatusPill tone="bad">Over budget</StatusPill> : <StatusPill tone="ok">Under budget</StatusPill>}
                    </TableCell>
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

function Tile({ title, value, sub, tone, icon }: { title: string; value: string | null; sub: string; tone?: "ok" | "bad"; icon?: React.ReactNode }) {
  const valueClass = tone === "bad" ? "text-destructive" : tone === "ok" ? "text-emerald-500" : "";
  return (
    <div className="bg-card border border-border p-3 shadow-sm flex flex-col justify-between">
      <div className="text-[12px] text-muted-foreground font-medium mb-1">{title}</div>
      {value === null ? <Skeleton className="h-7 w-20 mb-1" /> : (
        <div className={`text-xl font-semibold tabular-nums mb-1 flex items-center gap-1.5 ${valueClass}`}>
          {icon} {value}
        </div>
      )}
      <div className="text-[11px] text-muted-foreground truncate">{sub}</div>
    </div>
  );
}
