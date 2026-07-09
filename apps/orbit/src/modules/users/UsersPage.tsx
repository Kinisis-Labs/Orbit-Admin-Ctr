import { useState, useMemo } from "react";
import {
  Users,
  Search,
  Loader2,
  X,
  Shield,
  Key,
  AppWindow,
  ChevronRight,
  Crown,
  Wrench,
} from "lucide-react";
import { useUsers, useUserDetail, type UserSummary } from "../../services/users";
import { useAssignRoleToUser, useRemoveRoleFromUser, useRoles } from "../../services/rbac";

// ── helpers ───────────────────────────────────────────────────────────────────

const card: React.CSSProperties = {
  background: "var(--orbit-bg-card)",
  border: "1px solid var(--orbit-border)",
};

function Badge({ children, variant = "neutral" }: { children: React.ReactNode; variant?: "admin" | "engineer" | "neutral" | "success" }) {
  const styles: Record<string, React.CSSProperties> = {
    admin: { background: "rgba(124,58,237,0.15)", color: "#A78BFA" },
    engineer: { background: "rgba(59,130,246,0.15)", color: "#93C5FD" },
    neutral: { background: "var(--orbit-border)", color: "var(--orbit-text-muted)" },
    success: { background: "rgba(34,197,94,0.1)", color: "var(--orbit-success, #22c55e)" },
  };
  return (
    <span className="inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium" style={styles[variant]}>
      {children}
    </span>
  );
}

function Avatar({ name }: { name: string }) {
  const initial = name?.[0]?.toUpperCase() ?? "?";
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full text-sm font-semibold"
      style={{ width: 36, height: 36, background: "rgba(124,58,237,0.2)", color: "#A78BFA" }}
    >
      {initial}
    </div>
  );
}

// ── User Detail Panel ─────────────────────────────────────────────────────────

