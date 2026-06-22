import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  DollarSign,
  Pencil,
  Check,
  X,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/lib/auth";
import { ADMIN_GROUP, COST_READER_GROUP } from "@/lib/auth-groups";
import { useToast } from "@/hooks/use-toast";
import { useApps } from "@/hooks/use-apps";

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

const fmtPct = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(n / 100);

type BudgetEntry = {
  appId: string;
  appName: string;
  monthlyBudget: number | null;
  notes: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
  isVirtual: boolean;
  meta: {
    daysInMonth: number;
    elapsedDays: number;
  };
};

function fetchBudgetManagement(): Promise<BudgetEntry[]> {
  return fetch("/api/budget-management").then((r) => {
    if (!r.ok) throw new Error(`${r.status}`);
    return r.json() as Promise<BudgetEntry[]>;
  });
}

function saveBudget(appId: string, monthlyBudget: number, notes: string | null): Promise<void> {
  return fetch(`/api/budget-management/${appId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ monthlyBudget, notes }),
  }).then((r) => {
    if (!r.ok) throw new Error(`${r.status}`);
  });
}

function computeForecast(mtd: number, elapsedDays: number, daysInMonth: number): number {
  if (elapsedDays <= 0) return 0;
  return (mtd / elapsedDays) * daysInMonth;
}

function BudgetStatusBadge({ pct }: { pct: number }) {
  if (pct >= 100)
    return (
      <Badge variant="destructive" className="text-[11px] h-5">
        Over budget
      </Badge>
    );
  if (pct >= 85)
    return (
      <Badge className="text-[11px] h-5 bg-amber-500 hover:bg-amber-500 text-white">
        At risk
      </Badge>
    );
  return (
    <Badge variant="secondary" className="text-[11px] h-5">
      On track
    </Badge>
  );
}

type EditState = {
  budgetStr: string;
  notes: string;
};

function BudgetRow({
  entry,
  mtd,
  canEdit,
  onSave,
}: {
  entry: BudgetEntry;
  mtd: number | null;
  canEdit: boolean;
  onSave: (appId: string, budget: number, notes: string | null) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editState, setEditState] = useState<EditState>({
    budgetStr: entry.monthlyBudget !== null ? String(entry.monthlyBudget) : "",
    notes: entry.notes ?? "",
  });

  const { daysInMonth, elapsedDays } = entry.meta;
  const budget = entry.monthlyBudget;
  const forecast =
    mtd !== null ? computeForecast(mtd, elapsedDays, daysInMonth) : null;
  const pctTobudget = budget && budget > 0 && mtd !== null ? (mtd / budget) * 100 : null;
  const forecastPct = budget && budget > 0 && forecast !== null ? (forecast / budget) * 100 : null;
  const forecastOverBudget = forecast !== null && budget !== null && forecast > budget;

  const startEdit = useCallback(() => {
    setEditState({
      budgetStr: budget !== null ? String(budget) : "",
      notes: entry.notes ?? "",
    });
    setEditing(true);
  }, [budget, entry.notes]);

  const cancelEdit = useCallback(() => setEditing(false), []);

  const handleSave = useCallback(async () => {
    const parsed = parseFloat(editState.budgetStr.replace(/[,$]/g, ""));
    if (isNaN(parsed) || parsed < 0) return;
    setSaving(true);
    try {
      await onSave(entry.appId, parsed, editState.notes.trim() || null);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }, [editState, entry.appId, onSave]);

  return (
    <div className="bg-card border border-border rounded-sm p-4 space-y-3">
      {/* App header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <DollarSign className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="font-semibold text-[14px] truncate">{entry.appName}</span>
          {entry.isVirtual && (
            <Badge variant="outline" className="text-[10px] h-4 shrink-0">
              Non-Azure
            </Badge>
          )}
        </div>
        {canEdit && !editing && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0"
            onClick={startEdit}
            title="Edit budget"
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      {/* Edit form */}
      {editing ? (
        <div className="space-y-2 pt-1">
          <div>
            <label className="text-[12px] text-muted-foreground font-medium mb-1 block">
              Monthly budget (USD)
            </label>
            <Input
              type="number"
              min={0}
              step={1}
              placeholder="e.g. 1500"
              value={editState.budgetStr}
              onChange={(e) => setEditState((s) => ({ ...s, budgetStr: e.target.value }))}
              className="h-8 text-[13px] w-48"
              autoFocus
            />
          </div>
          <div>
            <label className="text-[12px] text-muted-foreground font-medium mb-1 block">
              Notes (optional)
            </label>
            <Textarea
              placeholder="Budget rationale, approval ref, etc."
              value={editState.notes}
              onChange={(e) => setEditState((s) => ({ ...s, notes: e.target.value }))}
              rows={2}
              className="text-[13px] resize-none"
            />
          </div>
          <div className="flex items-center gap-2 pt-1">
            <Button
              size="sm"
              className="h-7 text-[12px]"
              onClick={handleSave}
              disabled={saving || editState.budgetStr === ""}
            >
              {saving ? (
                "Saving…"
              ) : (
                <>
                  <Check className="h-3 w-3 mr-1" />
                  Save
                </>
              )}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-[12px]"
              onClick={cancelEdit}
              disabled={saving}
            >
              <X className="h-3 w-3 mr-1" />
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        /* Metrics grid */
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {/* Monthly budget */}
          <div className="flex flex-col gap-0.5">
            <div className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide">
              Monthly budget
            </div>
            {budget !== null ? (
              <div className="text-lg font-semibold tabular-nums">{fmt(budget)}</div>
            ) : (
              <div className="text-lg font-semibold text-muted-foreground">—</div>
            )}
            {entry.updatedBy && (
              <div className="text-[10px] text-muted-foreground">
                Set by {entry.updatedBy}
              </div>
            )}
          </div>

          {/* MTD spend */}
          <div className="flex flex-col gap-0.5">
            <div className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide flex items-center gap-1">
              MTD spend
              <TooltipProvider delayDuration={400}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-3 w-3 text-muted-foreground cursor-default" />
                  </TooltipTrigger>
                  <TooltipContent>Live from Azure Cost Management</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            {mtd !== null ? (
              <div className="text-lg font-semibold tabular-nums">{fmt(mtd)}</div>
            ) : (
              <div className="text-lg font-semibold text-muted-foreground">—</div>
            )}
            {pctTobudget !== null && budget !== null && (
              <div className="text-[11px] text-muted-foreground tabular-nums">
                {fmtPct(pctTobudget)} of budget
              </div>
            )}
          </div>

          {/* EOM forecast */}
          <div className="flex flex-col gap-0.5">
            <div className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide flex items-center gap-1">
              Forecast EOM
              <TooltipProvider delayDuration={400}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-3 w-3 text-muted-foreground cursor-default" />
                  </TooltipTrigger>
                  <TooltipContent>
                    Linear projection: (MTD ÷ day {elapsedDays}) × {daysInMonth} days
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              {forecastOverBudget && (
                <AlertTriangle className="h-3 w-3 text-amber-500" />
              )}
            </div>
            {forecast !== null ? (
              <div
                className={`text-lg font-semibold tabular-nums ${
                  forecastOverBudget ? "text-destructive" : ""
                }`}
              >
                {fmt(forecast)}
              </div>
            ) : (
              <div className="text-lg font-semibold text-muted-foreground">—</div>
            )}
            {forecastPct !== null && (
              <div className="text-[11px] tabular-nums flex items-center gap-1">
                {forecastOverBudget ? (
                  <TrendingUp className="h-3 w-3 text-destructive" />
                ) : (
                  <TrendingDown className="h-3 w-3 text-emerald-500" />
                )}
                <span className={forecastOverBudget ? "text-destructive" : "text-muted-foreground"}>
                  {fmtPct(forecastPct)} of budget
                </span>
              </div>
            )}
          </div>

          {/* % to budget + status */}
          <div className="flex flex-col gap-0.5">
            <div className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide">
              Status
            </div>
            {pctTobudget !== null ? (
              <>
                <div className="text-lg font-semibold tabular-nums">
                  {fmtPct(pctTobudget)}
                </div>
                <BudgetStatusBadge pct={forecastPct ?? pctTobudget} />
              </>
            ) : (
              <div className="text-[12px] text-muted-foreground mt-1">
                {budget === null ? "No budget set" : "No Azure cost data"}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Progress bar */}
      {!editing && budget !== null && pctTobudget !== null && (
        <div className="space-y-1">
          <div className="flex justify-between text-[10px] text-muted-foreground tabular-nums">
            <span>MTD: {fmt(mtd ?? 0)}</span>
            <span>Budget: {fmt(budget)}</span>
          </div>
          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                pctTobudget >= 100
                  ? "bg-destructive"
                  : pctTobudget >= 85
                    ? "bg-amber-500"
                    : "bg-emerald-500"
              }`}
              style={{ width: `${Math.min(pctTobudget, 100)}%` }}
            />
          </div>
          {forecastOverBudget && forecast !== null && (
            <div className="flex items-center gap-1 text-[11px] text-destructive">
              <AlertTriangle className="h-3 w-3" />
              Projected to exceed budget by {fmt(forecast - budget)} at month end
            </div>
          )}
        </div>
      )}

      {/* Notes display */}
      {!editing && entry.notes && (
        <p className="text-[12px] text-muted-foreground border-t border-border pt-2">
          {entry.notes}
        </p>
      )}
    </div>
  );
}

