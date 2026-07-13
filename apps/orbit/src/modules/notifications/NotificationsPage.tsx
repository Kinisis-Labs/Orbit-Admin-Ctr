import { useState } from "react";
import { Bell, Plus, Trash2, Loader2, X, Megaphone, Phone, Mail, FlaskConical, Pencil, AlertTriangle, ShieldAlert, RefreshCw } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import {
  useAdminNotifications,
  useCreateNotification,
  useDeleteNotification,
  type NotificationRow,
  type NotificationType,
  type CreateNotificationInput,
} from "../../services/notifications";
import {
  useAlertContacts,
  useCreateContact,
  useUpdateContact,
  useDeleteContact,
  useTestContact,
  type AlertContactRow,
  type UpsertContactInput,
} from "../../services/alertContacts";

// ── Azure Alerts ─────────────────────────────────────────────────────────────

interface AzureAlert {
  id: string;
  name: string;
  severity: "critical" | "error" | "warning" | "informational" | "unknown";
  status: "active" | "acknowledged" | "resolved";
  service: string;
  description: string;
  firedAt: string;
  resolvedAt: string | null;
  source: string;
}

function useAzureAlerts(enabled: boolean) {
  return useQuery<AzureAlert[]>({
    queryKey: ["azure-alerts"],
    queryFn: async () => {
      const res = await fetch("/api/noc/incidents");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { alerts: AzureAlert[] };
      return data.alerts ?? [];
    },
    enabled,
    staleTime: 2 * 60 * 1000,
  });
}

// ── Constants ─────────────────────────────────────────────────────────────────

const TYPES: NotificationType[] = ["info", "success", "warning", "error", "announcement"];

