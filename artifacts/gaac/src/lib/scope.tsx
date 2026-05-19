import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useListApps } from "@workspace/api-client-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const GLOBAL_SCOPE = "__global__";
const STORAGE_KEY = "gaac-scope";

type ScopeContextValue = {
  scope: string;
  setScope: (v: string) => void;
  isGlobal: boolean;
};

const ScopeContext = createContext<ScopeContextValue | null>(null);

export function ScopeProvider({ children }: { children: React.ReactNode }) {
  const [scope, setScopeState] = useState<string>(() => {
    if (typeof window === "undefined") return GLOBAL_SCOPE;
    return window.localStorage.getItem(STORAGE_KEY) ?? GLOBAL_SCOPE;
  });

  const setScope = useCallback((v: string) => {
    setScopeState(v);
    try {
      window.localStorage.setItem(STORAGE_KEY, v);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, scope);
    } catch {
      /* ignore */
    }
  }, [scope]);

  const value = useMemo(
    () => ({ scope, setScope, isGlobal: scope === GLOBAL_SCOPE }),
    [scope, setScope],
  );

  return <ScopeContext.Provider value={value}>{children}</ScopeContext.Provider>;
}

export function useScope() {
  const ctx = useContext(ScopeContext);
  if (!ctx) throw new Error("useScope must be used within a ScopeProvider");
  return ctx;
}

export function ScopeSelect({ id = "scope-select" }: { id?: string }) {
  const { scope, setScope } = useScope();
  const { data: apps } = useListApps();

  // If persisted scope refers to an app that no longer exists, fall back to Global.
  useEffect(() => {
    if (!apps || scope === GLOBAL_SCOPE) return;
    if (!apps.some((a) => a.id === scope)) setScope(GLOBAL_SCOPE);
  }, [apps, scope, setScope]);

  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="text-[12px] text-muted-foreground font-medium">
        Scope
      </label>
      <Select value={scope} onValueChange={setScope}>
        <SelectTrigger
          id={id}
          aria-label="Dashboard scope"
          data-testid="scope-select"
          className="h-8 w-[260px] rounded-sm border-border bg-card text-[13px]"
        >
          <SelectValue placeholder="Select scope" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={GLOBAL_SCOPE}>Global — All Applications</SelectItem>
          {apps?.map((a) => (
            <SelectItem key={a.id} value={a.id}>
              {a.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
