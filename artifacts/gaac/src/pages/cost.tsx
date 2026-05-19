import { useGetGlobalCostSummary } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { Link } from "wouter";

export default function Cost() {
  const { data: cost, isLoading } = useGetGlobalCostSummary();

  const formatCurrency = (amount: number, currency: string) => {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
  };

  const budgetPercent = cost ? (cost.monthToDate / cost.budget) * 100 : 0;

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">Global Cost</h1>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Month-to-Date Spend</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-8 w-24" /> : (
              <div className="text-3xl font-bold">{cost ? formatCurrency(cost.monthToDate, cost.currency) : "$0.00"}</div>
            )}
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Forecast (EOM)</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-8 w-24" /> : (
              <div className="text-3xl font-bold">{cost ? formatCurrency(cost.forecast, cost.currency) : "$0.00"}</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Budget Tracking</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-8 w-full mt-2" /> : (
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span>{formatCurrency(cost?.monthToDate || 0, cost?.currency || "USD")}</span>
                  <span className="text-muted-foreground">{formatCurrency(cost?.budget || 0, cost?.currency || "USD")}</span>
                </div>
                <Progress value={budgetPercent} className="h-2" />
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Cost by Application</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Application</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="w-[30%]">Share of Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-20 ml-auto" /></TableCell>
                    <TableCell><Skeleton className="h-2 w-full" /></TableCell>
                  </TableRow>
                ))
              ) : cost?.byApp.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-muted-foreground">No cost data available</TableCell>
                </TableRow>
              ) : (
                cost?.byApp.map((item) => (
                  <TableRow key={item.appId}>
                    <TableCell className="font-medium">
                      <Link href={`/apps/${item.appId}`} className="hover:underline text-primary">
                        {item.appName}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {formatCurrency(item.amount, cost.currency)}
                    </TableCell>
                    <TableCell>
                      <Progress value={(item.amount / cost.monthToDate) * 100} className="h-1.5" />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
