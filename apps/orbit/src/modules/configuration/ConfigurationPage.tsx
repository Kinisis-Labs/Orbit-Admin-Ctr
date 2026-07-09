import { useState } from "react";
import {
  Settings,
  ToggleLeft,
  ToggleRight,
  Plus,
  Trash2,
  Loader2,
  Eye,
  EyeOff,
  Save,
  X,
} from "lucide-react";
import {
  useGlobalConfig,
  useUpsertConfig,
  useDeleteConfig,
  useFeatureFlags,
  useUpsertFlag,
  useDeleteFlag,
  type GlobalConfigRow,
  type FeatureFlagRow,
} from "../../services/config";

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

// ── Add/Edit Config Drawer ────────────────────────────────────────────────────

interface ConfigForm {
  key: string;
  value: string;
  description: string;
  isSecret: boolean;
}

const EMPTY_CFG: ConfigForm = { key: "", value: "", description: "", isSecret: false };

function ConfigDrawer({ existing, onClose }: { existing?: GlobalConfigRow; onClose: () => void }) {
  const [form, setForm] = useState<ConfigForm>(
    existing
      ? { key: existing.key, value: "", description: existing.description ?? "", isSecret: existing.isSecret }
      : EMPTY_CFG,
  );
  const [showVal, setShowVal] = useState(false);
  const upsert = useUpsertConfig();

  const set = <K extends keyof ConfigForm>(k: K, v: ConfigForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.key.trim() || form.value.trim() === "") return;
    await upsert.mutateAsync({
      key: form.key.trim(),
      value: form.value,
      description: form.description.trim() || undefined,
      isSecret: form.isSecret,
    });
    onClose();
  }

  const fieldCls = "w-full rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-[var(--orbit-primary)]";
  const labelCls = "block text-xs font-medium mb-1";

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-md h-full flex flex-col" style={card}>
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: "1px solid var(--orbit-border)" }}>
          <h2 className="text-sm font-semibold" style={{ color: "var(--orbit-text-primary)" }}>
            {existing ? "Edit Config" : "New Config Entry"}
          </h2>
          <button onClick={onClose} className="rounded p-1 hover:bg-[var(--orbit-border)]" style={{ color: "var(--orbit-text-muted)" }}>
            <X className="h-4 w-4" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 space-y-4">
          <div>
            <label className={labelCls} style={{ color: "var(--orbit-text-muted)" }}>Key *</label>
            <input
              type="text"
              placeholder="e.g. ORBIT_SUPPORT_EMAIL"
              value={form.key}
              onChange={(e) => set("key", e.target.value)}
              disabled={!!existing}
              required
              className={fieldCls}
              style={{ ...inputStyle, opacity: existing ? 0.6 : 1 }}
            />
          </div>
          <div>
            <label className={labelCls} style={{ color: "var(--orbit-text-muted)" }}>
              Value * {existing?.isSecret && <span className="font-normal opacity-60">(leave blank to keep existing)</span>}
            </label>
            <div className="relative">
              <input
                type={showVal || !form.isSecret ? "text" : "password"}
                placeholder={existing?.isSecret ? "Enter new value to update" : "Config value"}
                value={form.value}
                onChange={(e) => set("value", e.target.value)}
                required={!existing}
                className={`${fieldCls} pr-9`}
                style={inputStyle}
              />
              {form.isSecret && (
                <button
                  type="button"
                  onClick={() => setShowVal((v) => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2"
                  style={{ color: "var(--orbit-text-muted)" }}
                >
                  {showVal ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              )}
            </div>
          </div>
          <div>
            <label className={labelCls} style={{ color: "var(--orbit-text-muted)" }}>Description</label>
            <input
              type="text"
              placeholder="What this config controls…"
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
              className={fieldCls}
              style={inputStyle}
            />
          </div>
          <div className="flex items-center gap-3">
            <input
              id="is-secret"
              type="checkbox"
              checked={form.isSecret}
              onChange={(e) => set("isSecret", e.target.checked)}
              className="rounded"
            />
            <label htmlFor="is-secret" className="text-xs" style={{ color: "var(--orbit-text-secondary)" }}>
              Mark as secret (value masked in UI)
            </label>
          </div>
        </form>
        <div className="flex gap-2 px-5 py-4" style={{ borderTop: "1px solid var(--orbit-border)" }}>
          <button onClick={onClose} className="flex-1 rounded-lg py-2 text-sm" style={{ background: "var(--orbit-border)", color: "var(--orbit-text-primary)" }}>
            Cancel
          </button>
          <button
            onClick={(e) => { void handleSubmit(e as unknown as React.FormEvent); }}
            disabled={upsert.isPending || !form.key.trim() || (!existing && !form.value.trim())}
            className="flex-1 flex items-center justify-center gap-2 rounded-lg py-2 text-sm font-medium disabled:opacity-50"
            style={{ background: "var(--orbit-primary)", color: "#fff" }}
          >
            {upsert.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Config Table ──────────────────────────────────────────────────────────────

function ConfigTable({ rows, onEdit, onDelete }: { rows: GlobalConfigRow[]; onEdit: (r: GlobalConfigRow) => void; onDelete: (key: string) => void }) {
  return (
    <div className="rounded-xl overflow-hidden" style={card}>
      <table className="w-full text-xs">
        <thead>
          <tr style={{ borderBottom: "1px solid var(--orbit-border)", background: "var(--orbit-bg-page)" }}>
            {["Key", "Value", "Description", "Updated", ""].map((h) => (
              <th key={h} className="px-4 py-3 text-left font-semibold uppercase tracking-wider" style={{ color: "var(--orbit-text-muted)" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr
              key={r.id}
              className="cursor-pointer hover:bg-[var(--orbit-border)]/30 transition-colors"
              onClick={() => onEdit(r)}
              style={{ borderBottom: i < rows.length - 1 ? "1px solid var(--orbit-border)" : undefined }}
            >
              <td className="px-4 py-3 font-mono font-medium" style={{ color: "var(--orbit-text-primary)" }}>{r.key}</td>
              <td className="px-4 py-3 font-mono" style={{ color: r.isSecret ? "var(--orbit-text-muted)" : "var(--orbit-text-secondary)" }}>
                {r.isSecret ? <span className="flex items-center gap-1"><EyeOff className="h-3 w-3" /> {r.value}</span> : r.value}
              </td>
              <td className="px-4 py-3" style={{ color: "var(--orbit-text-muted)" }}>{r.description ?? "—"}</td>
              <td className="px-4 py-3 whitespace-nowrap" style={{ color: "var(--orbit-text-muted)" }}>{fmt(r.updatedAt)}</td>
              <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                <button
                  onClick={() => onDelete(r.key)}
                  className="rounded p-1.5 hover:bg-red-500/10 transition-colors"
                  style={{ color: "var(--orbit-text-muted)" }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Feature Flag Row ──────────────────────────────────────────────────────────

function FlagRow({ flag, onToggle, onDelete }: { flag: FeatureFlagRow; onToggle: () => void; onDelete: () => void }) {
  return (
    <div
      className="flex items-center gap-4 px-4 py-3 transition-colors hover:bg-[var(--orbit-border)]/20"
      style={{ borderBottom: "1px solid var(--orbit-border)" }}
    >
      <button onClick={onToggle} className="shrink-0" title={flag.enabled ? "Disable" : "Enable"}>
        {flag.enabled
          ? <ToggleRight className="h-6 w-6" style={{ color: "var(--orbit-primary)" }} />
          : <ToggleLeft className="h-6 w-6" style={{ color: "var(--orbit-text-muted)" }} />}
      </button>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-mono font-semibold" style={{ color: "var(--orbit-text-primary)" }}>{flag.name}</p>
        {flag.description && <p className="text-xs mt-0.5" style={{ color: "var(--orbit-text-muted)" }}>{flag.description}</p>}
      </div>
      <span className="text-xs shrink-0" style={{ color: flag.enabled ? "var(--orbit-success, #22c55e)" : "var(--orbit-text-muted)" }}>
        {flag.enabled ? "Enabled" : "Disabled"}
      </span>
      <span className="text-[10px] shrink-0 hidden sm:block" style={{ color: "var(--orbit-text-muted)" }}>{fmt(flag.updatedAt)}</span>
      <button onClick={onDelete} className="rounded p-1.5 hover:bg-red-500/10 transition-colors shrink-0" style={{ color: "var(--orbit-text-muted)" }}>
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// ── Add Flag Form ─────────────────────────────────────────────────────────────

function AddFlagForm({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const upsert = useUpsertFlag();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    await upsert.mutateAsync({ name: name.trim(), enabled: false, description: description.trim() || undefined });
    onDone();
  }

  const fieldCls = "rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-[var(--orbit-primary)]";

  return (
    <form onSubmit={handleSubmit} className="flex gap-2 px-4 py-3" style={{ borderTop: "1px solid var(--orbit-border)" }}>
      <input
        type="text"
        placeholder="flag.name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
        className={`flex-1 ${fieldCls}`}
        style={inputStyle}
      />
      <input
        type="text"
        placeholder="Description (optional)"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        className={`flex-1 ${fieldCls}`}
        style={inputStyle}
      />
      <button type="submit" disabled={upsert.isPending || !name.trim()} className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-50" style={{ background: "var(--orbit-primary)", color: "#fff" }}>
        {upsert.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
        Add
      </button>
      <button type="button" onClick={onDone} className="rounded-lg px-3 py-2 text-sm" style={{ background: "var(--orbit-border)", color: "var(--orbit-text-primary)" }}>
        Cancel
      </button>
    </form>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

type Tab = "config" | "flags";

export function ConfigurationPage() {
  const [tab, setTab] = useState<Tab>("config");
  const [configDrawer, setConfigDrawer] = useState<GlobalConfigRow | true | null>(null);
  const [addingFlag, setAddingFlag] = useState(false);

  const { data: configs, isLoading: configLoading, error: configError } = useGlobalConfig();
  const { data: flags, isLoading: flagsLoading, error: flagsError } = useFeatureFlags();
  const deleteConfig = useDeleteConfig();
  const upsertFlag = useUpsertFlag();
  const deleteFlag = useDeleteFlag();

  const tabCls = (t: Tab) =>
    `px-4 py-2 text-sm font-medium rounded-lg transition-colors ${tab === t ? "text-white" : ""}`;
  const tabStyle = (t: Tab): React.CSSProperties =>
    tab === t
      ? { background: "var(--orbit-primary)" }
      : { color: "var(--orbit-text-muted)", background: "transparent" };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "var(--orbit-text-primary)" }}>Configuration</h1>
          <p className="text-sm mt-1" style={{ color: "var(--orbit-text-muted)" }}>
            Global platform settings and feature flags
          </p>
        </div>
        {tab === "config" && (
          <button
            onClick={() => setConfigDrawer(true)}
            className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium"
            style={{ background: "var(--orbit-primary)", color: "#fff" }}
          >
            <Plus className="h-4 w-4" /> New Entry
          </button>
        )}
        {tab === "flags" && !addingFlag && (
          <button
            onClick={() => setAddingFlag(true)}
            className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium"
            style={{ background: "var(--orbit-primary)", color: "#fff" }}
          >
            <Plus className="h-4 w-4" /> New Flag
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-xl p-1" style={{ background: "var(--orbit-bg-card)", border: "1px solid var(--orbit-border)", width: "fit-content" }}>
        <button className={tabCls("config")} style={tabStyle("config")} onClick={() => setTab("config")}>
          <span className="flex items-center gap-2"><Settings className="h-4 w-4" /> Global Config</span>
        </button>
        <button className={tabCls("flags")} style={tabStyle("flags")} onClick={() => setTab("flags")}>
          <span className="flex items-center gap-2"><ToggleRight className="h-4 w-4" /> Feature Flags</span>
        </button>
      </div>

      {/* Global Config Tab */}
      {tab === "config" && (
        configLoading ? (
          <div className="flex items-center gap-2 py-12" style={{ color: "var(--orbit-text-muted)" }}>
            <Loader2 className="h-5 w-5 animate-spin" /><span className="text-sm">Loading…</span>
          </div>
        ) : configError ? (
          <div className="rounded-xl p-4 text-sm" style={{ color: "var(--orbit-danger)", border: "1px solid var(--orbit-danger)", background: "var(--orbit-bg-card)" }}>
            {configError.message}
          </div>
        ) : !configs?.length ? (
          <div className="rounded-xl p-12 text-center" style={card}>
            <Settings className="mx-auto h-10 w-10 mb-3 opacity-20" style={{ color: "var(--orbit-text-muted)" }} />
            <p className="text-sm" style={{ color: "var(--orbit-text-muted)" }}>No configuration entries yet. Add one to get started.</p>
          </div>
        ) : (
          <ConfigTable
            rows={configs}
            onEdit={(r) => setConfigDrawer(r)}
            onDelete={(key) => deleteConfig.mutate(key)}
          />
        )
      )}

      {/* Feature Flags Tab */}
      {tab === "flags" && (
        flagsLoading ? (
          <div className="flex items-center gap-2 py-12" style={{ color: "var(--orbit-text-muted)" }}>
            <Loader2 className="h-5 w-5 animate-spin" /><span className="text-sm">Loading…</span>
          </div>
        ) : flagsError ? (
          <div className="rounded-xl p-4 text-sm" style={{ color: "var(--orbit-danger)", border: "1px solid var(--orbit-danger)", background: "var(--orbit-bg-card)" }}>
            {flagsError.message}
          </div>
        ) : (
          <div className="rounded-xl overflow-hidden" style={card}>
            {!flags?.length && !addingFlag ? (
              <div className="p-12 text-center">
                <ToggleLeft className="mx-auto h-10 w-10 mb-3 opacity-20" style={{ color: "var(--orbit-text-muted)" }} />
                <p className="text-sm" style={{ color: "var(--orbit-text-muted)" }}>No feature flags yet.</p>
              </div>
            ) : (
              flags?.map((f) => (
                <FlagRow
                  key={f.name}
                  flag={f}
                  onToggle={() => upsertFlag.mutate({ name: f.name, enabled: !f.enabled, description: f.description ?? undefined })}
                  onDelete={() => deleteFlag.mutate(f.name)}
                />
              ))
            )}
            {addingFlag && <AddFlagForm onDone={() => setAddingFlag(false)} />}
          </div>
        )
      )}

      {/* Config Drawer */}
      {configDrawer && (
        <ConfigDrawer
          existing={configDrawer === true ? undefined : configDrawer}
          onClose={() => setConfigDrawer(null)}
        />
      )}
    </div>
  );
}
