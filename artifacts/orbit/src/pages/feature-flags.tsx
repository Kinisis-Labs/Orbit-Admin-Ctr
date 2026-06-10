import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ToggleLeft, ToggleRight, Info, ShieldCheck, Database } from "lucide-react";
import { RequireGroup } from "@/components/access-denied";
import { ADMIN_GROUP } from "@/lib/auth-groups";
import { toast } from "@/hooks/use-toast";

interface FeatureFlag {
  name: string;
  label: string;
  description: string;
  enabled: boolean;
  configStore: "live" | "db" | "mock";
}

async function fetchFeatureFlags(): Promise<FeatureFlag[]> {
  const res = await fetch("/api/admin/feature-flags", { credentials: "same-origin" });
  if (!res.ok) throw new Error(`Failed to load feature flags: ${res.status}`);
  return res.json() as Promise<FeatureFlag[]>;
}

async function updateFeatureFlag(flagName: string, enabled: boolean): Promise<FeatureFlag> {
  const res = await fetch(`/api/admin/feature-flags/${encodeURIComponent(flagName)}`, {
    method: "PUT",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({ error: "Unknown error" }))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<FeatureFlag>;
}

function DbStoreBanner() {
  return (
    <div className="flex items-start gap-3 px-4 py-3 bg-blue-500/10 border border-blue-500/30 text-blue-300 text-[13px] mb-4">
      <Database className="h-4 w-4 mt-0.5 shrink-0" />
      <div>
        <span className="font-semibold">Database store — </span>
        Flags are persisted in Postgres. Connect{" "}
        <span className="font-mono">APP_CONFIGURATION_ENDPOINT</span> in production to switch to
        Azure App Configuration.
      </div>
    </div>
  );
}

function FlagRow({
  flag,
  onToggle,
  toggling,
}: {
  flag: FeatureFlag;
  onToggle: (name: string, enabled: boolean) => void;
  toggling: boolean;
}) {
  const isMock = flag.configStore === "mock";
  const isDisabled = isMock || toggling;

  return (
    <div className="flex items-start justify-between gap-6 px-4 py-4 border-b border-border last:border-b-0">
      <div className="min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-[13px] font-semibold text-foreground">{flag.label}</span>
          <span className="font-mono text-[11px] text-muted-foreground bg-muted/40 px-1.5 py-0.5 border border-border">
            {flag.name}
          </span>
          {flag.configStore === "db" && (
            <span className="text-[10px] font-medium px-1.5 py-0.5 border border-blue-500/40 bg-blue-500/10 text-blue-400 flex items-center gap-1">
              <Database className="h-2.5 w-2.5" />
              postgres
            </span>
          )}
          {flag.configStore === "live" && (
            <span className="text-[10px] font-medium px-1.5 py-0.5 border border-emerald-500/40 bg-emerald-500/10 text-emerald-400">
              azure
            </span>
          )}
          {isMock && (
            <span className="text-[10px] font-medium px-1.5 py-0.5 border border-amber-500/40 bg-amber-500/10 text-amber-400">
              mock
            </span>
          )}
        </div>
        <p className="text-[12px] text-muted-foreground leading-relaxed">{flag.description}</p>
      </div>

      <button
        type="button"
        disabled={isDisabled}
        onClick={() => onToggle(flag.name, !flag.enabled)}
        title={
          isMock
            ? "Connect App Configuration to enable flag management"
            : flag.enabled
            ? `Disable ${flag.label}`
            : `Enable ${flag.label}`
        }
        className={`shrink-0 flex items-center gap-2 px-3 py-1.5 border rounded-sm text-[12px] font-medium transition-colors
          ${isDisabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}
          ${
            flag.enabled
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"
              : "border-border bg-muted/30 text-muted-foreground hover:bg-muted/60"
          }
        `}
      >
        {flag.enabled ? (
          <ToggleRight className="h-4 w-4" />
        ) : (
          <ToggleLeft className="h-4 w-4" />
        )}
        <span>{flag.enabled ? "Enabled" : "Disabled"}</span>
      </button>
    </div>
  );
}

function FeatureFlagsPanel() {
  const queryClient = useQueryClient();
  const [togglingFlags, setTogglingFlags] = useState<Set<string>>(new Set());

  const { data: flags, isLoading, isError, error } = useQuery<FeatureFlag[], Error>({
    queryKey: ["admin", "feature-flags"],
    queryFn: fetchFeatureFlags,
    staleTime: 30_000,
  });

  const mutation = useMutation<FeatureFlag, Error, { name: string; enabled: boolean }>({
    mutationFn: ({ name, enabled }) => updateFeatureFlag(name, enabled),
    onMutate: ({ name }) => {
      setTogglingFlags((prev) => new Set([...prev, name]));
    },
    onSuccess: (updated) => {
      queryClient.setQueryData<FeatureFlag[]>(["admin", "feature-flags"], (prev) =>
        prev?.map((f) => (f.name === updated.name ? updated : f)),
      );
      toast({
        title: `${updated.label} ${updated.enabled ? "enabled" : "disabled"}`,
        duration: 3000,
      });
    },
    onError: (err, { name }) => {
      toast({
        title: "Failed to update flag",
        description: err.message,
        variant: "destructive",
        duration: 5000,
      });
      void queryClient.invalidateQueries({ queryKey: ["admin", "feature-flags"] });
      setTogglingFlags((prev) => {
        const next = new Set(prev);
        next.delete(name);
        return next;
      });
    },
    onSettled: (_data, _err, { name }) => {
      setTogglingFlags((prev) => {
        const next = new Set(prev);
        next.delete(name);
        return next;
      });
    },
  });

  const handleToggle = (name: string, enabled: boolean) => {
    mutation.mutate({ name, enabled });
  };

  const configStore = flags?.length ? flags[0].configStore : null;

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[16px] font-semibold text-foreground">Feature flags</h1>
          <p className="text-[13px] text-muted-foreground mt-0.5">
            Toggle Orbit surfaces on and off. Changes take effect on the next request to the affected
            endpoint.
          </p>
        </div>
        <div className="shrink-0 flex items-center gap-1.5 px-2.5 py-1 border border-blue-500/30 bg-blue-500/10 text-blue-400 text-[11px] font-medium">
          <ShieldCheck className="h-3.5 w-3.5" />
          Orbit-Admins only
        </div>
      </div>

      {configStore === "db" && <DbStoreBanner />}

      {isLoading && (
        <div className="bg-card border border-border shadow-sm px-4 py-8 text-center text-[13px] text-muted-foreground">
          Loading feature flags…
        </div>
      )}

      {isError && (
        <div className="bg-card border border-border shadow-sm px-4 py-4 text-[13px] text-destructive">
          Failed to load feature flags: {(error as Error).message}
        </div>
      )}

      {flags && flags.length > 0 && (
        <div className="bg-card border border-border shadow-sm">
          <div className="px-4 py-3 border-b border-border">
            <div className="text-[12px] font-semibold text-muted-foreground uppercase tracking-wide">
              Surface flags
            </div>
          </div>
          {flags.map((flag) => (
            <FlagRow
              key={flag.name}
              flag={flag}
              onToggle={handleToggle}
              toggling={togglingFlags.has(flag.name)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function FeatureFlagsPage() {
  return (
    <RequireGroup group={ADMIN_GROUP} resource="Feature Flags">
      <FeatureFlagsPanel />
    </RequireGroup>
  );
}