export default function BudgetManagement() {
  const { hasGroup } = useAuth();
  const canEdit = hasGroup(ADMIN_GROUP.id);
  const canView = hasGroup(COST_READER_GROUP.id);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: entries, isLoading } = useQuery({
    queryKey: ["budget-management"],
    queryFn: fetchBudgetManagement,
    staleTime: 2 * 60 * 1000,
    enabled: canView,
  });

  const { data: appsData } = useApps();

  const mtdByAppId = new Map<string, number>(
    (appsData ?? []).map((a) => [a.id, a.monthToDateCost ?? 0]),
  );

  const mutation = useMutation({
    mutationFn: ({ appId, budget, notes }: { appId: string; budget: number; notes: string | null }) =>
      saveBudget(appId, budget, notes),
    onSuccess: (_data, { appId }) => {
      void queryClient.invalidateQueries({ queryKey: ["budget-management"] });
      toast({ title: "Budget saved", description: `Budget updated for ${appId}` });
    },
    onError: () => {
      toast({ title: "Save failed", description: "Could not save budget. Try again.", variant: "destructive" });
    },
  });

  const handleSave = useCallback(
    async (appId: string, budget: number, notes: string | null) => {
      await mutation.mutateAsync({ appId, budget, notes });
    },
    [mutation],
  );

  const now = new Date();
  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  const elapsedDays = now.getUTCDate();

  return (
    <div className="space-y-5 max-w-4xl">
      <div>
        <h1 className="text-xl font-semibold text-foreground tracking-tight">Budget Management</h1>
        <p className="text-[13px] text-muted-foreground mt-0.5">
          Manually set monthly budget targets for each application. Forecasts are calculated as a
          linear projection based on current month-to-date spend (day {elapsedDays} of {daysInMonth}).
        </p>
      </div>

      {!canView ? (
        <div className="flex items-center gap-2 text-[13px] text-muted-foreground border border-border rounded-sm p-4">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          You need Cost Reader access to view budget information.
        </div>
      ) : isLoading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-36 w-full" />
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {(entries ?? []).map((entry) => (
            <BudgetRow
              key={entry.appId}
              entry={entry}
              mtd={mtdByAppId.get(entry.appId) ?? null}
              canEdit={canEdit}
              onSave={handleSave}
            />
          ))}
          {!canEdit && (
            <p className="text-[12px] text-muted-foreground">
              You have read-only access. Contact an admin to update budget targets.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
