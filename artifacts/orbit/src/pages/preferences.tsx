import { useEffect, useRef, useState } from "react";
import { useApps } from "@/hooks/use-apps";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader } from "@/components/page-header";
import { useScope } from "@/lib/scope-context";
import { useToast } from "@/hooks/use-toast";
import {
  DEFAULT_SPEND_THRESHOLD,
  SPEND_THRESHOLDS_STORAGE_KEY,
  DEFAULT_BUDGET_THRESHOLD,
  BUDGET_THRESHOLDS_STORAGE_KEY,
  getSpendThreshold,
  setSpendThreshold,
  getBudgetThreshold,
  setBudgetThreshold,
  clearSpendThresholds,
  clearBudgetThresholds,
} from "@/lib/spend-threshold";

type Theme = "dark" | "light";
type Density = "comfortable" | "compact";

interface DraftState {
  theme: Theme;
  density: Density;
  scope: string;
  thresholds: Record<string, string>;
  budgetThresholds: Record<string, string>;
}

function readSaved(apps: { id: string }[]): DraftState {
  const theme = (localStorage.getItem("orbit-theme") === "light" ? "light" : "dark") as Theme;
  const density = (localStorage.getItem("orbit-density") === "compact" ? "compact" : "comfortable") as Density;
  const scope = localStorage.getItem("orbit-scope") ?? (apps[0]?.id ?? "global");
  const thresholds: Record<string, string> = {};
  const budgetThresholds: Record<string, string> = {};
  for (const a of apps) {
    thresholds[a.id] = String(getSpendThreshold(a.id));
    budgetThresholds[a.id] = String(getBudgetThreshold(a.id));
  }
  return { theme, density, scope, thresholds, budgetThresholds };
}

