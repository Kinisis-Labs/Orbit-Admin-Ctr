import { useLocation, Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";

const ROUTE_LABELS: Record<string, string> = {
  "/": "Dashboard",
  "/admin": "Administration",
  "/admin/applications": "Applications",
  "/admin/applications/grailscan-corpus": "GrailScan Corpus Admin",
  "/admin/applications/grailscan-corpus/overview": "Overview",
  "/admin/applications/grailscan-corpus/submissions": "Submissions",
  "/admin/applications/grailscan-corpus/review": "Review Queue",
  "/admin/applications/grailscan-corpus/approved": "Approved Pool",
  "/admin/applications/grailscan-corpus/versions": "Corpus Versions",
  "/admin/applications/grailscan-corpus/coverage": "Coverage",
  "/admin/applications/grailscan-corpus/regression": "Regression",
  "/admin/applications/grailscan-corpus/health": "Health",
  "/admin/applications/grailscan-corpus/storage": "Storage",
  "/admin/applications/grailscan-corpus/audit": "Audit",
  "/admin/users": "Users",
  "/admin/roles": "Roles",
  "/admin/permissions": "Permissions",
  "/admin/audit": "Audit",
  "/admin/notifications": "Notifications",
  "/admin/configuration": "Configuration",
  "/admin/feature-flags": "Feature Flags",
  "/platform": "Platform",
  "/platform/health": "Health",
  "/signed-out": "Signed Out",
};

interface Crumb {
  label: string;
  to: string;
}

function buildCrumbs(pathname: string): Crumb[] {
  if (pathname === "/") return [{ label: "Dashboard", to: "/" }];

  const parts = pathname.split("/").filter(Boolean);
  const crumbs: Crumb[] = [{ label: "Orbit", to: "/" }];

  let path = "";
  for (const part of parts) {
    path += `/${part}`;
    const label =
      ROUTE_LABELS[path] ?? part.charAt(0).toUpperCase() + part.slice(1).replace(/-/g, " ");
    crumbs.push({ label, to: path });
  }

  return crumbs;
}

export function Breadcrumb() {
  const { pathname } = useLocation();
  const crumbs = buildCrumbs(pathname);

  return (
    <div
      className="flex items-center gap-1 px-5 text-xs"
      style={{
        height: 36,
        background: "var(--orbit-bg-page)",
        borderBottom: "1px solid var(--orbit-border)",
        color: "var(--orbit-text-muted)",
      }}
    >
      {crumbs.map((crumb, i) => (
        <div key={crumb.to} className="flex items-center gap-1">
          {i > 0 && (
            <ChevronRight className="w-3 h-3" style={{ color: "var(--orbit-border-subtle)" }} />
          )}
          {i === crumbs.length - 1 ? (
            <span style={{ color: "var(--orbit-text-secondary)" }}>{crumb.label}</span>
          ) : (
            <Link
              to={crumb.to}
              className="hover:underline transition-colors"
              style={{ color: "var(--orbit-text-muted)" }}
            >
              {crumb.label}
            </Link>
          )}
        </div>
      ))}
    </div>
  );
}
