import { useState } from "react";
import { Plus, Pencil, Trash2, X, Loader2, Shield, ChevronDown, ChevronRight } from "lucide-react";
import {
  useRoles,
  useRolePermissions,
  usePermissions,
  useCreateRole,
  useUpdateRole,
  useDeleteRole,
  useAssignPermissionToRole,
  useRemovePermissionFromRole,
  type Role,
  type RolePermission,
} from "../../services/rbac";
// ── helpers ───────────────────────────────────────────────────────────────────

const card: React.CSSProperties = { background: "var(--orbit-bg-card)", border: "1px solid var(--orbit-border)" };
const inputStyle: React.CSSProperties = {
  background: "var(--orbit-bg-page)",
  border: "1px solid var(--orbit-border)",
  color: "var(--orbit-text-primary)",
};

function Badge({ children, ok }: { children: React.ReactNode; ok: boolean }) {
  return (
    <span
      className="inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium"
      style={{
        background: ok ? "var(--orbit-success-bg, rgba(34,197,94,0.1))" : "var(--orbit-border)",
        color: ok ? "var(--orbit-success)" : "var(--orbit-text-muted)",
      }}
    >
      {children}
    </span>
  );
}

// ── Role Permissions Panel ────────────────────────────────────────────────────

function RolePermissionsPanel({ roleId }: { roleId: string }) {
  const { data: rolePerms, isLoading } = useRolePermissions(roleId);
  const { data: allPerms } = usePermissions();
  const assign = useAssignPermissionToRole();
  const remove = useRemovePermissionFromRole();
  const [selectedPermId, setSelectedPermId] = useState("");

  const assignedIds = new Set((rolePerms ?? []).map((rp) => rp.id));
  const available = (allPerms ?? []).filter((p) => !assignedIds.has(p.id) && p.enabled);

  const handleAssign = () => {
    if (!selectedPermId) return;
    assign.mutate({ roleId, permissionId: selectedPermId }, { onSuccess: () => setSelectedPermId("") });
  };

  return (
    <div className="mt-3 space-y-2 pl-2">
      <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: "var(--orbit-text-muted)" }}>
        Permissions
      </p>
      {isLoading ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" style={{ color: "var(--orbit-text-muted)" }} />
      ) : (
        <div className="space-y-1">
          {(rolePerms ?? []).map((rp: RolePermission) => (
            <div key={rp.mappingId} className="flex items-center justify-between rounded px-2 py-1" style={{ background: "var(--orbit-bg-page)", border: "1px solid var(--orbit-border)" }}>
              <span className="font-mono text-[11px]" style={{ color: "var(--orbit-text-secondary)" }}>{rp.name}</span>
              <button
                onClick={() => remove.mutate({ roleId, mappingId: rp.mappingId })}
                className="rounded p-0.5 hover:text-[var(--orbit-danger)]"
                style={{ color: "var(--orbit-text-muted)" }}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
          {(rolePerms ?? []).length === 0 && (
            <p className="text-[11px]" style={{ color: "var(--orbit-text-muted)" }}>No permissions assigned.</p>
          )}
        </div>
      )}
      {available.length > 0 && (
        <div className="flex gap-2 pt-1">
          <select
            value={selectedPermId}
            onChange={(e) => setSelectedPermId(e.target.value)}
            className="flex-1 rounded px-2 py-1 text-xs outline-none"
            style={inputStyle}
          >
            <option value="">— add permission —</option>
            {available.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <button
            onClick={handleAssign}
            disabled={!selectedPermId || assign.isPending}
            className="flex items-center gap-1 rounded px-3 py-1 text-xs font-medium disabled:opacity-40"
            style={{ background: "var(--orbit-primary)", color: "#fff" }}
          >
            {assign.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
            Add
          </button>
        </div>
      )}
    </div>
  );
}

// ── Role Form Drawer ──────────────────────────────────────────────────────────

function RoleFormDrawer({ initial, onClose }: { initial: Partial<Role>; onClose: () => void }) {
  const isEdit = !!initial.id;
  const create = useCreateRole();
  const update = useUpdateRole();
  const [form, setForm] = useState({
    name: initial.name ?? "",
    displayName: initial.displayName ?? "",
    description: initial.description ?? "",
  });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const isPending = create.isPending || update.isPending;
  const mutErr = create.error ?? update.error;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isEdit) {
      update.mutate({ id: initial.id!, ...form }, { onSuccess: onClose });
    } else {
      create.mutate(form, { onSuccess: onClose });
    }
  };

  const inputCls = "w-full rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-[var(--orbit-primary)]";
  const labelCls = "block text-xs font-medium mb-1";

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/50" onClick={onClose} />
      <div className="w-full max-w-md overflow-y-auto" style={{ ...card, borderLeft: "1px solid var(--orbit-border)" }}>
        <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: "1px solid var(--orbit-border)" }}>
          <h2 className="text-base font-semibold" style={{ color: "var(--orbit-text-primary)" }}>
            {isEdit ? "Edit Role" : "Create Role"}
          </h2>
          <button onClick={onClose} className="rounded p-1 hover:bg-[var(--orbit-border)]" style={{ color: "var(--orbit-text-muted)" }}>
            <X className="h-4 w-4" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className={labelCls} style={{ color: "var(--orbit-text-secondary)" }}>Display Name *</label>
            <input required value={form.displayName} onChange={set("displayName")} className={inputCls} style={inputStyle} placeholder="Orbit Administrator" />
          </div>
          <div>
            <label className={labelCls} style={{ color: "var(--orbit-text-secondary)" }}>Name (slug) *</label>
            <input required value={form.name} onChange={set("name")} className={inputCls} style={inputStyle} placeholder="orbit-administrator" disabled={isEdit} />
            <p className="mt-1 text-[11px]" style={{ color: "var(--orbit-text-muted)" }}>Lowercase, hyphens only. Auto-generated if empty.</p>
          </div>
          <div>
            <label className={labelCls} style={{ color: "var(--orbit-text-secondary)" }}>Description</label>
            <textarea value={form.description} onChange={set("description")} rows={2} className={inputCls} style={inputStyle} placeholder="What this role grants access to" />
          </div>
          {mutErr && <p className="text-xs" style={{ color: "var(--orbit-danger)" }}>{mutErr.message}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm" style={{ background: "var(--orbit-border)", color: "var(--orbit-text-primary)" }}>
              Cancel
            </button>
            <button type="submit" disabled={isPending} className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50" style={{ background: "var(--orbit-primary)", color: "#fff" }}>
              {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {isEdit ? "Save" : "Create"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function RolesPage() {
  const { data: roles, isLoading, error } = useRoles();
  const deleteRole = useDeleteRole();
  const updateRole = useUpdateRole();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<Partial<Role> | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Role | null>(null);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-12" style={{ color: "var(--orbit-text-muted)" }}>
        <Loader2 className="h-5 w-5 animate-spin" />
        <span className="text-sm">Loading roles…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl p-4 text-sm" style={{ color: "var(--orbit-danger)", border: "1px solid var(--orbit-danger)", background: "var(--orbit-bg-card)" }}>
        Failed to load roles: {error.message}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "var(--orbit-text-primary)" }}>Roles</h1>
          <p className="text-sm mt-1" style={{ color: "var(--orbit-text-muted)" }}>
            {roles?.length ?? 0} role{roles?.length === 1 ? "" : "s"} defined
          </p>
        </div>
        <button
          onClick={() => setDrawer({})}
          className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium"
          style={{ background: "var(--orbit-primary)", color: "#fff" }}
        >
          <Plus className="h-4 w-4" /> Create Role
        </button>
      </div>

      <div className="space-y-2">
        {(roles ?? []).map((role) => {
          const expanded = expandedId === role.id;
          return (
            <div key={role.id} className="rounded-xl overflow-hidden" style={card}>
              <div className="flex items-center gap-3 px-4 py-3">
                <button
                  onClick={() => setExpandedId(expanded ? null : role.id)}
                  className="flex items-center gap-2 flex-1 text-left"
                >
                  {expanded ? (
                    <ChevronDown className="h-4 w-4 shrink-0" style={{ color: "var(--orbit-text-muted)" }} />
                  ) : (
                    <ChevronRight className="h-4 w-4 shrink-0" style={{ color: "var(--orbit-text-muted)" }} />
                  )}
                  <Shield className="h-4 w-4 shrink-0" style={{ color: "var(--orbit-primary)" }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold" style={{ color: "var(--orbit-text-primary)" }}>{role.displayName}</p>
                    <p className="text-xs font-mono" style={{ color: "var(--orbit-text-muted)" }}>{role.name}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {role.isSystem && <Badge ok={false}>system</Badge>}
                    <Badge ok={role.enabled}>{role.enabled ? "Enabled" : "Disabled"}</Badge>
                  </div>
                </button>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => updateRole.mutate({ id: role.id, enabled: !role.enabled })}
                    className="rounded p-1.5 text-xs hover:bg-[var(--orbit-border)]"
                    style={{ color: "var(--orbit-text-muted)" }}
                    title={role.enabled ? "Disable" : "Enable"}
                  >
                    {role.enabled ? "Off" : "On"}
                  </button>
                  <button
                    onClick={() => setDrawer(role)}
                    className="rounded p-1.5 hover:bg-[var(--orbit-border)]"
                    style={{ color: "var(--orbit-text-muted)" }}
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  {!role.isSystem && (
                    <button
                      onClick={() => setConfirmDelete(role)}
                      className="rounded p-1.5 hover:bg-[var(--orbit-danger)]/10"
                      style={{ color: "var(--orbit-text-muted)" }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
              {expanded && (
                <div className="px-6 pb-4" style={{ borderTop: "1px solid var(--orbit-border)" }}>
                  {role.description && (
                    <p className="pt-3 text-sm" style={{ color: "var(--orbit-text-secondary)" }}>{role.description}</p>
                  )}
                  <RolePermissionsPanel roleId={role.id} />
                </div>
              )}
            </div>
          );
        })}
        {(roles ?? []).length === 0 && (
          <div className="rounded-xl p-12 text-center" style={card}>
            <Shield className="mx-auto h-10 w-10 mb-3 opacity-20" style={{ color: "var(--orbit-text-muted)" }} />
            <p className="text-sm" style={{ color: "var(--orbit-text-muted)" }}>No roles defined yet. Click "Create Role" to add one.</p>
          </div>
        )}
      </div>

      {drawer !== null && <RoleFormDrawer initial={drawer} onClose={() => setDrawer(null)} />}

      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60" onClick={() => setConfirmDelete(null)} />
          <div className="relative rounded-xl p-6 w-full max-w-sm space-y-4" style={card}>
            <h3 className="text-base font-semibold" style={{ color: "var(--orbit-text-primary)" }}>Delete Role?</h3>
            <p className="text-sm" style={{ color: "var(--orbit-text-secondary)" }}>
              This will permanently delete <strong>{confirmDelete.displayName}</strong> and revoke it from all assigned users.
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmDelete(null)} className="rounded-lg px-4 py-2 text-sm" style={{ background: "var(--orbit-border)", color: "var(--orbit-text-primary)" }}>
                Cancel
              </button>
              <button
                onClick={() => deleteRole.mutate(confirmDelete.id, { onSuccess: () => setConfirmDelete(null) })}
                disabled={deleteRole.isPending}
                className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
                style={{ background: "var(--orbit-danger)", color: "#fff" }}
              >
                {deleteRole.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
