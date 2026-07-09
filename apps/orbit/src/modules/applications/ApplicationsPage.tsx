import { useState } from "react";
import {
  Plus,
  Pencil,
  Trash2,
  ToggleLeft,
  ToggleRight,
  X,
  Loader2,
  Tag,
} from "lucide-react";
import {
  useAllApplications,
  useCreateApplication,
  useUpdateApplication,
  useDeleteApplication,
  useAddGroupMapping,
  useRemoveGroupMapping,
  useApplicationGroupMappings,
  type Application,
  type ApplicationWithMappings,
} from "../../services/applications";
import { cn } from "../../lib/cn";

// ── helpers ───────────────────────────────────────────────────────────────────

function Badge({ children, variant = "default" }: { children: React.ReactNode; variant?: "default" | "success" | "muted" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium",
        variant === "success" && "bg-[var(--orbit-success)]/10 text-[var(--orbit-success)]",
        variant === "muted" && "bg-[var(--orbit-border)] text-[var(--orbit-text-muted)]",
        variant === "default" && "bg-[var(--orbit-primary)]/10 text-[var(--orbit-primary)]",
      )}
    >
      {children}
    </span>
  );
}

// ── Group Mappings Panel ──────────────────────────────────────────────────────

function GroupMappingsPanel({ appId }: { appId: string }) {
  const { data: mappings, isLoading } = useApplicationGroupMappings(appId);
  const addMapping = useAddGroupMapping();
  const removeMapping = useRemoveGroupMapping();
  const [groupId, setGroupId] = useState("");
  const [groupName, setGroupName] = useState("");

  const handleAdd = () => {
    if (!groupId.trim()) return;
    addMapping.mutate(
      { applicationId: appId, entraGroupId: groupId.trim(), entraGroupName: groupName.trim() || undefined },
      { onSuccess: () => { setGroupId(""); setGroupName(""); } },
    );
  };

  return (
    <div className="mt-4 space-y-3">
      <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--orbit-text-muted)" }}>
        Entra Group Access
      </p>
      {isLoading ? (
        <Loader2 className="h-4 w-4 animate-spin" style={{ color: "var(--orbit-text-muted)" }} />
      ) : (
        <div className="space-y-1.5">
          {(mappings ?? []).map((m) => (
            <div key={m.id} className="flex items-center justify-between rounded-lg px-3 py-2" style={{ background: "var(--orbit-bg-page)", border: "1px solid var(--orbit-border)" }}>
              <div>
                <p className="text-xs font-medium" style={{ color: "var(--orbit-text-primary)" }}>{m.entraGroupName ?? m.entraGroupId}</p>
                <p className="text-[10px] font-mono" style={{ color: "var(--orbit-text-muted)" }}>{m.entraGroupId}</p>
              </div>
              <button
                onClick={() => removeMapping.mutate({ applicationId: appId, mappingId: m.id })}
                className="rounded p-1 hover:bg-[var(--orbit-danger)]/10 hover:text-[var(--orbit-danger)]"
                style={{ color: "var(--orbit-text-muted)" }}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          {(mappings ?? []).length === 0 && (
            <p className="text-xs" style={{ color: "var(--orbit-text-muted)" }}>No group mappings — all authenticated users can access this app.</p>
          )}
        </div>
      )}

      <div className="flex gap-2 pt-1">
        <input
          placeholder="Entra group ID (GUID)"
          value={groupId}
          onChange={(e) => setGroupId(e.target.value)}
          className="flex-1 rounded-lg px-3 py-1.5 text-xs outline-none"
          style={{ background: "var(--orbit-bg-page)", border: "1px solid var(--orbit-border)", color: "var(--orbit-text-primary)" }}
        />
        <input
          placeholder="Display name (optional)"
          value={groupName}
          onChange={(e) => setGroupName(e.target.value)}
          className="flex-1 rounded-lg px-3 py-1.5 text-xs outline-none"
          style={{ background: "var(--orbit-bg-page)", border: "1px solid var(--orbit-border)", color: "var(--orbit-text-primary)" }}
        />
        <button
          onClick={handleAdd}
          disabled={!groupId.trim() || addMapping.isPending}
          className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-40"
          style={{ background: "var(--orbit-primary)", color: "#fff" }}
        >
          {addMapping.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
          Add
        </button>
      </div>
    </div>
  );
}

// ── App Form Drawer ───────────────────────────────────────────────────────────

interface AppFormProps {
  initial?: Partial<Application>;
  onClose: () => void;
}

function AppFormDrawer({ initial, onClose }: AppFormProps) {
  const isEdit = !!initial?.id;
  const create = useCreateApplication();
  const update = useUpdateApplication();

  const [form, setForm] = useState({
    slug: initial?.slug ?? "",
    displayName: initial?.displayName ?? "",
    description: initial?.description ?? "",
    url: initial?.url ?? "",
    healthCheckUrl: initial?.healthCheckUrl ?? "",
    category: initial?.category ?? "application",
    tags: (initial?.tags ?? []).join(", "),
    enabled: initial?.enabled ?? true,
    logoUrl: initial?.logoUrl ?? "",
  });

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const isPending = create.isPending || update.isPending;
  const mutErr = create.error ?? update.error;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const payload = {
      ...form,
      tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean),
    };
    if (isEdit) {
      update.mutate({ id: initial!.id!, ...payload }, { onSuccess: onClose });
    } else {
      create.mutate(payload, { onSuccess: onClose });
    }
  };

  const inputCls = "w-full rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-[var(--orbit-primary)]";
  const inputStyle = { background: "var(--orbit-bg-page)", border: "1px solid var(--orbit-border)", color: "var(--orbit-text-primary)" };
  const labelCls = "block text-xs font-medium mb-1";

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/50" onClick={onClose} />
      <div className="w-full max-w-md overflow-y-auto" style={{ background: "var(--orbit-bg-card)", borderLeft: "1px solid var(--orbit-border)" }}>
        <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: "1px solid var(--orbit-border)" }}>
          <h2 className="text-base font-semibold" style={{ color: "var(--orbit-text-primary)" }}>
            {isEdit ? "Edit Application" : "Register Application"}
          </h2>
          <button onClick={onClose} className="rounded p-1 hover:bg-[var(--orbit-border)]" style={{ color: "var(--orbit-text-muted)" }}>
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className={labelCls} style={{ color: "var(--orbit-text-secondary)" }}>Display Name *</label>
            <input required value={form.displayName} onChange={set("displayName")} className={inputCls} style={inputStyle} placeholder="GrailBabe" />
          </div>
          <div>
            <label className={labelCls} style={{ color: "var(--orbit-text-secondary)" }}>Slug *</label>
            <input required value={form.slug} onChange={set("slug")} className={inputCls} style={inputStyle} placeholder="grailbabe" disabled={isEdit} />
          </div>
          <div>
            <label className={labelCls} style={{ color: "var(--orbit-text-secondary)" }}>Description</label>
            <textarea value={form.description} onChange={set("description")} rows={2} className={inputCls} style={inputStyle} placeholder="Short description" />
          </div>
          <div>
            <label className={labelCls} style={{ color: "var(--orbit-text-secondary)" }}>URL</label>
            <input value={form.url} onChange={set("url")} className={inputCls} style={inputStyle} placeholder="https://app.example.com" />
          </div>
          <div>
            <label className={labelCls} style={{ color: "var(--orbit-text-secondary)" }}>Health Check URL</label>
            <input value={form.healthCheckUrl} onChange={set("healthCheckUrl")} className={inputCls} style={inputStyle} placeholder="https://app.example.com/api/health" />
          </div>
          <div>
            <label className={labelCls} style={{ color: "var(--orbit-text-secondary)" }}>Logo URL</label>
            <input value={form.logoUrl} onChange={set("logoUrl")} className={inputCls} style={inputStyle} placeholder="https://cdn.example.com/logo.png" />
          </div>
          <div>
            <label className={labelCls} style={{ color: "var(--orbit-text-secondary)" }}>Category</label>
            <select value={form.category} onChange={set("category")} className={inputCls} style={inputStyle}>
              <option value="application">Application</option>
              <option value="internal-tool">Internal Tool</option>
              <option value="service">Service</option>
              <option value="platform">Platform</option>
            </select>
          </div>
          <div>
            <label className={labelCls} style={{ color: "var(--orbit-text-secondary)" }}>Tags (comma separated)</label>
            <input value={form.tags} onChange={set("tags")} className={inputCls} style={inputStyle} placeholder="mobile, ios, production" />
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setForm((f) => ({ ...f, enabled: !f.enabled }))}
              className="flex items-center gap-2 text-sm"
              style={{ color: form.enabled ? "var(--orbit-success)" : "var(--orbit-text-muted)" }}
            >
              {form.enabled ? <ToggleRight className="h-5 w-5" /> : <ToggleLeft className="h-5 w-5" />}
              {form.enabled ? "Enabled" : "Disabled"}
            </button>
          </div>

          {isEdit && initial?.id && <GroupMappingsPanel appId={initial.id} />}

          {mutErr && (
            <p className="text-xs" style={{ color: "var(--orbit-danger)" }}>{mutErr.message}</p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm" style={{ background: "var(--orbit-border)", color: "var(--orbit-text-primary)" }}>
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
              style={{ background: "var(--orbit-primary)", color: "#fff" }}
            >
              {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {isEdit ? "Save Changes" : "Register"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function ApplicationsPage() {
  const { data: apps, isLoading, error } = useAllApplications();
  const deleteApp = useDeleteApplication();
  const update = useUpdateApplication();

  const [drawerApp, setDrawerApp] = useState<Partial<Application> | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ApplicationWithMappings | null>(null);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-12" style={{ color: "var(--orbit-text-muted)" }}>
        <Loader2 className="h-5 w-5 animate-spin" />
        <span className="text-sm">Loading applications…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl p-4 text-sm" style={{ background: "var(--orbit-danger)/10", border: "1px solid var(--orbit-danger)", color: "var(--orbit-danger)" }}>
        Failed to load applications: {error.message}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "var(--orbit-text-primary)" }}>Applications</h1>
          <p className="text-sm mt-1" style={{ color: "var(--orbit-text-muted)" }}>
            {apps?.length ?? 0} registered application{apps?.length === 1 ? "" : "s"}
          </p>
        </div>
        <button
          onClick={() => setDrawerApp({})}
          className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium"
          style={{ background: "var(--orbit-primary)", color: "#fff" }}
        >
          <Plus className="h-4 w-4" />
          Register App
        </button>
      </div>

      <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--orbit-border)" }}>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: "var(--orbit-bg-card)", borderBottom: "1px solid var(--orbit-border)" }}>
              {["App", "Category", "Tags", "Groups", "Status", ""].map((h) => (
                <th key={h} className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: "var(--orbit-text-muted)" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(apps ?? []).map((app, i) => (
              <tr
                key={app.id}
                style={{
                  background: i % 2 === 0 ? "var(--orbit-bg-page)" : "var(--orbit-bg-card)",
                  borderBottom: "1px solid var(--orbit-border)",
                }}
              >
                <td className="px-4 py-3">
                  <div className="font-medium" style={{ color: "var(--orbit-text-primary)" }}>{app.displayName}</div>
                  <div className="text-xs font-mono" style={{ color: "var(--orbit-text-muted)" }}>/{app.slug}</div>
                </td>
                <td className="px-4 py-3">
                  <Badge variant="default">{app.category}</Badge>
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {app.tags.slice(0, 3).map((t) => (
                      <span key={t} className="flex items-center gap-0.5 text-[10px]" style={{ color: "var(--orbit-text-muted)" }}>
                        <Tag className="h-2.5 w-2.5" />{t}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-3 text-xs" style={{ color: "var(--orbit-text-muted)" }}>
                  {app.groupMappings.length === 0 ? "Open" : `${app.groupMappings.length} group${app.groupMappings.length === 1 ? "" : "s"}`}
                </td>
                <td className="px-4 py-3">
                  <Badge variant={app.enabled ? "success" : "muted"}>
                    {app.enabled ? "Enabled" : "Disabled"}
                  </Badge>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => update.mutate({ id: app.id, enabled: !app.enabled })}
                      className="rounded p-1.5 hover:bg-[var(--orbit-border)]"
                      style={{ color: "var(--orbit-text-muted)" }}
                      title={app.enabled ? "Disable" : "Enable"}
                    >
                      {app.enabled ? <ToggleRight className="h-4 w-4" /> : <ToggleLeft className="h-4 w-4" />}
                    </button>
                    <button
                      onClick={() => setDrawerApp(app)}
                      className="rounded p-1.5 hover:bg-[var(--orbit-border)]"
                      style={{ color: "var(--orbit-text-muted)" }}
                      title="Edit"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => setConfirmDelete(app)}
                      className="rounded p-1.5 hover:bg-[var(--orbit-danger)]/10"
                      style={{ color: "var(--orbit-text-muted)" }}
                      title="Delete"
                    >
                      <Trash2 className="h-4 w-4 hover:text-[var(--orbit-danger)]" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {(apps ?? []).length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-sm" style={{ color: "var(--orbit-text-muted)" }}>
                  No applications registered yet. Click "Register App" to add one.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {drawerApp !== null && (
        <AppFormDrawer initial={drawerApp} onClose={() => setDrawerApp(null)} />
      )}

      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60" onClick={() => setConfirmDelete(null)} />
          <div className="relative rounded-xl p-6 w-full max-w-sm space-y-4" style={{ background: "var(--orbit-bg-card)", border: "1px solid var(--orbit-border)" }}>
            <h3 className="text-base font-semibold" style={{ color: "var(--orbit-text-primary)" }}>Delete Application?</h3>
            <p className="text-sm" style={{ color: "var(--orbit-text-secondary)" }}>
              This will permanently delete <strong>{confirmDelete.displayName}</strong> and all its group mappings. This cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmDelete(null)} className="rounded-lg px-4 py-2 text-sm" style={{ background: "var(--orbit-border)", color: "var(--orbit-text-primary)" }}>
                Cancel
              </button>
              <button
                onClick={() => deleteApp.mutate(confirmDelete.id, { onSuccess: () => setConfirmDelete(null) })}
                disabled={deleteApp.isPending}
                className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
                style={{ background: "var(--orbit-danger)", color: "#fff" }}
              >
                {deleteApp.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
