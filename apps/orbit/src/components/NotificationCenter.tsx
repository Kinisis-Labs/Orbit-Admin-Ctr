import { useState, useRef, useEffect } from "react";
import { Bell, X, CheckCheck, ExternalLink } from "lucide-react";
import {
  useUnreadCount,
  useNotifications,
  useMarkRead,
  useMarkAllRead,
  type NotificationRow,
  type NotificationType,
} from "../services/notifications";

// ── Helpers ───────────────────────────────────────────────────────────────────

const TYPE_STYLES: Record<NotificationType, { dot: string; label: string }> = {
  info: { dot: "#93C5FD", label: "Info" },
  success: { dot: "#6EE7B7", label: "Success" },
  warning: { dot: "#FCD34D", label: "Warning" },
  error: { dot: "#FCA5A5", label: "Error" },
  announcement: { dot: "#A78BFA", label: "Announcement" },
};

function fmtAge(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ── Notification Item ─────────────────────────────────────────────────────────

function NotificationItem({ n, onRead }: { n: NotificationRow; onRead: (id: string) => void }) {
  const style = TYPE_STYLES[n.type] ?? TYPE_STYLES.info;
  return (
    <div
      className="flex gap-3 px-4 py-3 transition-colors hover:bg-[var(--orbit-border)]/30 cursor-pointer"
      style={{ borderBottom: "1px solid var(--orbit-border)", opacity: n.read ? 0.6 : 1 }}
      onClick={() => { if (!n.read) onRead(n.id); if (n.actionUrl) window.open(n.actionUrl, "_blank"); }}
    >
      <span
        className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
        style={{ background: n.read ? "var(--orbit-border)" : style.dot }}
      />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold truncate" style={{ color: "var(--orbit-text-primary)" }}>{n.title}</p>
        <p className="text-xs mt-0.5 line-clamp-2" style={{ color: "var(--orbit-text-secondary)" }}>{n.body}</p>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-[10px]" style={{ color: "var(--orbit-text-muted)" }}>{fmtAge(n.createdAt)}</span>
          {n.actionUrl && <ExternalLink className="h-2.5 w-2.5" style={{ color: "var(--orbit-text-muted)" }} />}
        </div>
      </div>
    </div>
  );
}

// ── Notification Center (Bell + Dropdown) ─────────────────────────────────────

export function NotificationCenter() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const { data: unread } = useUnreadCount();
  const { data: notifications } = useNotifications();
  const markRead = useMarkRead();
  const markAllRead = useMarkAllRead();

  const count = unread?.count ?? 0;

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="relative w-9 h-9 rounded-lg flex items-center justify-center transition-colors hover:bg-[var(--orbit-border)]"
        style={{ color: "var(--orbit-text-secondary)" }}
        title="Notifications"
      >
        <Bell className="w-4 h-4" />
        {count > 0 && (
          <span
            className="absolute top-1 right-1 flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold"
            style={{ background: "var(--orbit-danger, #ef4444)", color: "#fff" }}
          >
            {count > 9 ? "9+" : count}
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-2 w-80 rounded-xl overflow-hidden shadow-xl z-50"
          style={{ background: "var(--orbit-bg-card)", border: "1px solid var(--orbit-border)" }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: "1px solid var(--orbit-border)" }}>
            <p className="text-sm font-semibold" style={{ color: "var(--orbit-text-primary)" }}>
              Notifications {count > 0 && <span className="ml-1 text-xs font-normal" style={{ color: "var(--orbit-text-muted)" }}>({count} unread)</span>}
            </p>
            <div className="flex items-center gap-1">
              {count > 0 && (
                <button
                  onClick={() => markAllRead.mutate()}
                  className="flex items-center gap-1 rounded px-2 py-1 text-[10px] hover:bg-[var(--orbit-border)]"
                  style={{ color: "var(--orbit-text-muted)" }}
                  title="Mark all read"
                >
                  <CheckCheck className="h-3 w-3" /> All read
                </button>
              )}
              <button onClick={() => setOpen(false)} className="rounded p-1 hover:bg-[var(--orbit-border)]" style={{ color: "var(--orbit-text-muted)" }}>
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* List */}
          <div className="max-h-96 overflow-y-auto">
            {!notifications?.length ? (
              <div className="px-4 py-8 text-center">
                <Bell className="mx-auto h-8 w-8 mb-2 opacity-20" style={{ color: "var(--orbit-text-muted)" }} />
                <p className="text-xs" style={{ color: "var(--orbit-text-muted)" }}>No notifications</p>
              </div>
            ) : (
              notifications.map((n) => (
                <NotificationItem key={n.id} n={n} onRead={(id) => markRead.mutate(id)} />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
