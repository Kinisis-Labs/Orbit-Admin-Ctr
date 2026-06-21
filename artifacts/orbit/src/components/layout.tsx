import React, { useCallback, useEffect, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { useApps } from "@/hooks/use-apps";
import { useApp } from "@/hooks/use-app";
import {
  Search,
  Settings as SettingsIcon,
  Home,
  Bell,
  DollarSign,
  LayoutDashboard,
  ChevronRight,
  Menu,
  Sun,
  Moon,
  Lock,
  Rocket,
  AlertOctagon,
  Activity,
  HeartPulse,
  Network,
  FileText,
  ShieldAlert,
  Users,
  Layers,
  Tags,
  SlidersHorizontal,
  UserCheck,
  Smartphone,
  ChevronDown,
  ToggleLeft,
  RefreshCw,
  CreditCard,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { UserMenu } from "@/components/user-menu";
import { useAuth } from "@/lib/auth";
import { ADMIN_GROUP, COST_READER_GROUP } from "@/lib/auth-groups";
import { useOverBudgetDays } from "@/hooks/use-over-budget-days";
import { useInfraThresholdAlerts } from "@/hooks/use-infra-threshold-alerts";
import type { InfraViolation } from "@/hooks/use-infra-threshold-alerts";
import { useUnacknowledgedBudgetAlerts } from "@/hooks/use-unacknowledged-budget-alerts";
import { InfraViolationContext } from "@/lib/infra-violation-context";

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
  "/play-subscriptions": "Google Subscriptions",
  "/apple-subscriptions": "Apple Subscriptions",
  "/stripe-subscriptions": "Stripe Subscriptions",
  "/subscriptions": "Subscriptions",
  "/tags": "Tags",
  "/access": "Identity & access",
  "/preferences": "Preferences",
  "/admin/feature-flags": "Feature flags",
  "/resources": "All resources",
  "/apps": "App Services",
};

function getInitialTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  const stored = window.localStorage.getItem("orbit-theme");
  return stored === "light" ? "light" : "dark";
}

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { data: apps } = useApps();
  const { hasGroup } = useAuth();
  const canSeeCost = hasGroup(COST_READER_GROUP.id);
  const isAdmin = hasGroup(ADMIN_GROUP.id);
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

  const { overBudgetCount } = useOverBudgetDays(canSeeCost);
  const {
    overThresholdCount,
    unseenViolationCount,
    activeViolations,
    violations: infraViolations,
  } = useInfraThresholdAlerts();
  const { unacknowledgedCount: unacknowledgedBudgetAlerts } =
    useUnacknowledgedBudgetAlerts(canSeeCost);

  const search = useSearch();
  const currentAppId = location.startsWith("/apps/") ? location.split("/")[2] : null;

  const TAB_LABELS: Record<string, string> = {
    overview: "Overview",
    infrastructure: "Infrastructure",
    network: "Network",
    telemetry: "Telemetry",
    cost: "Cost",
    ledger: "Ledger",
    alerts: "Alerts",
  };

  const VALID_TABS = [
    "overview",
    "infrastructure",
    "network",
    "telemetry",
    "cost",
    "ledger",
    "alerts",
  ];
  const rawTab = new URLSearchParams(currentAppId ? search : "").get("tab") ?? "";
  const activeTab = VALID_TABS.includes(rawTab) ? rawTab : "overview";
  const activeTabLabel = TAB_LABELS[activeTab];
  const currentApp = apps?.find((a) => a.id === currentAppId);
  const { data: currentAppDetail } = useApp(currentAppId && !currentApp ? currentAppId : undefined);
  const currentAppName = currentApp?.name ?? currentAppDetail?.name ?? currentAppId;
  const isCostRoute = location === "/cost";

  return (
    <InfraViolationContext.Provider value={{ activeViolations }}>
      <div className="h-screen flex flex-col bg-background text-foreground font-sans overflow-hidden">
        {/* Top Header */}
        <header className="h-14 orbit-topbar text-sidebar-foreground flex items-center px-4 shrink-0 justify-between select-none z-20">
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => setNavCollapsed((c) => !c)}
              aria-label={navCollapsed ? "Expand navigation" : "Collapse navigation"}
              title={navCollapsed ? "Expand navigation" : "Collapse navigation"}
              className="p-1.5 rounded-md hover:bg-white/10 transition-colors"
            >
              <Menu className="h-5 w-5 text-gray-300 hover:text-white" />
            </button>
            <Link href="/" className="flex items-center gap-2">
              <span className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 via-indigo-500 to-cyan-400 shadow-[0_0_10px_rgba(124,58,237,0.5)]">
                <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4" aria-hidden="true">
                  <ellipse
                    cx="10"
                    cy="10"
                    rx="8"
                    ry="3.5"
                    stroke="white"
                    strokeWidth="1.5"
                    strokeOpacity="0.9"
                  />
                  <ellipse
                    cx="10"
                    cy="10"
                    rx="8"
                    ry="3.5"
                    stroke="white"
                    strokeWidth="1.5"
                    strokeOpacity="0.9"
                    transform="rotate(60 10 10)"
                  />
                  <ellipse
                    cx="10"
                    cy="10"
                    rx="8"
                    ry="3.5"
                    stroke="white"
                    strokeWidth="1.5"
                    strokeOpacity="0.9"
                    transform="rotate(120 10 10)"
                  />
                  <circle cx="10" cy="10" r="2" fill="white" />
                </svg>
              </span>
              <span className="font-semibold text-[14px] tracking-[0.18em] uppercase">
                O.R.B.I.T.
              </span>
            </Link>

            <div className="relative hidden md:flex items-center ml-6">
              <Search className="h-3.5 w-3.5 absolute left-3 text-gray-400 pointer-events-none" />
              <input
                type="text"
                placeholder="Search resources, services, and docs (G+/)"
                className="orbit-search-input h-8 w-96 pl-9 pr-12 text-[13px]"
              />
              <span className="absolute right-3 text-[10px] text-gray-500 font-mono select-none">
                ⌘K
              </span>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleTheme}
              aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
              title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
              className="h-8 w-8 text-gray-300 hover:text-white hover:bg-white/10 rounded-md transition-colors"
            >
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-gray-300 hover:text-white hover:bg-white/10 rounded-md transition-colors relative"
            >
              <Bell className="h-4 w-4" />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Settings"
                  title="Settings"
                  className="h-8 w-8 text-gray-300 hover:text-white hover:bg-white/10 rounded-md transition-colors data-[state=open]:bg-white/10 data-[state=open]:text-white"
                >
                  <SettingsIcon className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" sideOffset={6} className="w-48 rounded-sm">
                <DropdownMenuItem asChild className="text-[13px] cursor-pointer">
                  <Link href="/preferences">
                    <SlidersHorizontal className="h-3.5 w-3.5 mr-2" />
                    Preferences
                  </Link>
                </DropdownMenuItem>
                {isAdmin && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem asChild className="text-[13px] cursor-pointer">
                      <Link href="/admin/feature-flags">
                        <ToggleLeft className="h-3.5 w-3.5 mr-2" />
                        Feature flags
                      </Link>
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            <UserMenu />
          </div>
        </header>

        {/* Main Content Area */}
        <div className="flex flex-1 overflow-hidden">
          {/* Left Nav Rail */}
          <aside
            data-collapsed={navCollapsed}
            className={`${navCollapsed ? "w-[48px]" : "w-[220px]"} border-r border-sidebar-border shrink-0 flex flex-col py-2 transition-all duration-[200ms] ease-in-out z-10 overflow-y-auto group`}
          >
            <nav className="flex flex-col gap-0.5 w-full px-1">
              <NavSection sectionKey="monitoring" label="Monitoring" navCollapsed={navCollapsed}>
                <NavItem
                  href="/"
                  icon={<Home className="h-[18px] w-[18px]" />}
                  label="Dashboard"
                  active={location === "/"}
                  collapsed={navCollapsed}
                />
                <NavItem
                  href="/alerts"
                  icon={<Bell className="h-[18px] w-[18px]" />}
                  label="Alerts"
                  active={location === "/alerts"}
                  collapsed={navCollapsed}
                  alertCount={overThresholdCount}
                  unseenViolationCount={unseenViolationCount}
                  infraViolations={infraViolations}
                />
                <NavItem
                  href="/deployments"
                  icon={<Rocket className="h-[18px] w-[18px]" />}
                  label="Deployments"
                  active={location === "/deployments"}
                  collapsed={navCollapsed}
                />
                <NavItem
                  href="/incidents"
                  icon={<AlertOctagon className="h-[18px] w-[18px]" />}
                  label="Incidents"
                  active={location === "/incidents"}
                  collapsed={navCollapsed}
                />
                <NavItem
                  href="/activity"
                  icon={<Activity className="h-[18px] w-[18px]" />}
                  label="Activity log"
                  active={location === "/activity"}
                  collapsed={navCollapsed}
                />
                <NavItem
                  href="/health"
                  icon={<HeartPulse className="h-[18px] w-[18px]" />}
                  label="Health & SLOs"
                  active={location === "/health"}
                  collapsed={navCollapsed}
                />
                <NavItem
                  href="/network"
                  icon={<Network className="h-[18px] w-[18px]" />}
                  label="Network"
                  active={location === "/network"}
                  collapsed={navCollapsed}
                />
                <NavItem
                  href="/logs"
                  icon={<FileText className="h-[18px] w-[18px]" />}
                  label="Log search"
                  active={location === "/logs"}
                  collapsed={navCollapsed}
                />
                <NavItem
                  href="/service-health"
                  icon={<ShieldAlert className="h-[18px] w-[18px]" />}
                  label="Service health"
                  active={location === "/service-health"}
                  collapsed={navCollapsed}
                />
                <NavItem
                  href="/users"
                  icon={<UserCheck className="h-[18px] w-[18px]" />}
                  label="Users & activity"
                  active={location === "/users"}
                  collapsed={navCollapsed}
                />
              </NavSection>

              <NavSection sectionKey="cost" label="Cost" navCollapsed={navCollapsed}>
                <NavItem
                  href="/cost"
                  icon={<DollarSign className="h-[18px] w-[18px]" />}
                  label="Cost Management"
                  active={isCostRoute}
                  collapsed={navCollapsed}
                  trailingIcon={
                    !canSeeCost ? <Lock className="h-3 w-3 text-muted-foreground" /> : undefined
                  }
                  trailingTitle={
                    !canSeeCost
                      ? `Restricted to members of ${COST_READER_GROUP.displayName}`
                      : undefined
                  }
                  unacknowledgedBudgetAlerts={canSeeCost ? unacknowledgedBudgetAlerts : 0}
                />
                <NavItem
                  href="/play-subscriptions"
                  icon={<Smartphone className="h-[18px] w-[18px]" />}
                  label="Google Subscriptions"
                  active={location === "/play-subscriptions"}
                  collapsed={navCollapsed}
                  trailingIcon={
                    !canSeeCost ? <Lock className="h-3 w-3 text-muted-foreground" /> : undefined
                  }
                  trailingTitle={
                    !canSeeCost
                      ? `Restricted to members of ${COST_READER_GROUP.displayName}`
                      : undefined
                  }
                />
                <NavItem
                  href="/apple-subscriptions"
                  icon={<Smartphone className="h-[18px] w-[18px]" />}
                  label="Apple Subscriptions"
                  active={location === "/apple-subscriptions"}
                  collapsed={navCollapsed}
                  trailingIcon={
                    !canSeeCost ? <Lock className="h-3 w-3 text-muted-foreground" /> : undefined
                  }
                  trailingTitle={
                    !canSeeCost
                      ? `Restricted to members of ${COST_READER_GROUP.displayName}`
                      : undefined
                  }
                />
                <NavItem
                  href="/stripe-subscriptions"
                  icon={<CreditCard className="h-[18px] w-[18px]" />}
                  label="Stripe Subscriptions"
                  active={location === "/stripe-subscriptions"}
                  collapsed={navCollapsed}
                  trailingIcon={
                    !canSeeCost ? <Lock className="h-3 w-3 text-muted-foreground" /> : undefined
                  }
                  trailingTitle={
                    !canSeeCost
                      ? `Restricted to members of ${COST_READER_GROUP.displayName}`
                      : undefined
                  }
                />
                <NavItem
                  href="/store-reports"
                  icon={<RefreshCw className="h-[18px] w-[18px]" />}
                  label="Store ingestion"
                  active={location === "/store-reports"}
                  collapsed={navCollapsed}
                  trailingIcon={
                    !canSeeCost ? <Lock className="h-3 w-3 text-muted-foreground" /> : undefined
                  }
                  trailingTitle={
                    !canSeeCost
                      ? `Restricted to members of ${COST_READER_GROUP.displayName}`
                      : undefined
                  }
                />
              </NavSection>

              <NavSection sectionKey="governance" label="Governance" navCollapsed={navCollapsed}>
                <NavItem
                  href="/subscriptions"
                  icon={<Layers className="h-[18px] w-[18px]" />}
                  label="Subscriptions"
                  active={location === "/subscriptions"}
                  collapsed={navCollapsed}
                />
                <NavItem
                  href="/tags"
                  icon={<Tags className="h-[18px] w-[18px]" />}
                  label="Tags"
                  active={location === "/tags"}
                  collapsed={navCollapsed}
                />
                <NavItem
                  href="/access"
                  icon={<Users className="h-[18px] w-[18px]" />}
                  label="Identity & access"
                  active={location === "/access"}
                  collapsed={navCollapsed}
                />
              </NavSection>

              <NavSection sectionKey="resources" label="Resources" navCollapsed={navCollapsed}>
                <NavItem
                  href="/resources"
                  icon={<LayoutDashboard className="h-[18px] w-[18px]" />}
                  label="All resources"
                  active={location === "/resources"}
                  collapsed={navCollapsed}
                />
              </NavSection>
            </nav>
          </aside>

          {/* Content */}
          <div className="flex-1 flex flex-col min-w-0 overflow-hidden bg-background">
            {/* Global Breadcrumb / Command Bar */}
            <div className="h-9 orbit-breadcrumb-bar flex items-center px-4 shrink-0 text-[13px]">
              <div className="flex items-center text-muted-foreground">
                <Link href="/" className="hover:text-primary hover:underline transition-colors">
                  Home
                </Link>
                <ChevronRight className="h-3.5 w-3.5 mx-1" />
                {currentAppId ? (
                  <>
                    <Link href="/" className="hover:text-primary hover:underline transition-colors">
                      App Services
                    </Link>
                    <ChevronRight className="h-3.5 w-3.5 mx-1" />
                    <Link
                      href={`/apps/${currentAppId}?tab=overview`}
                      className="hover:text-primary hover:underline transition-colors"
                    >
                      {currentAppName}
                    </Link>
                    <ChevronRight className="h-3.5 w-3.5 mx-1" />
                    <Link
                      href={`/apps/${currentAppId}?tab=${activeTab}`}
                      className="text-foreground font-semibold hover:text-primary hover:underline transition-colors"
                    >
                      {activeTabLabel}
                    </Link>
                  </>
                ) : (
                  <span className="text-foreground font-semibold">
                    {ROUTE_LABELS[location] ?? "Dashboard"}
                  </span>
                )}
              </div>
            </div>

            <main className="flex-1 overflow-auto bg-background">
              <div className="p-5 max-w-full orbit-page-enter">{children}</div>
            </main>
          </div>
        </div>
      </div>
    </InfraViolationContext.Provider>
  );
}

