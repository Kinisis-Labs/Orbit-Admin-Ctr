import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Users2, UserPlus, Trash2, RefreshCw, Loader2, AlertTriangle, CheckCircle2, Info } from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface TesterAccount {
  id: string;
  displayName: string | null;
  tier: string;
  isTester: boolean;
  empireOrgIds: string[];
}

interface TestersResponse {
  testers: TesterAccount[];
  count: number;
}

// ── API helpers ───────────────────────────────────────────────────────────────

async function fetchTesters(): Promise<TestersResponse> {
  const res = await fetch("/api/crm/testers");
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<TestersResponse>;
}

async function provisionTester(userId: string): Promise<void> {
  const res = await fetch(`/api/crm/testers/${encodeURIComponent(userId)}`, { method: "POST" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
}

async function revokeTester(userId: string): Promise<void> {
  const res = await fetch(`/api/crm/testers/${encodeURIComponent(userId)}`, { method: "DELETE" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function TesterManagementPage() {
  const queryClient = useQueryClient();
  const [addUserId, setAddUserId] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  const { data, isLoading, error, refetch, isFetching } = useQuery<TestersResponse>({
    queryKey: ["crm", "testers"],
    queryFn: fetchTesters,
    refetchInterval: 60_000,
  });

  const provisionMutation = useMutation({
    mutationFn: provisionTester,
    onSuccess: (_data, userId) => {
      setActionError(null);
      setActionSuccess(`Provisioned ${userId} as a tester with master tier.`);
      setAddUserId("");
      void queryClient.invalidateQueries({ queryKey: ["crm", "testers"] });
    },
    onError: (err: Error) => {
      setActionSuccess(null);
      setActionError(err.message);
    },
  });

  const revokeMutation = useMutation({
    mutationFn: revokeTester,
    onSuccess: (_data, userId) => {
      setActionError(null);
      setActionSuccess(`Revoked tester access for ${userId}. Account reset to free tier.`);
      void queryClient.invalidateQueries({ queryKey: ["crm", "testers"] });
    },
    onError: (err: Error) => {
      setActionSuccess(null);
      setActionError(err.message);
    },
  });

  const isBusy = provisionMutation.isPending || revokeMutation.isPending;

  function handleProvision(e: React.FormEvent) {
    e.preventDefault();
    const id = addUserId.trim();
    if (!id) return;
    setActionError(null);
    setActionSuccess(null);
    provisionMutation.mutate(id);
  }

  return (
    <div className="p-6 space-y-6 max-w-4xl">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Users2 className="h-6 w-6" style={{ color: "#22d3ee" }} />
          <div>
            <h1 className="text-xl font-bold" style={{ color: "var(--orbit-text-primary)" }}>
              GrailBabe Tester Accounts
            </h1>
            <p className="text-sm" style={{ color: "var(--orbit-text-muted)" }}>
              Manage accounts with master-tier bypass for feature testing
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void refetch()}
          disabled={isFetching}
          className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors"
          style={{ background: "var(--orbit-bg-card)", border: "1px solid var(--orbit-border)", color: "var(--orbit-text-secondary)" }}
        >
          {isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Refresh
        </button>
      </div>

      {/* Info banner */}
      <div className="flex items-start gap-3 rounded-xl px-4 py-3 text-sm" style={{ background: "rgba(34,211,238,0.08)", border: "1px solid rgba(34,211,238,0.25)", color: "#22d3ee" }}>
        <Info className="h-4 w-4 mt-0.5 shrink-0" />
        <span>
          Provisioning grants <strong>master tier</strong> + an active Empire org subscription (1 year trial).
          Revoking resets the account to <strong>free tier</strong>.
          Changes take effect immediately in GrailBabe.
        </span>
      </div>

      {/* Add tester form */}
      <div className="rounded-xl p-5 space-y-3" style={{ background: "var(--orbit-bg-card)", border: "1px solid var(--orbit-border)" }}>
        <h2 className="text-sm font-semibold uppercase tracking-widest" style={{ color: "#22d3ee" }}>
          Add Tester Account
        </h2>
        <p className="text-xs" style={{ color: "var(--orbit-text-muted)" }}>
          Enter the GrailBabe Clerk user ID (starts with <code className="font-mono">user_</code>).
          The user must have signed in at least once.
        </p>
        <form onSubmit={handleProvision} className="flex gap-2">
          <input
            type="text"
            value={addUserId}
            onChange={(e) => setAddUserId(e.target.value)}
            placeholder="user_2abc123..."
            disabled={isBusy}
            className="flex-1 rounded-lg px-3 py-2 text-sm font-mono"
            style={{
              background: "var(--orbit-bg-base)",
              border: "1px solid var(--orbit-border)",
              color: "var(--orbit-text-primary)",
              outline: "none",
            }}
          />
          <button
            type="submit"
            disabled={isBusy || !addUserId.trim()}
            className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors"
            style={{
              background: provisionMutation.isPending ? "rgba(34,211,238,0.2)" : "rgba(34,211,238,0.15)",
              border: "1px solid rgba(34,211,238,0.4)",
              color: "#22d3ee",
              opacity: isBusy || !addUserId.trim() ? 0.5 : 1,
              cursor: isBusy || !addUserId.trim() ? "not-allowed" : "pointer",
            }}
          >
            {provisionMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <UserPlus className="h-4 w-4" />
            )}
            Provision
          </button>
        </form>

        {/* Feedback */}
        {actionError && (
          <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm" style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "#ef4444" }}>
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {actionError}
          </div>
        )}
        {actionSuccess && (
          <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm" style={{ background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.3)", color: "#22c55e" }}>
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            {actionSuccess}
          </div>
        )}
      </div>

      {/* Tester list */}
      <div className="rounded-xl overflow-hidden" style={{ background: "var(--orbit-bg-card)", border: "1px solid var(--orbit-border)" }}>
        <div className="px-5 py-3 flex items-center justify-between" style={{ borderBottom: "1px solid var(--orbit-border)" }}>
          <h2 className="text-sm font-semibold uppercase tracking-widest" style={{ color: "#22d3ee" }}>
            Active Testers
          </h2>
          <span className="text-xs tabular-nums px-2 py-0.5 rounded-full font-medium" style={{ background: "rgba(34,211,238,0.12)", color: "#22d3ee" }}>
            {data?.count ?? 0}
          </span>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12 gap-3" style={{ color: "var(--orbit-text-muted)" }}>
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-sm">Loading tester accounts…</span>
          </div>
        ) : error ? (
          <div className="px-5 py-6 text-sm" style={{ color: "#ef4444" }}>
            {error instanceof Error ? error.message : "Failed to load testers"}
          </div>
        ) : !data?.testers.length ? (
          <div className="px-5 py-10 text-center text-sm" style={{ color: "var(--orbit-text-muted)" }}>
            No tester accounts configured yet.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: "1px solid var(--orbit-border)" }}>
                {["User ID", "Display Name", "Tier", "Empire Orgs", ""].map((h) => (
                  <th key={h} className="px-5 py-3 text-left text-xs font-semibold" style={{ color: "var(--orbit-text-muted)" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.testers.map((t) => (
                <tr key={t.id} style={{ borderBottom: "1px solid var(--orbit-border)" }}>
                  <td className="px-5 py-3 font-mono text-xs" style={{ color: "var(--orbit-text-muted)" }}>
                    {t.id}
                  </td>
                  <td className="px-5 py-3 font-medium" style={{ color: "var(--orbit-text-primary)" }}>
                    {t.displayName ?? <span style={{ color: "var(--orbit-text-muted)" }}>—</span>}
                  </td>
                  <td className="px-5 py-3">
                    <span className="text-xs px-2 py-0.5 rounded-full font-semibold capitalize" style={{ background: "rgba(34,211,238,0.12)", color: "#22d3ee" }}>
                      {t.tier}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-xs" style={{ color: "var(--orbit-text-muted)" }}>
                    {t.empireOrgIds.length > 0 ? t.empireOrgIds.length : "—"}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => {
                        setActionError(null);
                        setActionSuccess(null);
                        revokeMutation.mutate(t.id);
                      }}
                      disabled={isBusy}
                      title="Revoke tester access"
                      className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium ml-auto transition-colors"
                      style={{
                        background: "rgba(239,68,68,0.08)",
                        border: "1px solid rgba(239,68,68,0.3)",
                        color: "#ef4444",
                        opacity: isBusy ? 0.5 : 1,
                        cursor: isBusy ? "not-allowed" : "pointer",
                      }}
                    >
                      {revokeMutation.isPending && revokeMutation.variables === t.id ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Trash2 className="h-3 w-3" />
                      )}
                      Revoke
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
