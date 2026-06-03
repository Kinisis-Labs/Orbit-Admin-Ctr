import { useCallback, useEffect, useMemo, useState } from "react";
import { useListApps } from "@workspace/api-client-react";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { GLOBAL_SCOPE, ScopeContext, useScope } from "./scope-context";

const STORAGE_KEY = "orbit-scope";

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

export function ScopeSelect({ id = "scope-select" }: { id?: string }) {
  const { scope, setScope } = useScope();
  const { data: apps } = useListApps();

  // If persisted scope refers to an app that no longer exists, fall back to Global.
  useEffect(() => {
    if (!apps || scope === GLOBAL_SCOPE) return;
    if (!apps.some((a) => a.id === scope)) setScope(GLOBAL_SCOPE);
  }, [apps, scope, setScope]);

  // Apps without a group render as top-level entries; grouped apps render
  // under a labelled section (e.g. "Platform").
  const ungrouped = (apps ?? []).filter((a) => !a.group);
  const groups = new Map<string, NonNullable<typeof apps>>();
  for (const a of apps ?? []) {
    if (!a.group) continue;
    const arr = groups.get(a.group) ?? [];
    arr.push(a);
    groups.set(a.group, arr);
  }

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
          {ungrouped.map((a) => (
            <SelectItem key={a.id} value={a.id}>
              {a.name}
            </SelectItem>
          ))}
          {[...groups.entries()].map(([label, items]) => (
            <SelectGroup key={label}>
              <SelectLabel>{label}</SelectLabel>
              {items.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name}
                </SelectItem>
              ))}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
