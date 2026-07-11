import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Users2, UserPlus, Trash2, RefreshCw, Loader2, AlertTriangle, CheckCircle2, XCircle, Info, Search, X, RotateCcw } from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface TesterAccount {
  id: string;
  displayName: string | null;
  email: string | null;
  tier: string;
  isTester: boolean;
  empireOrgIds: string[];
  daysUntilExpiry: number | null;
}

interface TestersResponse {
  testers: TesterAccount[];
  count: number;
}

interface UserSearchResult {
  id: string;
  name: string | null;
  email: string | null;
  tier: string | null;
  isTester: boolean;
  hasProfile: boolean;
}

// ── API helpers ───────────────────────────────────────────────────────────────

async function fetchUserSearch(q: string): Promise<UserSearchResult[]> {
  if (q.trim().length < 2) return [];
  const res = await fetch(`/api/crm/users/search?q=${encodeURIComponent(q)}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  const data = (await res.json()) as { users: UserSearchResult[] };
  return data.users;
}

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

async function renewTester(userId: string): Promise<void> {
  const res = await fetch(`/api/crm/testers/${encodeURIComponent(userId)}/renew`, { method: "POST" });
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

// ── User search box ──────────────────────────────────────────────────────────

function UserSearchBox({ onSelect, disabled }: { onSelect: (user: UserSearchResult) => void; disabled: boolean }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const { data: results = [], isFetching } = useQuery<UserSearchResult[]>({
    queryKey: ["crm", "user-search", q],
    queryFn: () => fetchUserSearch(q),
    enabled: q.trim().length >= 2,
    staleTime: 30_000,
  });

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function tierBadgeStyle(tier: string | null) {
    if (tier === "master") return { background: "rgba(168,85,247,0.15)", color: "#a855f7" };
    if (tier === "pro") return { background: "rgba(34,211,238,0.12)", color: "#22d3ee" };
    return { background: "var(--orbit-border)", color: "var(--orbit-text-muted)" };
  }

  return (
    <div ref={wrapperRef} className="relative">
      <div className="flex items-center gap-2 rounded-lg px-3 py-2" style={{ background: "var(--orbit-bg-base)", border: "1px solid var(--orbit-border)" }}>
        {isFetching ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" style={{ color: "var(--orbit-text-muted)" }} /> : <Search className="h-4 w-4 shrink-0" style={{ color: "var(--orbit-text-muted)" }} />}
        <input
          type="text"
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder="Search by name or email…"
          disabled={disabled}
          autoComplete="off"
          className="flex-1 bg-transparent text-sm outline-none"
          style={{ color: "var(--orbit-text-primary)" }}
        />
        {q && (
          <button type="button" onClick={() => { setQ(""); setOpen(false); }} style={{ color: "var(--orbit-text-muted)" }}>
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {open && q.trim().length >= 2 && (
        <div className="absolute z-50 mt-1 w-full rounded-xl overflow-hidden shadow-xl" style={{ background: "var(--orbit-bg-card)", border: "1px solid var(--orbit-border)" }}>
          {results.length === 0 && !isFetching ? (
            <div className="px-4 py-3 text-sm" style={{ color: "var(--orbit-text-muted)" }}>No users found</div>
          ) : (
            results.map((u) => (
              <button
                key={u.id}
                type="button"
                disabled={u.isTester}
                onClick={() => { onSelect(u); setQ(""); setOpen(false); }}
                className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left text-sm transition-colors hover:bg-[rgba(255,255,255,0.04)] disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ borderBottom: "1px solid var(--orbit-border)" }}
              >
                <div className="min-w-0">
                  <p className="font-medium truncate" style={{ color: "var(--orbit-text-primary)" }}>{u.name ?? "(no name)"}</p>
                  <p className="text-xs truncate" style={{ color: "var(--orbit-text-muted)" }}>{u.email ?? u.id}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {u.isTester && <span className="text-xs px-1.5 py-0.5 rounded font-medium" style={{ background: "rgba(34,197,94,0.12)", color: "#22c55e" }}>tester</span>}
                  <span className="text-xs px-1.5 py-0.5 rounded font-medium capitalize" style={tierBadgeStyle(u.tier)}>{u.tier ?? "free"}</span>
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function TesterManagementPage() {
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [renewingIds, setRenewingIds] = useState<Set<string>>(new Set());

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
      void queryClient.invalidateQueries({ queryKey: ["crm", "testers"] });
    },
    onError: (err: Error) => {
      setActionSuccess(null);
      setActionError(err.message);
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
      errorTimerRef.current = setTimeout(() => setActionError(null), 8000);
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

  const renewMutation = useMutation({
    mutationFn: renewTester,
    onSuccess: (_data, userId) => {
      setActionSuccess(`Renewed ${userId}`);
      setActionError(null);
      setRenewingIds((prev) => { const s = new Set(prev); s.delete(userId); return s; });
      void queryClient.invalidateQueries({ queryKey: ["crm", "testers"] });
    },
    onError: (err: Error, userId) => {
      setActionError(`Renew failed for ${userId}: ${err.message}`);
      setActionSuccess(null);
      setRenewingIds((prev) => { const s = new Set(prev); s.delete(userId); return s; });
    },
  });

  async function handleRenewSelected() {
    setActionError(null);
    setActionSuccess(null);
    const ids = [...selected];
    setSelected(new Set());
    setRenewingIds(new Set(ids));
    for (const id of ids) {
      await renewTester(id).catch((err: Error) => {
        setActionError(`Renew failed for ${id}: ${err.message}`);
      });
      setRenewingIds((prev) => { const s = new Set(prev); s.delete(id); return s; });
    }
    setActionSuccess(`Renewed ${ids.length} account${ids.length !== 1 ? "s" : ""}`);
    void queryClient.invalidateQueries({ queryKey: ["crm", "testers"] });
  }

  const isBusy = provisionMutation.isPending || revokeMutation.isPending;

  function handleSelectUser(user: UserSearchResult) {
    setActionError(null);
    setActionSuccess(null);
    provisionMutation.mutate(user.id);
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
          Search by name or email. Select a user to provision them with master tier + Empire org.
          The user must have signed in to GrailBabe at least once.
        </p>
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <UserSearchBox onSelect={handleSelectUser} disabled={isBusy} />
          </div>
          {provisionMutation.isPending && (
            <div className="flex items-center gap-2 text-sm" style={{ color: "#22d3ee" }}>
              <Loader2 className="h-4 w-4 animate-spin" />
              Provisioning…
            </div>
          )}
        </div>

        {/* Feedback */}
        {actionError && (
          <div className="flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm" style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "#ef4444" }}>
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {actionError}
            </div>
            <button type="button" onClick={() => setActionError(null)} style={{ color: "#ef4444", opacity: 0.7 }}>
              <X className="h-3.5 w-3.5" />
            </button>
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
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-semibold uppercase tracking-widest" style={{ color: "#22d3ee" }}>Active Testers</h2>
            <span className="text-xs tabular-nums px-2 py-0.5 rounded-full font-medium" style={{ background: "rgba(34,211,238,0.12)", color: "#22d3ee" }}>{data?.count ?? 0}</span>
          </div>
          {selected.size > 0 && (
            <button
              type="button"
              onClick={handleRenewSelected}
              disabled={renewingIds.size > 0}
              className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors"
              style={{
                background: "rgba(34,211,238,0.12)",
                border: "1px solid rgba(34,211,238,0.4)",
                color: "#22d3ee",
                opacity: renewingIds.size > 0 ? 0.5 : 1,
                cursor: renewingIds.size > 0 ? "not-allowed" : "pointer",
              }}
            >
              {renewingIds.size > 0 ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
              Renew {selected.size} selected
            </button>
          )}
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
                {["", "Email", "Display Name", "Tier", "Days Left", "Empire Orgs", ""].map((h, i) => (
                  <th key={h} className="px-5 py-3 text-left text-xs font-semibold" style={{ color: "var(--orbit-text-muted)", width: i === 0 ? "2.5rem" : undefined }}>
                    {i === 0 ? (
                      <input
                        type="checkbox"
                        aria-label="Select all"
                        checked={data?.testers.length > 0 && selected.size === data.testers.length}
                        onChange={(e) => setSelected(e.target.checked ? new Set(data?.testers.map((t) => t.id) ?? []) : new Set())}
                        className="cursor-pointer"
                      />
                    ) : h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.testers.map((t) => (
                <tr key={t.id} style={{ borderBottom: "1px solid var(--orbit-border)", background: selected.has(t.id) ? "rgba(34,211,238,0.04)" : undefined }}>
                  <td className="px-5 py-3">
                    <input
                      type="checkbox"
                      aria-label={`Select ${t.email ?? t.id}`}
                      checked={selected.has(t.id)}
                      onChange={(e) => setSelected((prev) => { const s = new Set(prev); if (e.target.checked) { s.add(t.id); } else { s.delete(t.id); } return s; })}
                      className="cursor-pointer"
                    />
                  </td>
                  <td className="px-5 py-3 text-xs" style={{ color: "var(--orbit-text-muted)" }}>
                    {t.email ?? t.id}
                  </td>
                  <td className="px-5 py-3 font-medium" style={{ color: "var(--orbit-text-primary)" }}>
                    {t.displayName ?? <span style={{ color: "var(--orbit-text-muted)" }}>—</span>}
                  </td>
                  <td className="px-5 py-3">
                    <span className="text-xs px-2 py-0.5 rounded-full font-semibold capitalize" style={{ background: "rgba(34,211,238,0.12)", color: "#22d3ee" }}>
                      {t.tier}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-xs tabular-nums">
                    {t.daysUntilExpiry !== null ? (() => {
                      const critical = t.daysUntilExpiry <= 30;
                      const warning = t.daysUntilExpiry <= 90;
                      const color = critical ? "#ef4444" : warning ? "#f59e0b" : "#22c55e";
                      const bg = critical ? "rgba(239,68,68,0.1)" : warning ? "rgba(245,158,11,0.1)" : "rgba(34,197,94,0.1)";
                      const Icon = critical ? XCircle : warning ? AlertTriangle : CheckCircle2;
                      return (
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full font-semibold" style={{ background: bg, color }}>
                          <Icon className="h-3 w-3" />
                          {t.daysUntilExpiry}d
                        </span>
                      );
                    })() : (
                      <span style={{ color: "var(--orbit-text-muted)" }}>—</span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-xs" style={{ color: "var(--orbit-text-muted)" }}>
                    {t.empireOrgIds.length > 0 ? t.empireOrgIds.length : "—"}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => { setActionError(null); setActionSuccess(null); setRenewingIds((p) => new Set([...p, t.id])); renewMutation.mutate(t.id); }}
                        disabled={isBusy || renewingIds.has(t.id)}
                        title="Renew 1 year"
                        className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors"
                        style={{
                          background: "rgba(34,211,238,0.08)",
                          border: "1px solid rgba(34,211,238,0.3)",
                          color: "#22d3ee",
                          opacity: isBusy || renewingIds.has(t.id) ? 0.5 : 1,
                          cursor: isBusy || renewingIds.has(t.id) ? "not-allowed" : "pointer",
                        }}
                      >
                        {renewingIds.has(t.id) ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
                        Renew
                      </button>
                      <button
                        type="button"
                        onClick={() => { setActionError(null); setActionSuccess(null); revokeMutation.mutate(t.id); }}
                        disabled={isBusy}
                        title="Revoke tester access"
                        className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors"
                        style={{
                          background: "rgba(239,68,68,0.08)",
                          border: "1px solid rgba(239,68,68,0.3)",
                          color: "#ef4444",
                          opacity: isBusy ? 0.5 : 1,
                          cursor: isBusy ? "not-allowed" : "pointer",
                        }}
                      >
                        {revokeMutation.isPending && revokeMutation.variables === t.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                        Revoke
                      </button>
                    </div>
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
