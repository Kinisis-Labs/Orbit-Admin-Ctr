import { useEffect, useState } from "react";
import { useListApps } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader } from "@/components/page-header";
import { GLOBAL_SCOPE, useScope } from "@/lib/scope";

type Theme = "dark" | "light";
type Density = "comfortable" | "compact";

export default function Preferences() {
  const { data: apps } = useListApps();
  const { scope, setScope } = useScope();
  const [theme, setTheme] = useState<Theme>(() => (typeof window === "undefined" ? "dark" : (localStorage.getItem("gaac-theme") === "light" ? "light" : "dark")));
  const [density, setDensity] = useState<Density>(() => (typeof window === "undefined" ? "comfortable" : (localStorage.getItem("gaac-density") === "compact" ? "compact" : "comfortable")));

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") root.classList.add("dark"); else root.classList.remove("dark");
    localStorage.setItem("gaac-theme", theme);
  }, [theme]);

  useEffect(() => { localStorage.setItem("gaac-density", density); }, [density]);

  const reset = () => {
    setTheme("dark"); setDensity("comfortable"); setScope(GLOBAL_SCOPE);
    localStorage.removeItem("gaac-nav-collapsed");
  };

  return (
    <div className="space-y-4 max-w-3xl">
      <PageHeader title="Preferences" subtitle="Personal preferences for Kinisis Orbit. These are stored in your browser." />

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