function UserDetailPanel({ user, onClose }: { user: UserSummary; onClose: () => void }) {
  const { data: detail, isLoading, error } = useUserDetail(user.id);
  const { data: allRoles } = useRoles();
  const assignRole = useAssignRoleToUser();
  const removeRole = useRemoveRoleFromUser();
  const [selectedRoleId, setSelectedRoleId] = useState("");
  const [tab, setTab] = useState<"roles" | "permissions" | "apps" | "groups">("roles");

  const assignedRoleIds = new Set((detail?.assignedRoles ?? []).map((r) => r.id));
  const availableRoles = (allRoles ?? []).filter((r) => !assignedRoleIds.has(r.id) && r.enabled);

  const handleAssignRole = () => {
    if (!selectedRoleId) return;
    assignRole.mutate({ userId: user.id, roleId: selectedRoleId }, { onSuccess: () => setSelectedRoleId("") });
  };

  const tabs = [
    { id: "roles" as const, label: "Roles", count: detail?.assignedRoles.length },
    { id: "permissions" as const, label: "Permissions", count: detail?.effectivePermissions.length },
    { id: "apps" as const, label: "Applications", count: detail?.authorizedApplications.length },
    { id: "groups" as const, label: "Groups", count: detail?.groupIds.length },
  ];

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/50" onClick={onClose} />
      <div className="flex w-full max-w-lg flex-col overflow-hidden" style={{ ...card, borderLeft: "1px solid var(--orbit-border)" }}>
        {/* Header */}
        <div className="flex items-center gap-3 px-6 py-4 shrink-0" style={{ borderBottom: "1px solid var(--orbit-border)" }}>
          <Avatar name={user.displayName} />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold truncate" style={{ color: "var(--orbit-text-primary)" }}>{user.displayName}</p>
            <p className="text-xs truncate" style={{ color: "var(--orbit-text-muted)" }}>{user.userPrincipalName}</p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {user.isAdmin && <Badge variant="admin"><Crown className="mr-1 h-2.5 w-2.5 inline" />Admin</Badge>}
            {user.isEngineer && <Badge variant="engineer"><Wrench className="mr-1 h-2.5 w-2.5 inline" />Engineer</Badge>}
          </div>
          <button onClick={onClose} className="ml-2 rounded p-1 hover:bg-[var(--orbit-border)]" style={{ color: "var(--orbit-text-muted)" }}>
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Meta */}
        {detail && (
          <div className="px-6 py-3 shrink-0" style={{ borderBottom: "1px solid var(--orbit-border)", background: "var(--orbit-bg-page)" }}>
            <dl className="flex gap-6 text-xs">
              <div>
                <dt style={{ color: "var(--orbit-text-muted)" }}>Job Title</dt>
                <dd className="font-medium mt-0.5" style={{ color: "var(--orbit-text-primary)" }}>{detail.jobTitle || "—"}</dd>
              </div>
              <div>
                <dt style={{ color: "var(--orbit-text-muted)" }}>Groups</dt>
                <dd className="font-medium mt-0.5" style={{ color: "var(--orbit-text-primary)" }}>{detail.groupIds.length}</dd>
              </div>
              <div>
                <dt style={{ color: "var(--orbit-text-muted)" }}>Permissions</dt>
                <dd className="font-medium mt-0.5" style={{ color: "var(--orbit-text-primary)" }}>{detail.effectivePermissions.length}</dd>
              </div>
            </dl>
          </div>
        )}

        {/* Tabs */}
        <div className="flex shrink-0 border-b" style={{ borderColor: "var(--orbit-border)" }}>
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className="flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium transition-colors"
              style={{
                color: tab === t.id ? "var(--orbit-primary)" : "var(--orbit-text-muted)",
                borderBottom: tab === t.id ? "2px solid var(--orbit-primary)" : "2px solid transparent",
              }}
            >
              {t.label}
              {t.count !== undefined && (
                <span className="rounded-full px-1.5 py-0.5 text-[10px]" style={{ background: "var(--orbit-border)", color: "var(--orbit-text-muted)" }}>
                  {t.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {isLoading && (
            <div className="flex items-center gap-2" style={{ color: "var(--orbit-text-muted)" }}>
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">Loading security context…</span>
            </div>
          )}
          {error && <p className="text-sm" style={{ color: "var(--orbit-danger)" }}>{error.message}</p>}

          {detail && tab === "roles" && (
            <div className="space-y-3">
              {detail.assignedRoles.map((r) => (
                <div key={r.assignmentId} className="flex items-center justify-between rounded-lg px-3 py-2" style={{ background: "var(--orbit-bg-page)", border: "1px solid var(--orbit-border)" }}>
                  <div className="flex items-center gap-2">
                    <Shield className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--orbit-primary)" }} />
                    <div>
                      <p className="text-sm font-medium" style={{ color: "var(--orbit-text-primary)" }}>{r.displayName}</p>
                      <p className="text-xs font-mono" style={{ color: "var(--orbit-text-muted)" }}>{r.name}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => removeRole.mutate({ userId: user.id, assignmentId: r.assignmentId })}
                    className="rounded p-1 hover:text-[var(--orbit-danger)]"
                    style={{ color: "var(--orbit-text-muted)" }}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              {detail.assignedRoles.length === 0 && (
                <p className="text-sm" style={{ color: "var(--orbit-text-muted)" }}>No roles assigned.</p>
              )}
              {availableRoles.length > 0 && (
                <div className="flex gap-2 pt-1">
                  <select
                    value={selectedRoleId}
                    onChange={(e) => setSelectedRoleId(e.target.value)}
                    className="flex-1 rounded-lg px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-[var(--orbit-primary)]"
                    style={{ background: "var(--orbit-bg-page)", border: "1px solid var(--orbit-border)", color: "var(--orbit-text-primary)" }}
                  >
                    <option value="">— assign role —</option>
                    {availableRoles.map((r) => (
                      <option key={r.id} value={r.id}>{r.displayName}</option>
                    ))}
                  </select>
                  <button
                    onClick={handleAssignRole}
                    disabled={!selectedRoleId || assignRole.isPending}
                    className="rounded-lg px-3 py-2 text-xs font-medium disabled:opacity-40"
                    style={{ background: "var(--orbit-primary)", color: "#fff" }}
                  >
                    {assignRole.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Assign"}
                  </button>
                </div>
              )}
            </div>
          )}

          {detail && tab === "permissions" && (
            <div className="space-y-1">
              {detail.effectivePermissions.length === 0 ? (
                <p className="text-sm" style={{ color: "var(--orbit-text-muted)" }}>No effective permissions.</p>
              ) : (
                detail.effectivePermissions.map((p) => (
                  <div key={p} className="flex items-center gap-2 rounded px-2 py-1.5" style={{ background: "var(--orbit-bg-page)", border: "1px solid var(--orbit-border)" }}>
                    <Key className="h-3 w-3 shrink-0" style={{ color: "var(--orbit-primary)" }} />
                    <span className="font-mono text-xs" style={{ color: "var(--orbit-text-secondary)" }}>{p}</span>
                  </div>
                ))
              )}
            </div>
          )}

          {detail && tab === "apps" && (
            <div className="space-y-2">
              {detail.authorizedApplications.length === 0 ? (
                <p className="text-sm" style={{ color: "var(--orbit-text-muted)" }}>No authorized applications.</p>
              ) : (
                detail.authorizedApplications.map((app) => (
                  <div key={app.id} className="flex items-center gap-3 rounded-lg px-3 py-2.5" style={{ background: "var(--orbit-bg-page)", border: "1px solid var(--orbit-border)" }}>
                    <AppWindow className="h-4 w-4 shrink-0" style={{ color: "var(--orbit-primary)" }} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium" style={{ color: "var(--orbit-text-primary)" }}>{app.displayName}</p>
                      <p className="text-xs" style={{ color: "var(--orbit-text-muted)" }}>{app.category}</p>
                    </div>
                    {app.url && (
                      <a href={app.url} target="_blank" rel="noreferrer" className="text-xs" style={{ color: "var(--orbit-primary)" }}>
                        Open ↗
                      </a>
                    )}
                  </div>
                ))
              )}
            </div>
          )}

          {detail && tab === "groups" && (
            <div className="space-y-1">
              {detail.groupIds.length === 0 ? (
                <p className="text-sm" style={{ color: "var(--orbit-text-muted)" }}>No group memberships recorded.</p>
              ) : (
                detail.groupIds.map((gid) => (
                  <div key={gid} className="flex items-center gap-2 rounded px-2 py-1.5" style={{ background: "var(--orbit-bg-page)", border: "1px solid var(--orbit-border)" }}>
                    <Users className="h-3 w-3 shrink-0" style={{ color: "var(--orbit-text-muted)" }} />
                    <span className="font-mono text-xs" style={{ color: "var(--orbit-text-secondary)" }}>{gid}</span>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function UsersPage() {
  const { data: users, isLoading, error } = useUsers();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<UserSummary | null>(null);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return (users ?? []).filter(
      (u) =>
        !q ||
        u.displayName.toLowerCase().includes(q) ||
        u.userPrincipalName.toLowerCase().includes(q) ||
        u.jobTitle?.toLowerCase().includes(q),
    );
  }, [users, search]);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-12" style={{ color: "var(--orbit-text-muted)" }}>
        <Loader2 className="h-5 w-5 animate-spin" />
        <span className="text-sm">Loading users…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl p-4 text-sm" style={{ color: "var(--orbit-danger)", border: "1px solid var(--orbit-danger)", background: "var(--orbit-bg-card)" }}>
        Failed to load users: {error.message}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "var(--orbit-text-primary)" }}>Users</h1>
          <p className="text-sm mt-1" style={{ color: "var(--orbit-text-muted)" }}>
            {users?.length ?? 0} user{users?.length === 1 ? "" : "s"} with active sessions
          </p>
        </div>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: "var(--orbit-text-muted)" }} />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, email, or job title…"
          className="w-full rounded-xl py-2.5 pl-9 pr-4 text-sm outline-none focus:ring-1 focus:ring-[var(--orbit-primary)]"
          style={{ background: "var(--orbit-bg-page)", border: "1px solid var(--orbit-border)", color: "var(--orbit-text-primary)" }}
        />
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl p-12 text-center" style={card}>
          <Users className="mx-auto h-10 w-10 mb-3 opacity-20" style={{ color: "var(--orbit-text-muted)" }} />
          <p className="text-sm" style={{ color: "var(--orbit-text-muted)" }}>
            {search ? "No users match your search." : "No users with active sessions found."}
          </p>
        </div>
      ) : (
        <div className="rounded-xl overflow-hidden" style={card}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: "1px solid var(--orbit-border)", background: "var(--orbit-bg-page)" }}>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--orbit-text-muted)" }}>User</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--orbit-text-muted)" }}>Job Title</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--orbit-text-muted)" }}>Access</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--orbit-text-muted)" }}>Groups</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((user, i) => (
                <tr
                  key={user.id}
                  className="cursor-pointer hover:bg-[var(--orbit-border)]/30 transition-colors"
                  onClick={() => setSelected(user)}
                  style={{ borderBottom: i < filtered.length - 1 ? "1px solid var(--orbit-border)" : undefined }}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <Avatar name={user.displayName} />
                      <div>
                        <p className="font-medium" style={{ color: "var(--orbit-text-primary)" }}>{user.displayName}</p>
                        <p className="text-xs" style={{ color: "var(--orbit-text-muted)" }}>{user.userPrincipalName}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs" style={{ color: "var(--orbit-text-secondary)" }}>{user.jobTitle || "—"}</span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {user.isAdmin && <Badge variant="admin"><Crown className="mr-1 h-2.5 w-2.5 inline" />Admin</Badge>}
                      {user.isEngineer && <Badge variant="engineer"><Wrench className="mr-1 h-2.5 w-2.5 inline" />Engineer</Badge>}
                      {!user.isAdmin && !user.isEngineer && <Badge>Member</Badge>}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs" style={{ color: "var(--orbit-text-muted)" }}>{user.groupCount}</span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <ChevronRight className="h-4 w-4 ml-auto" style={{ color: "var(--orbit-text-muted)" }} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && <UserDetailPanel user={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
