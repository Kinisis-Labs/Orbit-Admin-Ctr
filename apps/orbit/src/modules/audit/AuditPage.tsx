import { useState, useCallback } from "react";
import {
  ScrollText,
  Search,
  Loader2,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  X,
} from "lucide-react";
import {
  useAuditLog,
  type AuditFilters,
  type AuditLogRow,
  type AuditCategory,
  type AuditOutcome,
} from "../../services/audit";

// ── Constants ─────────────────────────────────────────────────────────────────

const PAGE_SIZE = 50;

const CATEGORIES: { value: AuditCategory | ""; label: string }[] = [
  { value: "", label: "All Categories" },
  { value: "auth", label: "Auth" },
  { value: "rbac", label: "RBAC" },
  { value: "application", label: "Application" },
  { value: "configuration", label: "Configuration" },
  { value: "admin", label: "Admin" },
];

const OUTCOMES: { value: AuditOutcome | ""; label: string }[] = [
  { value: "", label: "All Outcomes" },
  { value: "success", label: "Success" },
  { value: "failure", label: "Failure" },
  { value: "denied", label: "Denied" },
];

const OUTCOME_STYLES: Record<AuditOutcome, React.CSSProperties> = {
  success: { background: "rgba(34,197,94,0.1)", color: "var(--orbit-success, #22c55e)" },
  failure: { background: "rgba(239,68,68,0.1)", color: "var(--orbit-danger, #ef4444)" },
  denied: { background: "rgba(245,158,11,0.12)", color: "#F59E0B" },
};