function getSectionOpen(key: string): boolean {
  try {
    const stored = window.localStorage.getItem(`orbit-nav-section-${key}`);
    if (stored === "0") return false;
  } catch {
    // ignore
  }
  return true;
}

function NavSection({
  sectionKey,
  label,
  navCollapsed,
  children,
}: {
  sectionKey: string;
  label: string;
  navCollapsed: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState<boolean>(() => getSectionOpen(sectionKey));

  const toggle = useCallback(() => {
    setOpen((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(`orbit-nav-section-${sectionKey}`, next ? "1" : "0");
      } catch {
        // ignore
      }
      return next;
    });
  }, [sectionKey]);

  if (navCollapsed) {
    return (
      <>
        <div className="my-2 border-t border-border mx-2" />
        {children}
      </>
    );
  }

  return (
    <>
      <div className="my-1.5 border-t border-border mx-2" />
      <button
        type="button"
        onClick={toggle}
        className="flex items-center justify-between w-full px-3 py-1 group/section hover:text-foreground transition-colors"
        title={open ? `Collapse ${label}` : `Expand ${label}`}
      >
        <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider group-hover/section:text-foreground transition-colors">
          {label}
        </span>
        <ChevronDown
          className={`h-3 w-3 text-muted-foreground group-hover/section:text-foreground transition-all duration-150 ${open ? "" : "-rotate-90"}`}
        />
      </button>
      {open && children}
    </>
  );
}

