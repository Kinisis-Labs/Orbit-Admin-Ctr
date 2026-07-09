import { NavLink, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  AppWindow,
  Users,
  Shield,
  Key,
  ScrollText,
  Bell,
  Settings,
  Activity,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { useState } from "react";
import { useAuth } from "../auth/AuthProvider";

interface NavItem {
  label: string;
  to: string;
  icon: React.ElementType;
  section?: string;
  adminOnly?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", to: "/", icon: LayoutDashboard },
  { label: "Applications", to: "/admin/applications", icon: AppWindow, section: "Administration", adminOnly: true },
  { label: "Users", to: "/admin/users", icon: Users, section: "Administration", adminOnly: true },
  { label: "Roles", to: "/admin/roles", icon: Shield, section: "Administration", adminOnly: true },
  { label: "Permissions", to: "/admin/permissions", icon: Key, section: "Administration", adminOnly: true },
  { label: "Audit", to: "/admin/audit", icon: ScrollText, section: "Administration", adminOnly: true },
  { label: "Notifications", to: "/admin/notifications", icon: Bell, section: "Administration", adminOnly: true },
  { label: "Configuration", to: "/admin/configuration", icon: Settings, section: "Administration", adminOnly: true },
  { label: "Platform Health", to: "/platform/health", icon: Activity, section: "Platform", adminOnly: true },
];

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const location = useLocation();
  const { user } = useAuth();

  const visibleItems = NAV_ITEMS.filter((n) => !n.adminOnly || user.isAdmin);

  const sections = Array.from(new Set(visibleItems.map((n) => n.section ?? ""))).filter(Boolean);
  const topItems = visibleItems.filter((n) => !n.section);

  return (
    <aside
      className="fixed left-0 bottom-0 flex flex-col transition-all duration-200 z-40"
      style={{
        top: "var(--orbit-topbar-height)",
        width: collapsed ? "var(--orbit-sidebar-collapsed)" : "var(--orbit-sidebar-width)",
        background: "var(--orbit-sidebar-bg)",
        borderRight: "1px solid var(--orbit-border)",
      }}
    >
      <nav className="flex-1 overflow-y-auto py-4 px-2 space-y-1">
        {/* Top-level items (no section) */}
        {topItems.map((item) => (
          <NavItem key={item.to} item={item} collapsed={collapsed} active={location.pathname === item.to} />
        ))}

        {/* Sectioned items */}
        {sections.map((section) => (
          <div key={section} className="mt-4">
            {!collapsed && (
              <div
                className="px-3 mb-1 text-xs font-semibold uppercase tracking-widest"
                style={{ color: "var(--orbit-text-muted)" }}
              >
                {section}
              </div>
            )}
            {collapsed && <div className="mx-2 my-2" style={{ height: 1, background: "var(--orbit-border)" }} />}
            {visibleItems.filter((n) => n.section === section).map((item) => (
              <NavItem
                key={item.to}
                item={item}
                collapsed={collapsed}
                active={
                  item.to === "/"
                    ? location.pathname === "/"
                    : location.pathname.startsWith(item.to)
                }
              />
            ))}
          </div>
        ))}
      </nav>

      {/* Collapse toggle */}
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="flex items-center justify-center h-10 w-full transition-colors"
        style={{
          borderTop: "1px solid var(--orbit-border)",
          color: "var(--orbit-text-muted)",
        }}
        title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      >
        {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
      </button>
    </aside>
  );
}

function NavItem({
  item,
  collapsed,
  active,
}: {
  item: NavItem;
  collapsed: boolean;
  active: boolean;
}) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      end={item.to === "/"}
      className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors"
      style={({ isActive: routerActive }) => {
        const isActiveState = routerActive || active;
        return {
          color: isActiveState ? "#A78BFA" : "var(--orbit-text-secondary)",
          background: isActiveState ? "rgba(124,58,237,0.12)" : "transparent",
          borderLeft: isActiveState ? "2px solid #7C3AED" : "2px solid transparent",
        };
      }}
      title={collapsed ? item.label : undefined}
    >
      <Icon className="w-4 h-4 shrink-0" />
      {!collapsed && <span className="truncate">{item.label}</span>}
    </NavLink>
  );
}
