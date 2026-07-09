import { useState } from "react";
import { Bell, Plus, Trash2, Loader2, X, Megaphone } from "lucide-react";
import {
  useAdminNotifications,
  useCreateNotification,
  useDeleteNotification,
  type NotificationRow,
  type NotificationType,
  type CreateNotificationInput,
} from "../../services/notifications";

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

// ── Main Page ─────────────────────────────────────────────────────────────────

export function NotificationsPage() {
  const [composing, setComposing] = useState(false);
  const { data, isLoading, error } = useAdminNotifications();
  const deleteNotif = useDeleteNotification();

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "var(--orbit-text-primary)" }}>Notifications</h1>
          <p className="text-sm mt-1" style={{ color: "var(--orbit-text-muted)" }}>
            {data ? `${data.length} notification${data.length === 1 ? "" : "s"}` : "Loading…"}
          </p>
        </div>
        <button
          onClick={() => setComposing(true)}
          className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium"
          style={{ background: "var(--orbit-primary)", color: "#fff" }}
        >
          <Plus className="h-4 w-4" /> Send Notification
        </button>
      </div>

      {/* Table */}
      {isLoading ? (
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
      )}

      {composing && <ComposeDrawer onClose={() => setComposing(false)} />}
    </div>
  );
}
