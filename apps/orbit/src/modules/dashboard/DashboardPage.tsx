import { useAuth } from "../auth/AuthProvider";

export function DashboardPage() {
  const { user } = useAuth();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold" style={{ color: "var(--orbit-text-primary)" }}>
          Welcome back, {user.displayName.split(" ")[0]}
        </h1>
        <p className="text-sm mt-1" style={{ color: "var(--orbit-text-secondary)" }}>
          Orbit Enterprise Control Plane
        </p>
      </div>

      {/* KPI tiles — Phase B will wire these up with real registry data */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Applications", value: "—", sub: "Phase B" },
          { label: "Active Users", value: "—", sub: "Phase D" },
          { label: "Open Alerts", value: "—", sub: "Phase H" },
          { label: "Platform Health", value: "—", sub: "Phase H" },
        ].map(({ label, value, sub }) => (
          <div
            key={label}
            className="rounded-xl p-5"
            style={{
              background: "var(--orbit-bg-card)",
              border: "1px solid var(--orbit-border)",
            }}
          >
            <div className="text-xs font-medium uppercase tracking-wider mb-2" style={{ color: "var(--orbit-text-muted)" }}>
              {label}
            </div>
            <div className="text-3xl font-semibold" style={{ color: "var(--orbit-text-primary)" }}>
              {value}
            </div>
            <div className="text-xs mt-1" style={{ color: "var(--orbit-text-muted)" }}>
              Available in {sub}
            </div>
          </div>
        ))}
      </div>

      {/* Placeholder for app launcher — Phase B */}
      <div
        className="rounded-xl p-6"
        style={{
          background: "var(--orbit-bg-card)",
          border: "1px solid var(--orbit-border)",
        }}
      >
        <div className="text-sm font-semibold mb-1" style={{ color: "var(--orbit-text-primary)" }}>
          Application Launcher
        </div>
        <p className="text-sm" style={{ color: "var(--orbit-text-secondary)" }}>
          Application registry and group-based access coming in Phase B.
        </p>
      </div>
    </div>
  );
}
