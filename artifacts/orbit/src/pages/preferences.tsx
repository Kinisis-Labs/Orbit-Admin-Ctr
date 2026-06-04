import { useEffect, useState } from "react";
import { useListApps } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader } from "@/components/page-header";
import { GLOBAL_SCOPE, useScope } from "@/lib/scope-context";
import {
  DEFAULT_SPEND_THRESHOLD,
  getSpendThreshold,
  setSpendThreshold,
  removeSpendThreshold,
  clearSpendThresholds,
  DEFAULT_BUDGET_THRESHOLD,
  getBudgetThreshold,
  setBudgetThreshold,
  removeBudgetThreshold,
  clearBudgetThresholds,
} from "@/lib/spend-threshold";

type Theme = "dark" | "light";
type Density = "comfortable" | "compact";

export default function Preferences() {
  const { data: apps } = useListApps();
  const { scope, setScope } = useScope();
  const [theme, setTheme] = useState<Theme>(() => (typeof window === "undefined" ? "dark" : (localStorage.getItem("orbit-theme") === "light" ? "light" : "dark")));
  const [density, setDensity] = useState<Density>(() => (typeof window === "undefined" ? "comfortable" : (localStorage.getItem("orbit-density") === "compact" ? "compact" : "comfortable")));
  const [thresholds, setThresholds] = useState<Record<string, string>>(() => {
    if (typeof window === "undefined") return {};
    const all: Record<string, string> = {};
    for (const app of ([] as { id: string }[])) all[app.id] = String(getSpendThreshold(app.id));
    return all;
  });
  const [budgetThresholds, setBudgetThresholds] = useState<Record<string, string>>(() => {
    if (typeof window === "undefined") return {};
    return {};
  });

  useEffect(() => {
    if (!apps) return;
    setThresholds((prev) => {
      const next: Record<string, string> = {};
      for (const app of apps) {
        next[app.id] = prev[app.id] !== undefined ? prev[app.id] : String(getSpendThreshold(app.id));
      }
      return next;
    });
    setBudgetThresholds((prev) => {
      const next: Record<string, string> = {};
      for (const app of apps) {
        next[app.id] = prev[app.id] !== undefined ? prev[app.id] : String(getBudgetThreshold(app.id));
      }
      return next;
    });
  }, [apps]);

  useEffect(() => {
    if (!apps) return;
    const refreshAll = () => {
      setThresholds((prev) => {
        const next: Record<string, string> = { ...prev };
        for (const app of apps) next[app.id] = String(getSpendThreshold(app.id));
        return next;
      });
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key !== "orbit-spend-thresholds") return;
      refreshAll();
    };
    window.addEventListener("orbit-spend-threshold-changed", refreshAll);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("orbit-spend-threshold-changed", refreshAll);
      window.removeEventListener("storage", onStorage);
    };
  }, [apps]);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") root.classList.add("dark"); else root.classList.remove("dark");
    localStorage.setItem("orbit-theme", theme);
  }, [theme]);

  useEffect(() => { localStorage.setItem("orbit-density", density); }, [density]);

  const handleThresholdChange = (appId: string, raw: string) => {
    setThresholds((prev) => ({ ...prev, [appId]: raw }));
    const parsed = parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return;
    setSpendThreshold(appId, parsed);
    window.dispatchEvent(new Event("orbit-spend-threshold-changed"));
  };

  const handleThresholdBlur = (appId: string, raw: string) => {
    const parsed = parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      removeSpendThreshold(appId);
      setThresholds((prev) => ({ ...prev, [appId]: String(DEFAULT_SPEND_THRESHOLD) }));
      window.dispatchEvent(new Event("orbit-spend-threshold-changed"));
    }
  };

  const handleBudgetThresholdChange = (appId: string, raw: string) => {
    setBudgetThresholds((prev) => ({ ...prev, [appId]: raw }));
    const parsed = parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 100) return;
    setBudgetThreshold(appId, parsed);
    window.dispatchEvent(new Event("orbit-budget-threshold-changed"));
  };

  const handleBudgetThresholdBlur = (appId: string, raw: string) => {
    const parsed = parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 100) {
      removeBudgetThreshold(appId);
      setBudgetThresholds((prev) => ({ ...prev, [appId]: String(DEFAULT_BUDGET_THRESHOLD) }));
      window.dispatchEvent(new Event("orbit-budget-threshold-changed"));
    }
  };

  const reset = () => {
    setTheme("dark"); setDensity("comfortable"); setScope(GLOBAL_SCOPE);
    localStorage.removeItem("orbit-nav-collapsed");
    clearSpendThresholds();
    clearBudgetThresholds();
    if (apps) {
      const restored: Record<string, string> = {};
      const budgetRestored: Record<string, string> = {};
      for (const app of apps) {
        restored[app.id] = String(DEFAULT_SPEND_THRESHOLD);
        budgetRestored[app.id] = String(DEFAULT_BUDGET_THRESHOLD);
      }
      setThresholds(restored);
      setBudgetThresholds(budgetRestored);
      window.dispatchEvent(new Event("orbit-spend-threshold-changed"));
      window.dispatchEvent(new Event("orbit-budget-threshold-changed"));
    }
  };

  return (
    <div className="space-y-4 max-w-3xl">
      <PageHeader title="Preferences" subtitle="Personal preferences for Orbit. These are stored in your browser." />

      <Row label="Theme" hint="Azure Portal dark and light themes.">
        <Select value={theme} onValueChange={(v) => setTheme(v as Theme)}>
          <SelectTrigger className="h-8 w-[200px] rounded-sm text-[13px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="dark">Dark</SelectItem>
            <SelectItem value="light">Light</SelectItem>
          </SelectContent>
        </Select>
      </Row>

      <Row label="Table density" hint="Compact reduces row padding across all tables.">
        <Select value={density} onValueChange={(v) => setDensity(v as Density)}>
          <SelectTrigger className="h-8 w-[200px] rounded-sm text-[13px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="comfortable">Comfortable</SelectItem>
            <SelectItem value="compact">Compact</SelectItem>
          </SelectContent>
        </Select>
      </Row>

      <Row label="Default scope" hint="Scope applied on every page load.">
        <Select value={scope} onValueChange={setScope}>
          <SelectTrigger className="h-8 w-[260px] rounded-sm text-[13px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={GLOBAL_SCOPE}>Global — All Applications</SelectItem>
            {apps?.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </Row>

      {apps && apps.length > 0 && (
        <div className="bg-card border border-border shadow-sm">
          <div className="px-4 py-3 border-b border-border">
            <div className="text-[13px] font-semibold text-foreground">Spend alert threshold</div>
            <div className="text-[12px] text-muted-foreground mt-0.5">
              Bars on the daily spend chart turn red when spend exceeds last week by more than this percentage. Default is {DEFAULT_SPEND_THRESHOLD}%.
            </div>
          </div>
          {apps.map((app) => (
            <div key={app.id} className="flex items-center justify-between gap-4 px-4 py-3 border-b border-border last:border-b-0">
              <div className="text-[13px] text-foreground">{app.name}</div>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={1}
                  max={999}
                  value={thresholds[app.id] ?? String(DEFAULT_SPEND_THRESHOLD)}
                  onChange={(e) => handleThresholdChange(app.id, e.target.value)}
                  onBlur={(e) => handleThresholdBlur(app.id, e.target.value)}
                  className="h-8 w-[90px] rounded-sm text-[13px] text-right"
                />
                <span className="text-[13px] text-muted-foreground">%</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {apps && apps.length > 0 && (
        <div className="bg-card border border-border shadow-sm">
          <div className="px-4 py-3 border-b border-border">
            <div className="text-[13px] font-semibold text-foreground">Budget utilization alert</div>
            <div className="text-[12px] text-muted-foreground mt-0.5">
              The budget utilization bar turns amber/red when MTD spend exceeds this percentage of the monthly budget. Default is {DEFAULT_BUDGET_THRESHOLD}%.
            </div>
          </div>
          {apps.map((app) => (
            <div key={app.id} className="flex items-center justify-between gap-4 px-4 py-3 border-b border-border last:border-b-0">
              <div className="text-[13px] text-foreground">{app.name}</div>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={1}
                  max={100}
                  value={budgetThresholds[app.id] ?? String(DEFAULT_BUDGET_THRESHOLD)}
                  onChange={(e) => handleBudgetThresholdChange(app.id, e.target.value)}
                  onBlur={(e) => handleBudgetThresholdBlur(app.id, e.target.value)}
                  className="h-8 w-[90px] rounded-sm text-[13px] text-right"
                />
                <span className="text-[13px] text-muted-foreground">%</span>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="pt-3 border-t border-border">
        <Button variant="outline" size="sm" className="h-8 rounded-sm" onClick={reset}>Reset to defaults</Button>
      </div>
    </div>
  );
}

function Row({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="bg-card border border-border shadow-sm p-4 flex items-center justify-between gap-4">
      <div>
        <div className="text-[13px] font-semibold text-foreground">{label}</div>
        <div className="text-[12px] text-muted-foreground mt-0.5">{hint}</div>
      </div>
      {children}
    </div>
  );
}
