import React, { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { useListApps } from "@workspace/api-client-react";
import {
  Cloud, Search, Settings as SettingsIcon, Home, Bell, DollarSign, LayoutDashboard,
  ChevronRight, Menu, Sun, Moon, Lock, Rocket, AlertOctagon, Activity,
  HeartPulse, Network, FileText, ShieldAlert, Users, Layers, Tags, SlidersHorizontal, UserCheck,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { UserMenu } from "@/components/user-menu";
import { useAuth, COST_READER_GROUP } from "@/lib/auth";

type Theme = "dark" | "light";

const ROUTE_LABELS: Record<string, string> = {
  "/": "Dashboard",
  "/alerts": "Alerts",
  "/deployments": "Deployments",
  "/incidents": "Incidents",
  "/activity": "Activity log",
  "/health": "Health & SLOs",
  "/network": "Network",
  "/logs": "Log search",
  "/service-health": "Service health",
  "/users": "Users & activity",
  "/cost": "Cost Management",
  "/cost/budgets": "Budgets",
  "/cost/forecasts": "Forecasts",
  "/subscriptions": "Subscriptions",
  "/tags": "Tags",
  "/access": "Identity & access",
  "/preferences": "Preferences",
};

function getInitialTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  const stored = window.localStorage.getItem("orbit-theme");
  return stored === "light" ? "light" : "dark";
}

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { data: apps } = useListApps();
  const { hasGroup } = useAuth();
  const canSeeCost = hasGroup(COST_READER_GROUP.id);
  const [theme, setTheme] = useState<Theme>(getInitialTheme);
  const [navCollapsed, setNavCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("orbit-nav-collapsed") === "1";
  });

  useEffect(() => {
    window.localStorage.setItem("orbit-nav-collapsed", navCollapsed ? "1" : "0");
  }, [navCollapsed]);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") root.classList.add("dark");
    else root.classList.remove("dark");
    window.localStorage.setItem("orbit-theme", theme);
  }, [theme]);

  const toggleTheme = () => setTheme((t) => (t === "dark" ? "light" : "dark"));

  const currentAppId = location.startsWith("/apps/") ? location.split("/")[2] : null;
  const currentApp = apps?.find(a => a.id === currentAppId);
  const isCostRoute = location === "/cost" || location.startsWith("/cost/");

  return (
    <div className="h-screen flex flex-col bg-background text-foreground font-sans overflow-hidden">
      {/* Top Header */}
      <header className="h-12 bg-[#001429] text-white flex items-center px-4 shrink-0 justify-between select-none">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => setNavCollapsed((c) => !c)}
            aria-label={navCollapsed ? "Expand navigation" : "Collapse navigation"}
            title={navCollapsed ? "Expand navigation" : "Collapse navigation"}
            className="p-1 rounded-sm hover:bg-white/10"
          >
            <Menu className="h-5 w-5 text-gray-300 hover:text-white" />
          </button>
          <Link href="/" className="flex items-center gap-2">
            <span className="font-semibold text-[14px] tracking-wide">Orbit Command Center</span>
            <span className="text-[11px] text-gray-400 hidden lg:inline">· Azure Operations</span>
          </Link>

          <div className="relative hidden md:flex items-center ml-6">
            <Search className="h-4 w-4 absolute left-2 text-gray-400" />
            <input
              type="text"
              placeholder="Search resources, services, and docs (G+/)"
              className="bg-[rgba(255,255,255,0.1)] border-none h-8 w-96 pl-8 pr-3 text-[13px] text-white placeholder-gray-400 rounded-sm focus:outline-none focus:ring-1 focus:ring-white/50 transition-all"
            />
          </div>
        </div>

        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleTheme}
            aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
            title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
            className="h-8 w-8 text-gray-300 hover:text-white hover:bg-white/10 rounded-sm"
          >
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 text-gray-300 hover:text-white hover:bg-white/10 rounded-sm">
            <Bell className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 text-gray-300 hover:text-white hover:bg-white/10 rounded-sm">
            <SettingsIcon className="h-4 w-4" />
          </Button>
          <UserMenu />
        </div>
      </header>

      {/* Main Content Area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Nav Rail */}
        <aside
          data-collapsed={navCollapsed}
          className={`${navCollapsed ? "w-[48px]" : "w-[220px]"} border-r border-border bg-sidebar shrink-0 flex flex-col py-2 transition-all duration-150 z-10 overflow-y-auto group`}
        >
          <nav className="flex flex-col gap-0.5 w-full px-1">
            <NavGroup label="Monitoring" collapsed={navCollapsed} />
            <NavItem href="/" icon={<Home className="h-[18px] w-[18px]" />} label="Home" active={location === "/"} collapsed={navCollapsed} />
            <NavItem href="/alerts" icon={<Bell className="h-[18px] w-[18px]" />} label="Alerts" active={location === "/alerts"} collapsed={navCollapsed} />
            <NavItem href="/deployments" icon={<Rocket className="h-[18px] w-[18px]" />} label="Deployments" active={location === "/deployments"} collapsed={navCollapsed} />
            <NavItem href="/incidents" icon={<AlertOctagon className="h-[18px] w-[18px]" />} label="Incidents" active={location === "/incidents"} collapsed={navCollapsed} />
            <NavItem href="/activity" icon={<Activity className="h-[18px] w-[18px]" />} label="Activity log" active={location === "/activity"} collapsed={navCollapsed} />
            <NavItem href="/health" icon={<HeartPulse className="h-[18px] w-[18px]" />} label="Health & SLOs" active={location === "/health"} collapsed={navCollapsed} />
            <NavItem href="/network" icon={<Network className="h-[18px] w-[18px]" />} label="Network" active={location === "/network"} collapsed={navCollapsed} />
            <NavItem href="/logs" icon={<FileText className="h-[18px] w-[18px]" />} label="Log search" active={location === "/logs"} collapsed={navCollapsed} />
            <NavItem href="/service-health" icon={<ShieldAlert className="h-[18px] w-[18px]" />} label="Service health" active={location === "/service-health"} collapsed={navCollapsed} />
            <NavItem href="/users" icon={<UserCheck className="h-[18px] w-[18px]" />} label="Users & activity" active={location === "/users"} collapsed={navCollapsed} />

            <NavGroup label="Cost" collapsed={navCollapsed} />
            <NavItem
              href="/cost"
              icon={<DollarSign className="h-[18px] w-[18px]" />}
              label="Cost Management"
              active={isCostRoute}
              collapsed={navCollapsed}
              trailingIcon={!canSeeCost ? <Lock className="h-3 w-3 text-muted-foreground" /> : undefined}
              trailingTitle={!canSeeCost ? `Restricted to members of ${COST_READER_GROUP.displayName}` : undefined}
            />

            <NavGroup label="Governance" collapsed={navCollapsed} />
            <NavItem href="/subscriptions" icon={<Layers className="h-[18px] w-[18px]" />} label="Subscriptions" active={location === "/subscriptions"} collapsed={navCollapsed} />
            <NavItem href="/tags" icon={<Tags className="h-[18px] w-[18px]" />} label="Tags" active={location === "/tags"} collapsed={navCollapsed} />
            <NavItem href="/access" icon={<Users className="h-[18px] w-[18px]" />} label="Identity & access" active={location === "/access"} collapsed={navCollapsed} />

            <NavGroup label="Resources" collapsed={navCollapsed} />
            <NavItem href="/" icon={<LayoutDashboard className="h-[18px] w-[18px]" />} label="All resources" active={false} collapsed={navCollapsed} />
            <NavItem href="/" icon={<Cloud className="h-[18px] w-[18px]" />} label="App Services" active={location.startsWith("/apps/")} collapsed={navCollapsed} />

            <NavGroup label="Settings" collapsed={navCollapsed} />
            <NavItem href="/preferences" icon={<SlidersHorizontal className="h-[18px] w-[18px]" />} label="Preferences" active={location === "/preferences"} collapsed={navCollapsed} />
          </nav>
        </aside>

        {/* Content */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden bg-background">
          {/* Global Breadcrumb / Command Bar */}
          <div className="h-10 bg-card border-b border-border flex items-center px-4 shrink-0 text-[13px]">
            <div className="flex items-center text-muted-foreground">
              <Link href="/" className="hover:text-primary hover:underline transition-colors">Home</Link>
              <ChevronRight className="h-3.5 w-3.5 mx-1" />
              {currentAppId ? (
                <>
                  <Link href="/" className="hover:text-primary hover:underline transition-colors">App Services</Link>
                  <ChevronRight className="h-3.5 w-3.5 mx-1" />
                  <span className="text-foreground font-semibold">{currentApp?.name || currentAppId}</span>
                </>
              ) : location.startsWith("/cost/") ? (
                <>
                  <Link href="/cost" className="hover:text-primary hover:underline transition-colors">Cost Management</Link>
                  <ChevronRight className="h-3.5 w-3.5 mx-1" />
                  <span className="text-foreground font-semibold">{ROUTE_LABELS[location] ?? "Cost"}</span>
                </>
              ) : (
                <span className="text-foreground font-semibold">{ROUTE_LABELS[location] ?? "Dashboard"}</span>
              )}
            </div>
          </div>

          <main className="flex-1 overflow-auto bg-background">
            <div className="p-4 max-w-full">
              {children}
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}