export default function Preferences() {
  const { data: apps } = useApps();
  const { scope: liveScope, setScope } = useScope();
  const { toast } = useToast();

  const [draft, setDraft] = useState<DraftState>(() => ({
    theme: typeof window === "undefined" ? "dark" : (localStorage.getItem("orbit-theme") === "light" ? "light" : "dark"),
    density: typeof window === "undefined" ? "comfortable" : (localStorage.getItem("orbit-density") === "compact" ? "compact" : "comfortable"),
    scope: liveScope,
    thresholds: {},
    budgetThresholds: {},
  }));

  const [saved, setSaved] = useState<DraftState>(draft);
  const initializedRef = useRef(false);

  // Populate thresholds once apps load
  useEffect(() => {
    if (!apps || initializedRef.current) return;
    initializedRef.current = true;
    const initial = readSaved(apps);
    setDraft(initial);
    setSaved(initial);
  }, [apps]);

  // Apply theme to DOM as a live preview (without saving to localStorage yet)
  useEffect(() => {
    const root = document.documentElement;
    if (draft.theme === "dark") root.classList.add("dark");
    else root.classList.remove("dark");
  }, [draft.theme]);

  const isDirty = JSON.stringify(draft) !== JSON.stringify(saved);

  const handleSave = () => {
    // Persist theme
    localStorage.setItem("orbit-theme", draft.theme);

    // Persist density
    localStorage.setItem("orbit-density", draft.density);

    // Persist scope
    setScope(draft.scope);

    // Persist spend thresholds
    for (const [appId, raw] of Object.entries(draft.thresholds)) {
      const parsed = parseInt(raw, 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        setSpendThreshold(appId, parsed);
      }
    }
    window.dispatchEvent(new Event("orbit-spend-threshold-changed"));

    // Persist budget thresholds
    for (const [appId, raw] of Object.entries(draft.budgetThresholds)) {
      const parsed = parseInt(raw, 10);
      if (Number.isFinite(parsed) && parsed > 0 && parsed <= 100) {
        setBudgetThreshold(appId, parsed);
      }
    }
    window.dispatchEvent(new Event("orbit-budget-threshold-changed"));

    setSaved(draft);
    toast({ title: "Preferences saved", duration: 2500 });
  };

  const handleDiscard = () => {
    setDraft(saved);
    // Restore theme to saved value
    const root = document.documentElement;
    if (saved.theme === "dark") root.classList.add("dark");
    else root.classList.remove("dark");
  };

  const handleReset = () => {
    if (!apps) return;
    clearSpendThresholds();
    clearBudgetThresholds();
    const thresholds: Record<string, string> = {};
    const budgetThresholds: Record<string, string> = {};
    for (const a of apps) {
      thresholds[a.id] = String(DEFAULT_SPEND_THRESHOLD);
      budgetThresholds[a.id] = String(DEFAULT_BUDGET_THRESHOLD);
    }
    const defaults: DraftState = {
      theme: "dark",
      density: "comfortable",
      scope: apps[0]?.id ?? "global",
      thresholds,
      budgetThresholds,
    };
    setDraft(defaults);
    // Immediately persist reset (reset is destructive — no ambiguity)
    localStorage.setItem("orbit-theme", defaults.theme);
    localStorage.setItem("orbit-density", defaults.density);
    setScope(defaults.scope);
    window.dispatchEvent(new Event("orbit-spend-threshold-changed"));
    window.dispatchEvent(new Event("orbit-budget-threshold-changed"));
    setSaved(defaults);
    localStorage.removeItem("orbit-nav-collapsed");
    toast({ title: "Preferences reset to defaults", duration: 2500 });
  };

  const set = <K extends keyof DraftState>(key: K, value: DraftState[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const setThreshold = (appId: string, raw: string) =>
    setDraft((d) => ({ ...d, thresholds: { ...d.thresholds, [appId]: raw } }));

  const setBudgetThresh = (appId: string, raw: string) =>
    setDraft((d) => ({ ...d, budgetThresholds: { ...d.budgetThresholds, [appId]: raw } }));

  return (
    <div className="space-y-4 max-w-3xl">
      <PageHeader
        title="Preferences"
        subtitle="Personal preferences for Orbit. Stored in your browser."
        right={
          <div className="flex items-center gap-2">
            {isDirty && (
              <Button variant="ghost" size="sm" className="h-8 rounded-sm text-[13px]" onClick={handleDiscard}>
                Discard
              </Button>
            )}
            <Button
              size="sm"
              className="h-8 rounded-sm text-[13px]"
              disabled={!isDirty}
              onClick={handleSave}
            >
              Save changes
            </Button>
          </div>
        }
      />

      {isDirty && (
        <div className="flex items-center gap-2 px-3 py-2 bg-amber-500/10 border border-amber-500/30 text-[12px] text-amber-600 dark:text-amber-400 rounded-sm">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0" />
          You have unsaved changes — click <span className="font-semibold mx-1">Save changes</span> to apply them.
        </div>
      )}

      <Row label="Theme" hint="Azure Portal dark and light themes.">
        <Select value={draft.theme} onValueChange={(v) => set("theme", v as Theme)}>
          <SelectTrigger className="h-8 w-[200px] rounded-sm text-[13px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="dark">Dark</SelectItem>
            <SelectItem value="light">Light</SelectItem>
          </SelectContent>
        </Select>
      </Row>

      <Row label="Table density" hint="Compact reduces row padding across all tables.">
        <Select value={draft.density} onValueChange={(v) => set("density", v as Density)}>
          <SelectTrigger className="h-8 w-[200px] rounded-sm text-[13px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="comfortable">Comfortable</SelectItem>
            <SelectItem value="compact">Compact</SelectItem>
          </SelectContent>
        </Select>
      </Row>

      <Row label="Default scope" hint="Scope applied on every page load.">
        <Select value={draft.scope} onValueChange={(v) => set("scope", v)}>
          <SelectTrigger className="h-8 w-[260px] rounded-sm text-[13px]"><SelectValue /></SelectTrigger>
          <SelectContent>
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
                  value={draft.thresholds[app.id] ?? String(DEFAULT_SPEND_THRESHOLD)}
                  onChange={(e) => setThreshold(app.id, e.target.value)}
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
                  value={draft.budgetThresholds[app.id] ?? String(DEFAULT_BUDGET_THRESHOLD)}
                  onChange={(e) => setBudgetThresh(app.id, e.target.value)}
                  className="h-8 w-[90px] rounded-sm text-[13px] text-right"
                />
                <span className="text-[13px] text-muted-foreground">%</span>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="pt-3 border-t border-border flex items-center justify-between">
        <Button variant="outline" size="sm" className="h-8 rounded-sm text-[13px]" onClick={handleReset}>
          Reset to defaults
        </Button>
        <div className="flex items-center gap-2">
          {isDirty && (
            <Button variant="ghost" size="sm" className="h-8 rounded-sm text-[13px]" onClick={handleDiscard}>
              Discard
            </Button>
          )}
          <Button
            size="sm"
            className="h-8 rounded-sm text-[13px]"
            disabled={!isDirty}
            onClick={handleSave}
          >
            Save changes
          </Button>
        </div>
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
