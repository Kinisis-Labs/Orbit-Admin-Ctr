import { useMemo } from "react";
import { useListApps } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { PageHeader, StatusPill } from "@/components/page-header";
import { CostTabs } from "@/components/cost-tabs";

type BudgetStatus = "Healthy" | "Warning" | "Breach";

const TONE: Record<BudgetStatus, "ok" | "warn" | "bad"> = {
  Healthy: "ok",
  Warning: "warn",
  Breach: "bad",
};

const fmt = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

type BudgetRow = {
  appId: string;
  appName: string;
  environment: string;
  budget: number;
  spent: number;
  forecast: number;
  status: BudgetStatus;
  budgetSource: "live" | "estimated";
};

function buildBudgetRows(
  apps: Array<{ id: string; name: string; environment: string; monthToDateCost: number; budget?: number; forecast?: number }>,
): BudgetRow[] {
  return apps.map((app) => {
    const spent = app.monthToDateCost;
    const budget = app.budget ?? Number((spent * 2.0).toFixed(2));
    const forecast = app.forecast ?? Number((spent * 1.7).toFixed(2));
    const budgetSource: "live" | "estimated" = app.budget !== undefined ? "live" : "estimated";
    const status: BudgetStatus =
      forecast > budget ? "Breach" : spent > budget * 0.8 ? "Warning" : "Healthy";
    return { appId: app.id, appName: app.name, environment: app.environment, budget, spent, forecast, status, budgetSource };
  });
}

export default function Budgets() {
  const { data: apps, isLoading } = useListApps();
  const rows = useMemo<BudgetRow[]>(() => (apps ? buildBudgetRows(apps) : []), [apps]);

  return (
    <div className="space-y-4">
      <PageHeader title="Cost Management & Billing" subtitle="Budgets configured per Kinisis application" />
      <CostTabs />

      <div className="bg-card border border-border shadow-sm">
        <div className="p-2 border-b border-border"><h2 className="text-sm font-semibold px-2">Per-application budgets</h2></div>
        {isLoading ? (
          <div className="p-4 space-y-2"><Skeleton className="h-8" /><Skeleton className="h-8" /></div>
        ) : (
          <Table className="text-[13px]">
            <TableHeader className="bg-muted/50 hover:bg-muted/50 border-b border-border">
              <TableRow className="hover:bg-transparent">
                <TableHead className="h-8 font-semibold text-foreground">Application</TableHead>
                <TableHead className="h-8 font-semibold text-foreground">Env</TableHead>
                <TableHead className="h-8 font-semibold text-foreground text-right">Budget (mo)</TableHead>
                <TableHead className="h-8 font-semibold text-foreground text-right">Spent MTD</TableHead>
                <TableHead className="h-8 font-semibold text-foreground text-right">Forecast EOM</TableHead>
                <TableHead className="h-8 font-semibold text-foreground">Burn</TableHead>
                <TableHead className="h-8 font-semibold text-foreground">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const pct = Math.min(100, (r.spent / r.budget) * 100);
                return (
                  <TableRow key={r.appId} className="h-8 border-b border-border/50 hover:bg-muted/40">
                    <TableCell className="py-1 font-medium text-primary">{r.appName}</TableCell>
                    <TableCell className="py-1 text-muted-foreground">{r.environment}</TableCell>
                    <TableCell className="py-1 text-right tabular-nums">
                      <span>{fmt(r.budget)}</span>
                      {r.budgetSource === "estimated" && (
                        <span className="ml-1 text-[10px] text-muted-foreground italic">est.</span>
                      )}
                    </TableCell>
                    <TableCell className="py-1 text-right tabular-nums">{fmt(r.spent)}</TableCell>
                    <TableCell className={`py-1 text-right tabular-nums ${r.forecast > r.budget ? "text-destructive font-medium" : ""}`}>{fmt(r.forecast)}</TableCell>
                    <TableCell className="py-1">
                      <div className="flex items-center gap-2">
                        <Progress value={pct} className="h-1.5 rounded-none bg-muted w-32" />
                        <span className="text-[11px] tabular-nums text-muted-foreground w-10">{pct.toFixed(0)}%</span>
                      </div>
                    </TableCell>
                    <TableCell className="py-1"><StatusPill tone={TONE[r.status]}>{r.status}</StatusPill></TableCell>
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
