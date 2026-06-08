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
import { useInfraViolations } from "@/lib/infra-violation-context";
import type { UserAuthType } from "@workspace/api-client-react";

const STORAGE_KEY = "orbit-scope";
const DEFAULT_SCOPE = "global";

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

export function ScopeSelect({
  id = "scope-select",
  authFilter,
  allowGlobal = false,
}: {
  id?: string;
  authFilter?: UserAuthType | null;
  allowGlobal?: boolean;
}) {
  const { scope, setScope } = useScope();
  const { data: apps } = useApps();
  const activeViolations = useInfraViolations();

  const violatingAppIds = useMemo(
    () => new Set(activeViolations.map((v) => v.appId)),
    [activeViolations],
  );

  const allApps = apps ?? [];
  const filteredApps = authFilter
    ? allApps.filter((a) => a.userAuth === authFilter)
    : allApps;

  // If persisted scope refers to an app that no longer exists, fall back to
  // the first app in the list (or the default). When allowGlobal is true,
  // "global" is a valid sentinel value so skip the reset for it. On pages
  // where allowGlobal is false, "global" is coerced back to a real app ID.
  useEffect(() => {
    if (!apps || apps.length === 0) return;
    if (allowGlobal && scope === "global") return;
    if (!apps.some((a) => a.id === scope)) {
      setScope(apps[0].id ?? DEFAULT_SCOPE);
    }
  }, [apps, scope, setScope, allowGlobal]);

  // When a filter is active and the current scope doesn't match, switch to first match.
  useEffect(() => {
    if (!authFilter || filteredApps.length === 0) return;
    if (!filteredApps.some((a) => a.id === scope)) {
      setScope(filteredApps[0].id);
    }
  }, [authFilter, filteredApps, scope, setScope]);

  const selectedApp = allApps.find((a) => a.id === scope);
  const isGlobal = scope === "global";

  const collator = new Intl.Collator(undefined, { sensitivity: "base" });
  const sortedApps = [...filteredApps].sort((a, b) => collator.compare(a.name, b.name));

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
          {isGlobal ? (
            <span className="text-foreground">Global — All Apps</span>
          ) : selectedApp ? (
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
          {allowGlobal && !authFilter && (
            <SelectItem key="global" value="global">
              Global — All Apps
            </SelectItem>
          )}
          {sortedApps.map((a) => (
            <SelectItem key={a.id} value={a.id}>
              <span className="flex items-center gap-1.5">
                {violatingAppIds.has(a.id) && (
                  <span
                    className="inline-block h-2 w-2 shrink-0 rounded-full bg-destructive"
                    aria-label="Active violation"
                  />
                )}
                {a.name}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