const CATEGORY_STYLES: Record<AuditCategory, React.CSSProperties> = {
  auth: { background: "rgba(124,58,237,0.12)", color: "#A78BFA" },
  rbac: { background: "rgba(59,130,246,0.12)", color: "#93C5FD" },
  application: { background: "rgba(16,185,129,0.12)", color: "#6EE7B7" },
  configuration: { background: "rgba(245,158,11,0.12)", color: "#FCD34D" },
  admin: { background: "rgba(239,68,68,0.12)", color: "#FCA5A5" },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const card: React.CSSProperties = {
  background: "var(--orbit-bg-card)",
  border: "1px solid var(--orbit-border)",
};

function fmt(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

// ── Detail Modal ──────────────────────────────────────────────────────────────

function DetailModal({ row, onClose }: { row: AuditLogRow; onClose: () => void }) {
  const fields: [string, string | null | undefined][] = [
    ["ID", row.id],
    ["Timestamp", fmt(row.createdAt)],
    ["Actor", row.actorName ?? row.actorId ?? "—"],
    ["Actor UPN", row.actorUpn ?? "—"],
    ["Action", row.action],
    ["Category", row.category],
    ["Outcome", row.outcome],
    ["Entity Type", row.entityType ?? "—"],
    ["Entity ID", row.entityId ?? "—"],
    ["Entity Name", row.entityName ?? "—"],
    ["IP Address", row.ipAddress ?? "—"],
    ["User Agent", row.userAgent ?? "—"],
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-full max-w-lg rounded-xl overflow-hidden" style={card}>
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: "1px solid var(--orbit-border)" }}>
          <h3 className="text-sm font-semibold" style={{ color: "var(--orbit-text-primary)" }}>Audit Record</h3>
          <button onClick={onClose} className="rounded p-1 hover:bg-[var(--orbit-border)]" style={{ color: "var(--orbit-text-muted)" }}>
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-5 space-y-2 max-h-[70vh] overflow-y-auto">
          {fields.map(([label, value]) => (
            <div key={label} className="flex gap-3 text-xs">
              <span className="w-28 shrink-0 font-medium" style={{ color: "var(--orbit-text-muted)" }}>{label}</span>
              <span className="break-all" style={{ color: "var(--orbit-text-primary)" }}>{value ?? "—"}</span>
            </div>
          ))}
          {row.detail && (
            <div className="mt-3">
              <p className="text-xs font-medium mb-1" style={{ color: "var(--orbit-text-muted)" }}>Detail</p>
              <pre className="rounded p-3 text-xs overflow-x-auto" style={{ background: "var(--orbit-bg-page)", color: "var(--orbit-text-secondary)", border: "1px solid var(--orbit-border)" }}>
                {JSON.stringify(row.detail, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function AuditPage() {
  const [filters, setFilters] = useState<AuditFilters>({ limit: PAGE_SIZE, offset: 0 });
  const [selected, setSelected] = useState<AuditLogRow | null>(null);

  const { data, isLoading, isFetching, error, refetch } = useAuditLog(filters);

  const setFilter = useCallback(
    <K extends keyof AuditFilters>(key: K, value: AuditFilters[K]) => {
      setFilters((f) => ({ ...f, [key]: value, offset: key !== "offset" ? 0 : (f.offset ?? 0) }));
    },
    [],
  );

  const page = Math.floor((filters.offset ?? 0) / PAGE_SIZE) + 1;
  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 1;

  const selectCls = "rounded-lg px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-[var(--orbit-primary)]";
  const selectStyle: React.CSSProperties = {
    background: "var(--orbit-bg-page)",
    border: "1px solid var(--orbit-border)",
    color: "var(--orbit-text-primary)",
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "var(--orbit-text-primary)" }}>Audit Log</h1>
          <p className="text-sm mt-1" style={{ color: "var(--orbit-text-muted)" }}>
            {data ? `${data.total.toLocaleString()} record${data.total === 1 ? "" : "s"}` : "Loading…"}
          </p>
        </div>
        <button
          onClick={() => refetch()}
          className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium"
          style={{ background: "var(--orbit-border)", color: "var(--orbit-text-primary)" }}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5" style={{ color: "var(--orbit-text-muted)" }} />
          <input
            type="text"
            placeholder="Search actor, action, entity…"
            value={filters.search ?? ""}
            onChange={(e) => setFilter("search", e.target.value || undefined)}
            className="w-full rounded-lg py-2 pl-8 pr-3 text-xs outline-none focus:ring-1 focus:ring-[var(--orbit-primary)]"
            style={selectStyle}
          />
        </div>
        <select value={filters.category ?? ""} onChange={(e) => setFilter("category", (e.target.value as AuditCategory) || undefined)} className={selectCls} style={selectStyle}>
          {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
        <select value={filters.outcome ?? ""} onChange={(e) => setFilter("outcome", (e.target.value as AuditOutcome) || undefined)} className={selectCls} style={selectStyle}>
          {OUTCOMES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <input
          type="datetime-local"
          value={filters.from ?? ""}
          onChange={(e) => setFilter("from", e.target.value || undefined)}
          className={selectCls}
          style={selectStyle}
          title="From date"
        />
        <input
          type="datetime-local"
          value={filters.to ?? ""}
          onChange={(e) => setFilter("to", e.target.value || undefined)}
          className={selectCls}
          style={selectStyle}
          title="To date"
        />
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex items-center gap-2 py-12" style={{ color: "var(--orbit-text-muted)" }}>
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="text-sm">Loading audit log…</span>
        </div>
      ) : error ? (
        <div className="rounded-xl p-4 text-sm" style={{ color: "var(--orbit-danger)", border: "1px solid var(--orbit-danger)", background: "var(--orbit-bg-card)" }}>
          Failed to load audit log: {error.message}
        </div>
      ) : !data?.rows.length ? (
        <div className="rounded-xl p-12 text-center" style={card}>
          <ScrollText className="mx-auto h-10 w-10 mb-3 opacity-20" style={{ color: "var(--orbit-text-muted)" }} />
          <p className="text-sm" style={{ color: "var(--orbit-text-muted)" }}>No audit records match your filters.</p>
        </div>
      ) : (
        <div className="rounded-xl overflow-hidden" style={card}>
          <table className="w-full text-xs">
            <thead>
              <tr style={{ borderBottom: "1px solid var(--orbit-border)", background: "var(--orbit-bg-page)" }}>
                {["Timestamp", "Actor", "Action", "Category", "Outcome", "Entity"].map((h) => (
                  <th key={h} className="px-4 py-3 text-left font-semibold uppercase tracking-wider" style={{ color: "var(--orbit-text-muted)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row, i) => (
                <tr
                  key={row.id}
                  className="cursor-pointer hover:bg-[var(--orbit-border)]/30 transition-colors"
                  onClick={() => setSelected(row)}
                  style={{ borderBottom: i < data.rows.length - 1 ? "1px solid var(--orbit-border)" : undefined }}
                >
                  <td className="px-4 py-2.5 whitespace-nowrap font-mono" style={{ color: "var(--orbit-text-muted)" }}>{fmt(row.createdAt)}</td>
                  <td className="px-4 py-2.5">
                    <p style={{ color: "var(--orbit-text-primary)" }}>{row.actorName ?? "—"}</p>
                    {row.actorUpn && <p className="text-[10px]" style={{ color: "var(--orbit-text-muted)" }}>{row.actorUpn}</p>}
                  </td>
                  <td className="px-4 py-2.5 font-mono" style={{ color: "var(--orbit-text-secondary)" }}>{row.action}</td>
                  <td className="px-4 py-2.5">
                    <span className="rounded-full px-2 py-0.5 text-[10px] font-medium" style={CATEGORY_STYLES[row.category] ?? {}}>
                      {row.category}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="rounded-full px-2 py-0.5 text-[10px] font-medium" style={OUTCOME_STYLES[row.outcome] ?? {}}>
                      {row.outcome}
                    </span>
                  </td>
                  <td className="px-4 py-2.5" style={{ color: "var(--orbit-text-muted)" }}>
                    {row.entityName ?? row.entityId ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {data && data.total > PAGE_SIZE && (
        <div className="flex items-center justify-between">
          <p className="text-xs" style={{ color: "var(--orbit-text-muted)" }}>
            Page {page} of {totalPages} · {data.total.toLocaleString()} total
          </p>
          <div className="flex gap-2">
            <button
              disabled={page <= 1}
              onClick={() => setFilter("offset", Math.max(0, (filters.offset ?? 0) - PAGE_SIZE))}
              className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs disabled:opacity-40"
              style={{ background: "var(--orbit-border)", color: "var(--orbit-text-primary)" }}
            >
              <ChevronLeft className="h-3.5 w-3.5" /> Prev
            </button>
            <button
              disabled={page >= totalPages}
              onClick={() => setFilter("offset", (filters.offset ?? 0) + PAGE_SIZE)}
              className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs disabled:opacity-40"
              style={{ background: "var(--orbit-border)", color: "var(--orbit-text-primary)" }}
            >
              Next <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      {selected && <DetailModal row={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
