import { useMemo } from "react";
import { useListApps } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { PageHeader, StatusPill } from "@/components/page-header";
import { CostTabs } from "@/components/cost-tabs";
import { buildBudgets, type BudgetRow } from "@/lib/mock-data";

const TONE: Record<BudgetRow["status"], "ok" | "warn" | "bad"> = {
  Healthy: "ok",
  Warning: "warn",
  Breach: "bad",
};

const fmt = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

export default function Budgets() {
  const { data: apps, isLoading } = useListApps();
  const rows = useMemo(() => (apps ? buildBudgets(apps) : []), [apps]);

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
                    <TableCell className="py-1 text-right tabular-nums">{fmt(r.budget)}</TableCell>
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
