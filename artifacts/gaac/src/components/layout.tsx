import React, { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { useListApps } from "@workspace/api-client-react";
import { Cloud, Search, Settings, Home, Bell, DollarSign, LayoutDashboard, ChevronRight, Menu, Sun, Moon } from "lucide-react";

import { Button } from "@/components/ui/button";

type Theme = "dark" | "light";

function getInitialTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  const stored = window.localStorage.getItem("gaac-theme");
  return stored === "light" ? "light" : "dark";
}

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { data: apps } = useListApps();
  const [theme, setTheme] = useState<Theme>(getInitialTheme);
  const [navCollapsed, setNavCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("gaac-nav-collapsed") === "1";
  });

  useEffect(() => {
    window.localStorage.setItem("gaac-nav-collapsed", navCollapsed ? "1" : "0");
  }, [navCollapsed]);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") root.classList.add("dark");
    else root.classList.remove("dark");
    window.localStorage.setItem("gaac-theme", theme);
  }, [theme]);

  const toggleTheme = () => setTheme((t) => (t === "dark" ? "light" : "dark"));

  const currentAppId = location.startsWith("/apps/") ? location.split("/")[2] : null;
  const currentApp = apps?.find(a => a.id === currentAppId);

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
            <span className="font-semibold text-[14px] tracking-wide">Microsoft Azure</span>
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
            <Settings className="h-4 w-4" />
          </Button>
          <div className="h-8 w-8 ml-2 rounded-full bg-blue-600 flex items-center justify-center text-xs font-bold border border-white/20">
            A
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Nav Rail */}
        <aside
          data-collapsed={navCollapsed}
          className={`${navCollapsed ? "w-[48px]" : "w-[220px]"} border-r border-border bg-sidebar shrink-0 flex flex-col py-2 transition-all duration-150 z-10 overflow-hidden group`}
        >
          <nav className="flex flex-col gap-0.5 w-full px-1">
            <NavItem href="/" icon={<Home className="h-[18px] w-[18px]" />} label="Home" active={location === "/"} collapsed={navCollapsed} />
            <NavItem href="/alerts" icon={<Bell className="h-[18px] w-[18px]" />} label="Alerts" active={location === "/alerts"} collapsed={navCollapsed} />
            <NavItem href="/cost" icon={<DollarSign className="h-[18px] w-[18px]" />} label="Cost Management" active={location === "/cost"} collapsed={navCollapsed} />

            <div className="my-2 border-t border-border mx-2" />

            {!navCollapsed && (
              <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider px-3 py-1">
                Resources
              </div>
            )}

            <NavItem href="/" icon={<LayoutDashboard className="h-[18px] w-[18px]" />} label="All resources" active={false} collapsed={navCollapsed} />
            <NavItem href="/" icon={<Cloud className="h-[18px] w-[18px]" />} label="App Services" active={location.startsWith("/apps/")} collapsed={navCollapsed} />
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
              ) : location === "/alerts" ? (
                <span className="text-foreground font-semibold">Alerts</span>
              ) : location === "/cost" ? (
                <span className="text-foreground font-semibold">Cost Management</span>
              ) : (
                <span className="text-foreground font-semibold">Dashboard</span>
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

function NavItem({ href, icon, label, active, collapsed }: { href: string; icon: React.ReactNode; label: string; active: boolean; collapsed: boolean }) {
  return (
    <Link href={href}>
      <div
        title={collapsed ? label : undefined}
        className={`flex items-center gap-3 px-2.5 py-2 rounded-sm cursor-pointer whitespace-nowrap transition-colors
        ${active
          ? "bg-primary/10 text-primary border-l-2 border-primary"
          : "text-foreground hover:bg-muted border-l-2 border-transparent"
        }
      `}>
        <div className="shrink-0">{icon}</div>
        {!collapsed && (
          <span className="text-[13px] w-full overflow-hidden text-ellipsis">{label}</span>
        )}
      </div>
    </Link>
  );
}