const MAX_VIOLATION_LINES = 5;

function buildViolationTooltip(violations: InfraViolation[]): string {
  const shown = violations.slice(0, MAX_VIOLATION_LINES);
  const rest = violations.length - shown.length;
  const lines = shown.map((v) => `${v.appName} — ${v.metric} ${v.value.toFixed(1)}%`);
  if (rest > 0) lines.push(`+${rest} more`);
  return lines.join("\n");
}

function NavItem({
  href,
  icon,
  label,
  active,
  collapsed,
  trailingIcon,
  trailingTitle,
  overBudgetCount = 0,
  alertCount = 0,
  unseenViolationCount = 0,
  unacknowledgedBudgetAlerts = 0,
  infraViolations = [],
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  active: boolean;
  collapsed: boolean;
  trailingIcon?: React.ReactNode;
  trailingTitle?: string;
  overBudgetCount?: number;
  alertCount?: number;
  unseenViolationCount?: number;
  unacknowledgedBudgetAlerts?: number;
  infraViolations?: InfraViolation[];
}) {
  const hasBudgetAlert = overBudgetCount > 0;
  const hasInfraAlert = alertCount > 0;
  const hasUnacknowledged = unacknowledgedBudgetAlerts > 0;
  const hasUnseenViolation = unseenViolationCount > 0;
  const hasAlert = hasBudgetAlert || hasInfraAlert || hasUnacknowledged || hasUnseenViolation;

  const badgeCount = hasUnacknowledged
    ? unacknowledgedBudgetAlerts
    : hasBudgetAlert
      ? overBudgetCount
      : hasInfraAlert
        ? alertCount
        : unseenViolationCount;

  const infraDetail =
    hasInfraAlert && infraViolations.length > 0 ? buildViolationTooltip(infraViolations) : null;

  const collapsedTitle = hasUnacknowledged
    ? `${label} — ${unacknowledgedBudgetAlerts} unacknowledged budget ${unacknowledgedBudgetAlerts === 1 ? "alert" : "alerts"}`
    : hasBudgetAlert
      ? `${label} — ${overBudgetCount} over-budget ${overBudgetCount === 1 ? "app" : "apps"}`
      : infraDetail
        ? `${label} — ${infraDetail}`
        : hasInfraAlert
          ? `${label} — ${alertCount} ${alertCount === 1 ? "app" : "apps"} over infra threshold`
          : hasUnseenViolation
            ? `${label} — ${unseenViolationCount} unseen threshold ${unseenViolationCount === 1 ? "violation" : "violations"}`
            : label;
  const badgeTitle = hasUnacknowledged
    ? `${unacknowledgedBudgetAlerts} unacknowledged budget ${unacknowledgedBudgetAlerts === 1 ? "alert" : "alerts"}`
    : hasBudgetAlert
      ? `${overBudgetCount} over-budget ${overBudgetCount === 1 ? "app" : "apps"} in the current window`
      : infraDetail
        ? infraDetail
        : hasInfraAlert
          ? `${alertCount} ${alertCount === 1 ? "app" : "apps"} currently over infra threshold`
          : `${unseenViolationCount} unseen threshold ${unseenViolationCount === 1 ? "violation" : "violations"}`;

  return (
    <Link href={href}>
      <div
        title={collapsed ? collapsedTitle : trailingTitle}
        className={`flex items-center gap-3 px-2.5 py-[7px] rounded-[6px] cursor-pointer whitespace-nowrap transition-all duration-150
        ${
          active
            ? "bg-primary/12 text-primary border-l-2 border-primary nav-item-active"
            : "text-sidebar-foreground/80 hover:text-sidebar-foreground hover:bg-sidebar-accent border-l-2 border-transparent"
        }
      `}
      >
        <div className="relative shrink-0">
          {icon}
          {hasAlert && collapsed && (
            <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-destructive opacity-60" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-destructive" />
            </span>
          )}
        </div>
        {!collapsed && (
          <span className="text-[13px] flex-1 overflow-hidden text-ellipsis">{label}</span>
        )}
        {!collapsed && hasAlert && (
          <span
            className="shrink-0 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-destructive text-white text-[10px] font-bold leading-none"
            title={badgeTitle}
          >
            {badgeCount > 99 ? "99+" : badgeCount}
          </span>
        )}
        {!collapsed && !hasAlert && trailingIcon && <div className="shrink-0">{trailingIcon}</div>}
        {!collapsed && hasAlert && trailingIcon && <div className="shrink-0">{trailingIcon}</div>}
      </div>
    </Link>
  );
}