const TYPE_COLORS: Record<NotificationType, string> = {
  info: "#93C5FD",
  success: "#6EE7B7",
  warning: "#FCD34D",
  error: "#FCA5A5",
  announcement: "#A78BFA",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const card: React.CSSProperties = {
  background: "var(--orbit-bg-card)",
  border: "1px solid var(--orbit-border)",
};

const inputStyle: React.CSSProperties = {
  background: "var(--orbit-bg-page)",
  border: "1px solid var(--orbit-border)",
  color: "var(--orbit-text-primary)",
};

function fmt(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ── Compose Drawer ────────────────────────────────────────────────────────────

const EMPTY: CreateNotificationInput = { title: "", body: "", type: "info" };

function ComposeDrawer({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState<CreateNotificationInput>(EMPTY);
  const create = useCreateNotification();

  const set = <K extends keyof CreateNotificationInput>(k: K, v: CreateNotificationInput[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim() || !form.body.trim()) return;
    await create.mutateAsync({
      ...form,
      userId: form.userId?.trim() || undefined,
      actionUrl: form.actionUrl?.trim() || undefined,
      expiresAt: form.expiresAt || undefined,
    });
    onClose();
  }

  const fieldCls = "w-full rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-[var(--orbit-primary)]";
  const labelCls = "block text-xs font-medium mb-1";

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-md h-full flex flex-col overflow-hidden" style={card}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: "1px solid var(--orbit-border)" }}>
          <h2 className="text-sm font-semibold" style={{ color: "var(--orbit-text-primary)" }}>Send Notification</h2>
          <button onClick={onClose} className="rounded p-1 hover:bg-[var(--orbit-border)]" style={{ color: "var(--orbit-text-muted)" }}>
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Type */}
          <div>
            <label className={labelCls} style={{ color: "var(--orbit-text-muted)" }}>Type</label>
            <select value={form.type} onChange={(e) => set("type", e.target.value as NotificationType)} className={fieldCls} style={inputStyle}>
              {TYPES.map((t) => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
            </select>
          </div>

          {/* Audience */}
          <div>
            <label className={labelCls} style={{ color: "var(--orbit-text-muted)" }}>Target User ID <span className="font-normal opacity-60">(leave blank to broadcast to all)</span></label>
            <input
              type="text"
              placeholder="User ID (e.g. Entra OID) or leave blank"
              value={form.userId ?? ""}
              onChange={(e) => set("userId", e.target.value)}
              className={fieldCls}
              style={inputStyle}
            />
          </div>

          {/* Title */}
          <div>
            <label className={labelCls} style={{ color: "var(--orbit-text-muted)" }}>Title *</label>
            <input
              type="text"
              placeholder="Notification title"
              value={form.title}
              onChange={(e) => set("title", e.target.value)}
              required
              className={fieldCls}
              style={inputStyle}
            />
          </div>

          {/* Body */}
          <div>
            <label className={labelCls} style={{ color: "var(--orbit-text-muted)" }}>Message *</label>
            <textarea
              placeholder="Notification body…"
              value={form.body}
              onChange={(e) => set("body", e.target.value)}
              required
              rows={4}
              className={fieldCls}
              style={inputStyle}
            />
          </div>

          {/* Action URL */}
          <div>
            <label className={labelCls} style={{ color: "var(--orbit-text-muted)" }}>Action URL <span className="font-normal opacity-60">(optional)</span></label>
            <input
              type="text"
              placeholder="/admin/audit or https://…"
              value={form.actionUrl ?? ""}
              onChange={(e) => set("actionUrl", e.target.value)}
              className={fieldCls}
              style={inputStyle}
            />
          </div>

          {/* Expires */}
          <div>
            <label className={labelCls} style={{ color: "var(--orbit-text-muted)" }}>Expires At <span className="font-normal opacity-60">(optional)</span></label>
            <input
              type="datetime-local"
              value={form.expiresAt ?? ""}
              onChange={(e) => set("expiresAt", e.target.value)}
              className={fieldCls}
              style={inputStyle}
            />
          </div>
        </form>

        {/* Footer */}
        <div className="flex gap-2 px-5 py-4" style={{ borderTop: "1px solid var(--orbit-border)" }}>
          <button onClick={onClose} className="flex-1 rounded-lg py-2 text-sm" style={{ background: "var(--orbit-border)", color: "var(--orbit-text-primary)" }}>
            Cancel
          </button>
          <button
            onClick={(e) => { void handleSubmit(e as unknown as React.FormEvent); }}
            disabled={create.isPending || !form.title.trim() || !form.body.trim()}
            className="flex-1 flex items-center justify-center gap-2 rounded-lg py-2 text-sm font-medium disabled:opacity-50"
            style={{ background: "var(--orbit-primary)", color: "#fff" }}
          >
            {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Megaphone className="h-4 w-4" />}
            Send
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Row ───────────────────────────────────────────────────────────────────────

function NotificationRowItem({ n, onDelete }: { n: NotificationRow; onDelete: (id: string) => void }) {
  const color = TYPE_COLORS[n.type] ?? "#93C5FD";
  return (
    <tr style={{ borderBottom: "1px solid var(--orbit-border)" }}>
      <td className="px-4 py-3">
        <span className="rounded-full px-2 py-0.5 text-[10px] font-medium" style={{ background: `${color}1a`, color }}>
          {n.type}
        </span>
      </td>
      <td className="px-4 py-3">
        <p className="text-xs font-medium" style={{ color: "var(--orbit-text-primary)" }}>{n.title}</p>
        <p className="text-xs mt-0.5 line-clamp-1" style={{ color: "var(--orbit-text-muted)" }}>{n.body}</p>
      </td>
      <td className="px-4 py-3 text-xs" style={{ color: "var(--orbit-text-muted)" }}>
        {n.userId ? <span className="font-mono text-[10px]">{n.userId}</span> : <span className="italic">Broadcast</span>}
      </td>
      <td className="px-4 py-3 text-xs" style={{ color: "var(--orbit-text-muted)" }}>{fmt(n.createdAt)}</td>
      <td className="px-4 py-3">
        <span className="text-xs" style={{ color: n.read ? "var(--orbit-success, #22c55e)" : "var(--orbit-text-muted)" }}>
          {n.read ? "Read" : "Unread"}
        </span>
      </td>
      <td className="px-4 py-3">
        <button
          onClick={() => onDelete(n.id)}
          className="rounded p-1.5 hover:bg-red-500/10 transition-colors"
          style={{ color: "var(--orbit-text-muted)" }}
          title="Delete"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </td>
    </tr>
  );
}

// ── Alert Contact Drawer ──────────────────────────────────────────────────────

const SEVERITIES = ["info", "warning", "critical"] as const;
const SEV_COLOR: Record<string, string> = { info: "#93C5FD", warning: "#FCD34D", critical: "#FCA5A5" };
const EMPTY_CONTACT: UpsertContactInput = { name: "", email: "", phone: "", smsEnabled: false, emailEnabled: false, severities: ["warning", "critical"] };

function ContactDrawer({ existing, onClose }: { existing?: AlertContactRow; onClose: () => void }) {
  const [form, setForm] = useState<UpsertContactInput>(
    existing
      ? { name: existing.name, email: existing.email ?? "", phone: existing.phone ?? "", smsEnabled: existing.smsEnabled, emailEnabled: existing.emailEnabled, severities: existing.severities }
      : EMPTY_CONTACT,
  );
  const create = useCreateContact();
  const update = useUpdateContact();
  const set = <K extends keyof UpsertContactInput>(k: K, v: UpsertContactInput[K]) => setForm((f) => ({ ...f, [k]: v }));
  function toggleSeverity(s: string) {
    setForm((f) => ({
      ...f,
      severities: f.severities.includes(s) ? f.severities.filter((x) => x !== s) : [...f.severities, s],
    }));
  }
  const isPending = create.isPending || update.isPending;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (existing) {
      await update.mutateAsync({ id: existing.id, ...form });
    } else {
      await create.mutateAsync(form);
    }
    onClose();
  }

  const fieldCls = "w-full rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-[var(--orbit-primary)]";
  const labelCls = "block text-xs font-medium mb-1";

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-md h-full flex flex-col overflow-hidden" style={card}>
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: "1px solid var(--orbit-border)" }}>
          <h2 className="text-sm font-semibold" style={{ color: "var(--orbit-text-primary)" }}>
            {existing ? "Edit Alert Contact" : "New Alert Contact"}
          </h2>
          <button onClick={onClose} className="rounded p-1 hover:bg-[var(--orbit-border)]" style={{ color: "var(--orbit-text-muted)" }}>
            <X className="h-4 w-4" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 space-y-4">
          <div>
            <label className={labelCls} style={{ color: "var(--orbit-text-muted)" }}>Name *</label>
            <input type="text" placeholder="e.g. On-Call Engineer" value={form.name} onChange={(e) => set("name", e.target.value)} required className={fieldCls} style={inputStyle} />
          </div>
          <div>
            <label className={labelCls} style={{ color: "var(--orbit-text-muted)" }}>Email</label>
            <input type="email" placeholder="alerts@example.com" value={form.email ?? ""} onChange={(e) => set("email", e.target.value)} className={fieldCls} style={inputStyle} />
          </div>
          <div>
            <label className={labelCls} style={{ color: "var(--orbit-text-muted)" }}>Phone (E.164 format)</label>
            <input type="tel" placeholder="+15551234567" value={form.phone ?? ""} onChange={(e) => set("phone", e.target.value)} className={fieldCls} style={inputStyle} />
          </div>
          <div>
            <label className={labelCls} style={{ color: "var(--orbit-text-muted)" }}>Alert Severities</label>
            <div className="flex gap-3 mt-1">
              {SEVERITIES.map((s) => (
                <label key={s} className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.severities.includes(s)}
                    onChange={() => toggleSeverity(s)}
                    className="rounded"
                  />
                  <span className="rounded-full px-2 py-0.5 text-[10px] font-medium" style={{ background: `${SEV_COLOR[s]}1a`, color: SEV_COLOR[s] }}>
                    {s.charAt(0).toUpperCase() + s.slice(1)}
                  </span>
                </label>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <label className={labelCls} style={{ color: "var(--orbit-text-muted)" }}>Channels</label>
            <label className="flex items-center gap-3 text-sm cursor-pointer" style={{ color: "var(--orbit-text-secondary)" }}>
              <input type="checkbox" checked={form.smsEnabled} onChange={(e) => set("smsEnabled", e.target.checked)} className="rounded" />
              <Phone className="h-3.5 w-3.5" /> Send SMS (requires phone)
            </label>
            <label className="flex items-center gap-3 text-sm cursor-pointer" style={{ color: "var(--orbit-text-secondary)" }}>
              <input type="checkbox" checked={form.emailEnabled} onChange={(e) => set("emailEnabled", e.target.checked)} className="rounded" />
              <Mail className="h-3.5 w-3.5" /> Send Email (requires email)
            </label>
          </div>
        </form>
        <div className="flex gap-2 px-5 py-4" style={{ borderTop: "1px solid var(--orbit-border)" }}>
          <button onClick={onClose} className="flex-1 rounded-lg py-2 text-sm" style={{ background: "var(--orbit-border)", color: "var(--orbit-text-primary)" }}>Cancel</button>
          <button
            onClick={(e) => { void handleSubmit(e as unknown as React.FormEvent); }}
            disabled={isPending || !form.name.trim() || (!form.email && !form.phone) || form.severities.length === 0}
            className="flex-1 flex items-center justify-center gap-2 rounded-lg py-2 text-sm font-medium disabled:opacity-50"
            style={{ background: "var(--orbit-primary)", color: "#fff" }}
          >
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {existing ? "Save" : "Add Contact"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Alert Contacts Tab ────────────────────────────────────────────────────────

function AlertContactsTab() {
  const [drawer, setDrawer] = useState<AlertContactRow | true | null>(null);
  const { data: contacts, isLoading, error } = useAlertContacts();
  const deleteContact = useDeleteContact();
  const testContact = useTestContact();
  const [testResult, setTestResult] = useState<Record<string, { sms: boolean; email: boolean } | "pending">>({});

  async function handleTest(id: string) {
    setTestResult((r) => ({ ...r, [id]: "pending" }));
    try {
      const result = await testContact.mutateAsync(id);
      setTestResult((r) => ({ ...r, [id]: result }));
    } catch {
      setTestResult((r) => ({ ...r, [id]: { sms: false, email: false } }));
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm" style={{ color: "var(--orbit-text-muted)" }}>
          Contacts receive NOC alerts via SMS and/or email when health degrades.
        </p>
        <button
          onClick={() => setDrawer(true)}
          className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium"
          style={{ background: "var(--orbit-primary)", color: "#fff" }}
        >
          <Plus className="h-4 w-4" /> Add Contact
        </button>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 py-12" style={{ color: "var(--orbit-text-muted)" }}>
          <Loader2 className="h-5 w-5 animate-spin" /><span className="text-sm">Loading…</span>
        </div>
      ) : error ? (
        <div className="rounded-xl p-4 text-sm" style={{ color: "var(--orbit-danger)", border: "1px solid var(--orbit-danger)", background: "var(--orbit-bg-card)" }}>
          {error.message}
        </div>
      ) : !contacts?.length ? (
        <div className="rounded-xl p-12 text-center" style={card}>
          <Phone className="mx-auto h-10 w-10 mb-3 opacity-20" style={{ color: "var(--orbit-text-muted)" }} />
          <p className="text-sm" style={{ color: "var(--orbit-text-muted)" }}>No alert contacts yet. Add one to receive NOC alerts.</p>
        </div>
      ) : (
        <div className="rounded-xl overflow-hidden" style={card}>
          {contacts.map((c, i) => {
            const tr = testResult[c.id];
            return (
              <div key={c.id} className="flex items-center gap-4 px-4 py-3" style={{ borderBottom: i < contacts.length - 1 ? "1px solid var(--orbit-border)" : undefined }}>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold" style={{ color: "var(--orbit-text-primary)" }}>{c.name}</p>
                  <div className="flex items-center gap-3 mt-0.5">
                    {c.email && <span className="flex items-center gap-1 text-xs" style={{ color: "var(--orbit-text-muted)" }}><Mail className="h-3 w-3" />{c.email}</span>}
                    {c.phone && <span className="flex items-center gap-1 text-xs" style={{ color: "var(--orbit-text-muted)" }}><Phone className="h-3 w-3" />{c.phone}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {c.smsEnabled && <span className="text-[10px] rounded-full px-2 py-0.5 font-medium" style={{ background: "#6EE7B71a", color: "#6EE7B7" }}>SMS</span>}
                  {c.emailEnabled && <span className="text-[10px] rounded-full px-2 py-0.5 font-medium" style={{ background: "#93C5FD1a", color: "#93C5FD" }}>Email</span>}
                  {c.severities.map((s) => (
                    <span key={s} className="text-[10px] rounded-full px-2 py-0.5 font-medium" style={{ background: `${SEV_COLOR[s] ?? "#FCD34D"}1a`, color: SEV_COLOR[s] ?? "#FCD34D" }}>
                      {s}
                    </span>
                  ))}
                </div>
                {tr && tr !== "pending" && (
                  <span className="text-[10px]" style={{ color: (tr.sms || tr.email) ? "#6EE7B7" : "#FCA5A5" }}>
                    {tr.sms || tr.email ? "✓ sent" : "✗ failed"}
                  </span>
                )}
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => void handleTest(c.id)} disabled={tr === "pending"} className="rounded p-1.5 hover:bg-[var(--orbit-border)]/40 transition-colors disabled:opacity-50" style={{ color: "var(--orbit-text-muted)" }} title="Send test alert">
                    {tr === "pending" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FlaskConical className="h-3.5 w-3.5" />}
                  </button>
                  <button onClick={() => setDrawer(c)} className="rounded p-1.5 hover:bg-[var(--orbit-border)]/40 transition-colors" style={{ color: "var(--orbit-text-muted)" }} title="Edit">
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={() => deleteContact.mutate(c.id)} className="rounded p-1.5 hover:bg-red-500/10 transition-colors" style={{ color: "var(--orbit-text-muted)" }} title="Delete">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {drawer && (
        <ContactDrawer
          existing={drawer === true ? undefined : drawer}
          onClose={() => setDrawer(null)}
        />
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

// ── Azure Alerts Tab ─────────────────────────────────────────────────────────

const AZ_SEV_COLOR: Record<string, string> = {
  critical: "#FCA5A5",
  error: "#F97316",
  warning: "#FCD34D",
  informational: "#93C5FD",
  unknown: "#9CA3AF",
};

const AZ_STATUS_COLOR: Record<string, string> = {
  active: "#FCA5A5",
  acknowledged: "#FCD34D",
  resolved: "#6EE7B7",
};

function AzureAlertsTab() {
  const { data: alerts, isLoading, error, refetch, isFetching } = useAzureAlerts(true);

  const active = alerts?.filter((a) => a.status !== "resolved") ?? [];
  const resolved = alerts?.filter((a) => a.status === "resolved") ?? [];

  function AlertRow({ a }: { a: AzureAlert }) {
    const sevColor = AZ_SEV_COLOR[a.severity] ?? "#9CA3AF";
    const statusColor = AZ_STATUS_COLOR[a.status] ?? "#9CA3AF";
    return (
      <div className="flex items-start gap-4 px-4 py-3" style={{ borderBottom: "1px solid var(--orbit-border)" }}>
        <div className="shrink-0 mt-0.5">
          {a.severity === "critical" || a.severity === "error"
            ? <ShieldAlert className="h-4 w-4" style={{ color: sevColor }} />
            : <AlertTriangle className="h-4 w-4" style={{ color: sevColor }} />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-medium" style={{ color: "var(--orbit-text-primary)" }}>{a.name}</p>
            <span className="text-[10px] rounded-full px-2 py-0.5 font-medium" style={{ background: `${sevColor}1a`, color: sevColor }}>{a.severity}</span>
            <span className="text-[10px] rounded-full px-2 py-0.5 font-medium" style={{ background: `${statusColor}1a`, color: statusColor }}>{a.status}</span>
            <span className="text-[10px] rounded-full px-2 py-0.5" style={{ background: "var(--orbit-border)", color: "var(--orbit-text-muted)" }}>{a.service}</span>
          </div>
          {a.description && <p className="text-xs mt-0.5 line-clamp-2" style={{ color: "var(--orbit-text-muted)" }}>{a.description}</p>}
          <p className="text-[10px] mt-1" style={{ color: "var(--orbit-text-muted)" }}>Fired {new Date(a.firedAt).toLocaleString()}{a.resolvedAt ? ` · Resolved ${new Date(a.resolvedAt).toLocaleString()}` : ""}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm" style={{ color: "var(--orbit-text-muted)" }}>
          Live Azure Monitor alerts across all configured subscriptions.
        </p>
        <button
          onClick={() => { void refetch(); }}
          className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm"
          style={{ background: "var(--orbit-border)", color: "var(--orbit-text-primary)" }}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 py-12" style={{ color: "var(--orbit-text-muted)" }}>
          <Loader2 className="h-5 w-5 animate-spin" /><span className="text-sm">Loading Azure alerts…</span>
        </div>
      ) : error ? (
        <div className="rounded-xl p-4 text-sm" style={{ color: "var(--orbit-danger)", border: "1px solid var(--orbit-danger)", background: "var(--orbit-bg-card)" }}>
          {error.message}
        </div>
      ) : !alerts?.length ? (
        <div className="rounded-xl p-12 text-center" style={card}>
          <Bell className="mx-auto h-10 w-10 mb-3 opacity-20" style={{ color: "var(--orbit-text-muted)" }} />
          <p className="text-sm" style={{ color: "var(--orbit-text-muted)" }}>No Azure Monitor alerts in the last 24 hours.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {active.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--orbit-text-muted)" }}>Active / Acknowledged ({active.length})</p>
              <div className="rounded-xl overflow-hidden" style={card}>
                {active.map((a) => <AlertRow key={a.id} a={a} />)}
              </div>
            </div>
          )}
          {resolved.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--orbit-text-muted)" }}>Resolved ({resolved.length})</p>
              <div className="rounded-xl overflow-hidden opacity-60" style={card}>
                {resolved.map((a) => <AlertRow key={a.id} a={a} />)}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

type Tab = "notifications" | "alerts" | "contacts";

export function NotificationsPage() {
  const [tab, setTab] = useState<Tab>("notifications");
  const [composing, setComposing] = useState(false);
  const { data, isLoading, error } = useAdminNotifications();
  const deleteNotif = useDeleteNotification();

  const tabCls = (t: Tab) =>
    `px-4 py-2 text-sm font-medium rounded-lg transition-colors ${tab === t ? "text-white" : ""}`;
  const tabStyle = (t: Tab): React.CSSProperties =>
    tab === t ? { background: "var(--orbit-primary)" } : { color: "var(--orbit-text-muted)", background: "transparent" };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "var(--orbit-text-primary)" }}>Notifications</h1>
          <p className="text-sm mt-1" style={{ color: "var(--orbit-text-muted)" }}>
            {tab === "notifications"
              ? (data ? `${data.length} notification${data.length === 1 ? "" : "s"}` : "Loading…")
              : tab === "alerts"
              ? "Live Azure Monitor alerts from all subscriptions"
              : "SMS & email alert contacts for NOC health events"}
          </p>
        </div>
        {tab === "notifications" && (
          <button
            onClick={() => setComposing(true)}
            className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium"
            style={{ background: "var(--orbit-primary)", color: "#fff" }}
          >
            <Plus className="h-4 w-4" /> Send Notification
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-xl p-1" style={{ background: "var(--orbit-bg-card)", border: "1px solid var(--orbit-border)", width: "fit-content" }}>
        <button className={tabCls("notifications")} style={tabStyle("notifications")} onClick={() => setTab("notifications")}>
          <span className="flex items-center gap-2"><Bell className="h-4 w-4" /> Notifications</span>
        </button>
        <button className={tabCls("alerts")} style={tabStyle("alerts")} onClick={() => setTab("alerts")}>
          <span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4" /> Azure Alerts</span>
        </button>
        <button className={tabCls("contacts")} style={tabStyle("contacts")} onClick={() => setTab("contacts")}>
          <span className="flex items-center gap-2"><Phone className="h-4 w-4" /> Alert Contacts</span>
        </button>
      </div>

      {/* Notifications Tab */}
      {tab === "notifications" && (
        isLoading ? (
          <div className="flex items-center gap-2 py-12" style={{ color: "var(--orbit-text-muted)" }}>
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-sm">Loading…</span>
          </div>
        ) : error ? (
          <div className="rounded-xl p-4 text-sm" style={{ color: "var(--orbit-danger)", border: "1px solid var(--orbit-danger)", background: "var(--orbit-bg-card)" }}>
            {error.message}
          </div>
        ) : !data?.length ? (
          <div className="rounded-xl p-12 text-center" style={card}>
            <Bell className="mx-auto h-10 w-10 mb-3 opacity-20" style={{ color: "var(--orbit-text-muted)" }} />
            <p className="text-sm" style={{ color: "var(--orbit-text-muted)" }}>No notifications yet. Send one to get started.</p>
          </div>
        ) : (
          <div className="rounded-xl overflow-hidden" style={card}>
            <table className="w-full text-xs">
              <thead>
                <tr style={{ borderBottom: "1px solid var(--orbit-border)", background: "var(--orbit-bg-page)" }}>
                  {["Type", "Message", "Audience", "Sent", "Status", ""].map((h) => (
                    <th key={h} className="px-4 py-3 text-left font-semibold uppercase tracking-wider" style={{ color: "var(--orbit-text-muted)" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.map((n) => (
                  <NotificationRowItem key={n.id} n={n} onDelete={(id) => deleteNotif.mutate(id)} />
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {/* Azure Alerts Tab */}
      {tab === "alerts" && <AzureAlertsTab />}

      {/* Alert Contacts Tab */}
      {tab === "contacts" && <AlertContactsTab />}

      {composing && <ComposeDrawer onClose={() => setComposing(false)} />}
    </div>
  );
}
