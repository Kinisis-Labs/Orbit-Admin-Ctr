import { NavLink, Outlet } from "react-router-dom";
import {
  Database,
  Upload,
  ClipboardCheck,
  Layers,
  ChartNoAxesCombined,
  Activity,
  HardDrive,
  ScrollText,
  FlaskConical,
} from "lucide-react";

const tabs = [
  ["overview", "Overview", Database],
  ["submissions", "Submissions", Upload],
  ["review", "Review Queue", ClipboardCheck],
  ["approved", "Approved Pool", Layers],
  ["versions", "Corpus Versions", Database],
  ["coverage", "Coverage", ChartNoAxesCombined],
  ["regression", "Regression", FlaskConical],
  ["health", "Health", Activity],
  ["storage", "Storage", HardDrive],
  ["audit", "Audit", ScrollText],
] as const;

export function GrailScanCorpusAdminLayout() {
  return (
    <section className="space-y-5">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-400">
          Application Administration
        </p>
        <h1 className="mt-1 text-2xl font-semibold text-[var(--orbit-text-primary)]">
          GrailScan Golden Corpus Administration
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-[var(--orbit-text-secondary)]">
          Secure operational control plane for submissions, human verification, corpus releases, and
          recorded evidence.
        </p>
      </header>
      <nav
        aria-label="Golden Corpus sections"
        className="flex gap-1 overflow-x-auto border-b border-[var(--orbit-border)] pb-px"
      >
        {tabs.map(([path, label, Icon]) => (
          <NavLink
            key={path}
            to={path}
            className={({ isActive }) =>
              `flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-medium transition-colors ${isActive ? "border-cyan-400 text-cyan-300" : "border-transparent text-[var(--orbit-text-muted)] hover:text-[var(--orbit-text-primary)]"}`
            }
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </section>
  );
}