function NavGroup({ label, collapsed }: { label: string; collapsed: boolean }) {
  if (collapsed) return <div className="my-2 border-t border-border mx-2" />;
  return (
    <>
      <div className="my-1.5 border-t border-border mx-2" />
      <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider px-3 py-1">
        {label}
      </div>
    </>
  );
}

function NavItem({
  href,
  icon,
  label,
  active,
  collapsed,
  trailingIcon,
  trailingTitle,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  active: boolean;
  collapsed: boolean;
  trailingIcon?: React.ReactNode;
  trailingTitle?: string;
}) {
  return (
    <Link href={href}>
      <div
        title={collapsed ? label : trailingTitle}
        className={`flex items-center gap-3 px-2.5 py-2 rounded-sm cursor-pointer whitespace-nowrap transition-colors
        ${active
          ? "bg-primary/10 text-primary border-l-2 border-primary"
          : "text-foreground hover:bg-muted border-l-2 border-transparent"
        }
      `}>
        <div className="shrink-0">{icon}</div>
        {!collapsed && (
          <span className="text-[13px] flex-1 overflow-hidden text-ellipsis">{label}</span>
        )}
        {!collapsed && trailingIcon && <div className="shrink-0">{trailingIcon}</div>}
      </div>
    </Link>
  );
}
