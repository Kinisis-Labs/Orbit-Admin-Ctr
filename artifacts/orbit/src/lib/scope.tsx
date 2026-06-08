import { useCallback, useEffect, useMemo, useState } from "react";
import { useApps } from "@/hooks/use-apps";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AuthBadge } from "@/components/auth-badge";
import { ScopeContext, useScope } from "./scope-context";

const STORAGE_KEY = "orbit-scope";
const DEFAULT_SCOPE = "kinisis-labs";

export function ScopeProvider({ children }: { children: React.ReactNode }) {
  const [scope, setScopeState] = useState<string>(() => {
    if (typeof window === "undefined") return DEFAULT_SCOPE;
    return window.localStorage.getItem(STORAGE_KEY) ?? DEFAULT_SCOPE;
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
    () => ({ scope, setScope }),
    [scope, setScope],
  );

  return <ScopeContext.Provider value={value}>{children}</ScopeContext.Provider>;
}

export function ScopeSelect({ id = "scope-select" }: { id?: string }) {
  const { scope, setScope } = useScope();
  const { data: apps } = useApps();

  // If persisted scope refers to an app that no longer exists, fall back to
  // the first app in the list (or the default).
  useEffect(() => {
    if (!apps || apps.length === 0) return;
    if (!apps.some((a) => a.id === scope)) {
      setScope(apps[0].id ?? DEFAULT_SCOPE);
    }
  }, [apps, scope, setScope]);

  const selectedApp = (apps ?? []).find((a) => a.id === scope);

  const collator = new Intl.Collator(undefined, { sensitivity: "base" });
  const sortedApps = [...(apps ?? [])].sort((a, b) => collator.compare(a.name, b.name));

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
          {selectedApp ? (
            <span className="flex items-center gap-1.5 min-w-0">
              <span className="truncate">
                {selectedApp.name}
                <span className="text-muted-foreground"> · {selectedApp.environment}</span>
              </span>
              <AuthBadge userAuth={selectedApp.userAuth} />
            </span>
          ) : (
            <SelectValue placeholder="Select scope" />
          )}
        </SelectTrigger>
        <SelectContent>
          {sortedApps.map((a) => (
            <SelectItem key={a.id} value={a.id}>
              {a.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
