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
  Server,
  LayoutGrid,
  ShieldAlert,
  BrainCircuit,
  Siren,
  MonitorSmartphone,
  Plug,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
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

const SECTION_COLORS: Record<string, string> = {
  Administration: "#60a5fa",       // blue
  "Network Operations": "#a78bfa", // violet
};

const NAV_ITEMS: NavItem[] = [
  { label: "Enterprise Overview", to: "/", icon: LayoutDashboard },
  { label: "Infrastructure", to: "/noc/infrastructure", icon: Server, section: "Network Operations", adminOnly: true },
  { label: "Applications", to: "/noc/applications", icon: LayoutGrid, section: "Network Operations", adminOnly: true },
  { label: "Security", to: "/noc/security", icon: ShieldAlert, section: "Network Operations", adminOnly: true },
  { label: "AI Platform", to: "/noc/ai", icon: BrainCircuit, section: "Network Operations", adminOnly: true },
  { label: "Azure Monitor", to: "/noc/incidents", icon: Siren, section: "Network Operations", adminOnly: true },
  { label: "UX Quality", to: "/noc/ux", icon: MonitorSmartphone, section: "Network Operations", adminOnly: true },
  { label: "API Dependencies", to: "/noc/api-dependencies", icon: Plug, section: "Network Operations", adminOnly: true },
  { label: "App Registration", to: "/admin/applications", icon: AppWindow, section: "Administration", adminOnly: true },
  { label: "Users", to: "/admin/users", icon: Users, section: "Administration", adminOnly: true },
  { label: "Roles", to: "/admin/roles", icon: Shield, section: "Administration", adminOnly: true },
  { label: "Permissions", to: "/admin/permissions", icon: Key, section: "Administration", adminOnly: true },
  { label: "Audit", to: "/admin/audit", icon: ScrollText, section: "Administration", adminOnly: true },
  { label: "Notifications", to: "/admin/notifications", icon: Bell, section: "Administration", adminOnly: true },
  { label: "Configuration", to: "/admin/configuration", icon: Settings, section: "Administration", adminOnly: true },
];

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    Administration: true,
    Platform: true,
    "Network Operations": true,
  });
  const location = useLocation();
  const { user } = useAuth();

  const visibleItems = NAV_ITEMS.filter((n) => !n.adminOnly || user.isAdmin);
  const sections = Array.from(new Set(visibleItems.map((n) => n.section ?? ""))).filter(Boolean);
  const topItems = visibleItems.filter((n) => !n.section);

  function toggleSection(section: string) {
    setOpenSections((prev) => ({ ...prev, [section]: !prev[section] }));
  }

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
        {sections.map((section) => {
          const color = SECTION_COLORS[section] ?? "var(--orbit-text-muted)";
          const isOpen = openSections[section] !== false;
          const sectionItems = visibleItems.filter((n) => n.section === section);
          return (
            <div key={section} className="mt-4">
              {!collapsed ? (
                <button
                  type="button"
                  onClick={() => toggleSection(section)}
                  className="w-full flex items-center justify-between px-3 mb-1 group"
                >
                  <span
                    className="text-xs font-semibold uppercase tracking-widest"
                    style={{ color }}
                  >
                    {section}
                  </span>
                  <ChevronDown
                    className="w-3 h-3 transition-transform duration-200"
                    style={{
                      color,
                      transform: isOpen ? "rotate(0deg)" : "rotate(-90deg)",
                    }}
                  />
                </button>
              ) : (
                <div
                  className="mx-2 my-2"
                  style={{ height: 1, background: color, opacity: 0.4 }}
                />
              )}
              {isOpen && sectionItems.map((item) => (
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
          );
        })}
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
