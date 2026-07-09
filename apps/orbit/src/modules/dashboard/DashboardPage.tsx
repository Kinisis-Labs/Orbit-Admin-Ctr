import { LayoutGrid, Bell, DollarSign, AlertTriangle } from "lucide-react";
import { useAuth } from "../auth/AuthProvider";
import { useApplications } from "../../services/applications";
import { AppLauncher } from "../applications/AppLauncher";

interface KpiTileProps {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  sub?: string;
  accentClass?: string;
  loading?: boolean;
}

function KpiTile({ icon, label, value, sub, accentClass, loading }: KpiTileProps) {
  return (
    <div
      className="flex flex-col gap-2 rounded-xl p-6"
      style={{ background: "var(--orbit-bg-card)", border: "1px solid var(--orbit-border)" }}
    >
      <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${accentClass ?? "bg-[var(--orbit-primary)]/10"}`}>
        {icon}
      </div>
      <p className="text-sm" style={{ color: "var(--orbit-text-secondary)" }}>{label}</p>
      <p className="text-2xl font-bold" style={{ color: "var(--orbit-text-primary)" }}>
        {loading ? (
          <span className="inline-block h-7 w-10 animate-pulse rounded" style={{ background: "var(--orbit-border)" }} />
        ) : value}
      </p>
      {sub && <p className="text-xs" style={{ color: "var(--orbit-text-muted)" }}>{sub}</p>}
    </div>
  );
}

export function DashboardPage() {
  const { user } = useAuth();
  const { data: apps, isLoading, error } = useApplications();
  const totalApps = apps?.length ?? 0;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold" style={{ color: "var(--orbit-text-primary)" }}>
          Welcome back, {user.displayName.split(" ")[0]}
        </h1>
        <p className="text-sm mt-1" style={{ color: "var(--orbit-text-muted)" }}>
          Orbit Enterprise Control Plane
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiTile
          icon={<LayoutGrid className="h-5 w-5" style={{ color: "var(--orbit-primary)" }} />}
          label="Applications"
          value={isLoading ? "—" : totalApps}
          sub={isLoading ? "" : totalApps === 1 ? "app available" : "apps available"}
          loading={isLoading}
        />
        <KpiTile
          icon={<AlertTriangle className="h-5 w-5" style={{ color: "var(--orbit-warning)" }} />}
          accentClass="bg-[var(--orbit-warning)]/10"
          label="Active Alerts"
          value="—"
          sub="Phase H"
        />
        <KpiTile
          icon={<DollarSign className="h-5 w-5" style={{ color: "var(--orbit-success)" }} />}
          accentClass="bg-[var(--orbit-success)]/10"
          label="MTD Spend"
          value="—"
          sub="Phase 2"
        />
        <KpiTile
          icon={<Bell className="h-5 w-5" style={{ color: "var(--orbit-accent-2)" }} />}
          accentClass="bg-[var(--orbit-accent-2)]/10"
          label="Notifications"
          value="—"
          sub="Phase F"
        />
      </div>

      <div
        className="rounded-xl p-6"
        style={{ background: "var(--orbit-bg-card)", border: "1px solid var(--orbit-border)" }}
      >
        <h2
          className="text-xs font-semibold uppercase tracking-widest mb-4"
          style={{ color: "var(--orbit-text-muted)" }}
        >
          Application Launcher
        </h2>
        <AppLauncher apps={apps ?? []} isLoading={isLoading} error={error} />
      </div>
    </div>
  );
}
