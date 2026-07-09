import { useState, useMemo } from "react";
import { Plus, Pencil, Trash2, X, Loader2, Key, Search } from "lucide-react";
import {
  usePermissions,
  useCreatePermission,
  useUpdatePermission,
  useDeletePermission,
  type Permission,
} from "../../services/rbac";

// ── helpers ───────────────────────────────────────────────────────────────────

const card: React.CSSProperties = { background: "var(--orbit-bg-card)", border: "1px solid var(--orbit-border)" };
const inputStyle: React.CSSProperties = {
  background: "var(--orbit-bg-page)",
  border: "1px solid var(--orbit-border)",
  color: "var(--orbit-text-primary)",
};

// Group permissions by application
function groupByApp(perms: Permission[]): Map<string, Permission[]> {
  const map = new Map<string, Permission[]>();
  for (const p of perms) {
    if (!map.has(p.application)) map.set(p.application, []);
    map.get(p.application)!.push(p);
  }
  return map;
}

// ── Permission Form Drawer ────────────────────────────────────────────────────

function PermissionFormDrawer({ initial, onClose }: { initial: Partial<Permission>; onClose: () => void }) {
  const isEdit = !!initial.id;
  const create = useCreatePermission();
  const update = useUpdatePermission();

  const [form, setForm] = useState({
    application: initial.application ?? "Orbit",
    module: initial.module ?? "",
    action: initial.action ?? "",
    displayName: initial.displayName ?? "",
    description: initial.description ?? "",
  });

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const derivedName = `${form.application}.${form.module}.${form.action}`;
  const isPending = create.isPending || update.isPending;
  const mutErr = create.error ?? update.error;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isEdit) {
      update.mutate(
        { id: initial.id!, displayName: form.displayName || derivedName, description: form.description },
        { onSuccess: onClose },
      );
    } else {
      create.mutate(
        {
          application: form.application,
          module: form.module,
          action: form.action,
          displayName: form.displayName || undefined,
          description: form.description || undefined,
        },
        { onSuccess: onClose },
      );
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
            {isEdit ? "Edit Permission" : "Create Permission"}
          </h2>
          <button onClick={onClose} className="rounded p-1 hover:bg-[var(--orbit-border)]" style={{ color: "var(--orbit-text-muted)" }}>
            <X className="h-4 w-4" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {!isEdit && (
            <>
              <div>
                <label className={labelCls} style={{ color: "var(--orbit-text-secondary)" }}>Application *</label>
                <input required value={form.application} onChange={set("application")} className={inputCls} style={inputStyle} placeholder="Orbit" />
              </div>
              <div>
                <label className={labelCls} style={{ color: "var(--orbit-text-secondary)" }}>Module *</label>
                <input required value={form.module} onChange={set("module")} className={inputCls} style={inputStyle} placeholder="Users" />
              </div>
              <div>
                <label className={labelCls} style={{ color: "var(--orbit-text-secondary)" }}>Action *</label>
                <input required value={form.action} onChange={set("action")} className={inputCls} style={inputStyle} placeholder="Create" />
              </div>
              <div className="rounded-lg px-3 py-2 font-mono text-xs" style={{ background: "var(--orbit-bg-page)", color: "var(--orbit-primary)", border: "1px solid var(--orbit-border)" }}>
                {derivedName}
              </div>
            </>
          )}
          <div>
            <label className={labelCls} style={{ color: "var(--orbit-text-secondary)" }}>Display Name</label>
            <input value={form.displayName} onChange={set("displayName")} className={inputCls} style={inputStyle} placeholder={derivedName} />
          </div>
          <div>
            <label className={labelCls} style={{ color: "var(--orbit-text-secondary)" }}>Description</label>
            <textarea value={form.description} onChange={set("description")} rows={2} className={inputCls} style={inputStyle} placeholder="What this permission allows" />
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

export function PermissionsPage() {
  const { data: permissions, isLoading, error } = usePermissions();
  const deletePermission = useDeletePermission();
  const updatePermission = useUpdatePermission();

  const [drawer, setDrawer] = useState<Partial<Permission> | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Permission | null>(null);
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return (permissions ?? []).filter(
      (p) =>
        !q ||
        p.name.toLowerCase().includes(q) ||
        p.displayName.toLowerCase().includes(q) ||
        p.application.toLowerCase().includes(q) ||
        p.module.toLowerCase().includes(q) ||
        p.action.toLowerCase().includes(q),
    );
  }, [permissions, search]);

  const grouped = useMemo(() => groupByApp(filtered), [filtered]);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-12" style={{ color: "var(--orbit-text-muted)" }}>
        <Loader2 className="h-5 w-5 animate-spin" />
        <span className="text-sm">Loading permissions…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl p-4 text-sm" style={{ color: "var(--orbit-danger)", border: "1px solid var(--orbit-danger)", background: "var(--orbit-bg-card)" }}>
        Failed to load permissions: {error.message}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "var(--orbit-text-primary)" }}>Permissions</h1>
          <p className="text-sm mt-1" style={{ color: "var(--orbit-text-muted)" }}>
            {permissions?.length ?? 0} permission{permissions?.length === 1 ? "" : "s"} registered
          </p>
        </div>
        <button
          onClick={() => setDrawer({})}
          className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium"
          style={{ background: "var(--orbit-primary)", color: "#fff" }}
        >
          <Plus className="h-4 w-4" /> Create Permission
        </button>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: "var(--orbit-text-muted)" }} />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search permissions…"
          className="w-full rounded-xl py-2.5 pl-9 pr-4 text-sm outline-none focus:ring-1 focus:ring-[var(--orbit-primary)]"
          style={inputStyle}
        />
      </div>

      {grouped.size === 0 ? (
        <div className="rounded-xl p-12 text-center" style={card}>
          <Key className="mx-auto h-10 w-10 mb-3 opacity-20" style={{ color: "var(--orbit-text-muted)" }} />
          <p className="text-sm" style={{ color: "var(--orbit-text-muted)" }}>
            {search ? "No permissions match your search." : "No permissions defined yet. Click \"Create Permission\" to add one."}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {[...grouped.entries()].map(([app, perms]) => (
            <div key={app} className="rounded-xl overflow-hidden" style={card}>
              <div className="px-4 py-3" style={{ borderBottom: "1px solid var(--orbit-border)", background: "var(--orbit-bg-page)" }}>
                <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--orbit-text-muted)" }}>{app}</p>
              </div>
              <table className="w-full text-sm">
                <tbody>
                  {perms.map((perm, i) => (
                    <tr
                      key={perm.id}
                      style={{
                        background: i % 2 === 0 ? "var(--orbit-bg-card)" : "var(--orbit-bg-page)",
                        borderBottom: "1px solid var(--orbit-border)",
                      }}
                    >
                      <td className="px-4 py-2.5 w-1/2">
                        <p className="font-mono text-xs" style={{ color: "var(--orbit-primary)" }}>{perm.name}</p>
                        {perm.description && (
                          <p className="text-[11px] mt-0.5" style={{ color: "var(--orbit-text-muted)" }}>{perm.description}</p>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <span
                          className="inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium"
                          style={{
                            background: perm.enabled ? "rgba(34,197,94,0.1)" : "var(--orbit-border)",
                            color: perm.enabled ? "var(--orbit-success)" : "var(--orbit-text-muted)",
                          }}
                        >
                          {perm.enabled ? "Enabled" : "Disabled"}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => updatePermission.mutate({ id: perm.id, enabled: !perm.enabled })}
                            className="rounded p-1.5 text-xs hover:bg-[var(--orbit-border)]"
                            style={{ color: "var(--orbit-text-muted)" }}
                            title={perm.enabled ? "Disable" : "Enable"}
                          >
                            {perm.enabled ? "Off" : "On"}
                          </button>
                          <button
                            onClick={() => setDrawer(perm)}
                            className="rounded p-1.5 hover:bg-[var(--orbit-border)]"
                            style={{ color: "var(--orbit-text-muted)" }}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => setConfirmDelete(perm)}
                            className="rounded p-1.5 hover:bg-[var(--orbit-danger)]/10"
                            style={{ color: "var(--orbit-text-muted)" }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      {drawer !== null && <PermissionFormDrawer initial={drawer} onClose={() => setDrawer(null)} />}

      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60" onClick={() => setConfirmDelete(null)} />
          <div className="relative rounded-xl p-6 w-full max-w-sm space-y-4" style={card}>
            <h3 className="text-base font-semibold" style={{ color: "var(--orbit-text-primary)" }}>Delete Permission?</h3>
            <p className="text-sm" style={{ color: "var(--orbit-text-secondary)" }}>
              This will permanently delete <strong className="font-mono">{confirmDelete.name}</strong> and remove it from all roles.
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmDelete(null)} className="rounded-lg px-4 py-2 text-sm" style={{ background: "var(--orbit-border)", color: "var(--orbit-text-primary)" }}>
                Cancel
              </button>
              <button
                onClick={() => deletePermission.mutate(confirmDelete.id, { onSuccess: () => setConfirmDelete(null) })}
                disabled={deletePermission.isPending}
                className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
                style={{ background: "var(--orbit-danger)", color: "#fff" }}
              >
                {deletePermission.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
