import React, { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { useListApps } from "@workspace/api-client-react";
import { Activity, AlertTriangle, Cloud, CreditCard, LayoutDashboard, Search, Settings } from "lucide-react";

import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";

export function Layout({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useLocation();
  const { data: apps, isLoading } = useListApps();
  
  // Set dark mode
  useEffect(() => {
    document.documentElement.classList.add("dark");
  }, []);

  const handleAppChange = (val: string) => {
    if (val === "global") {
      setLocation("/");
    } else {
      setLocation(`/apps/${val}`);
    }
  };

  const currentAppId = location.startsWith("/apps/") ? location.split("/")[2] : "global";

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col font-sans">
      <header className="sticky top-0 z-50 border-b border-border bg-card flex items-center px-4 h-14 shrink-0 shadow-sm">
        <div className="flex items-center gap-2 mr-6 text-primary">
          <Cloud className="h-5 w-5" />
          <span className="font-semibold text-sm tracking-tight text-card-foreground">Global App Admin Center</span>
        </div>
        
        <div className="w-64">
          <Select value={currentAppId} onValueChange={handleAppChange}>
            <SelectTrigger className="h-8 text-xs bg-muted/50 border-transparent hover:bg-muted transition-colors">
              <SelectValue placeholder="Select Application" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="global" className="font-medium text-xs">All Applications (Global)</SelectItem>
              {apps?.map(app => (
                <SelectItem key={app.id} value={app.id} className="text-xs">
                  {app.name} <span className="text-muted-foreground ml-1">({app.environment})</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <nav className="flex items-center ml-8 gap-1">
          <Link href="/" className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${location === "/" ? "bg-secondary text-secondary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"}`}>
            Overview
          </Link>
          <Link href="/alerts" className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${location === "/alerts" ? "bg-secondary text-secondary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"}`}>
            Alerts
          </Link>
          <Link href="/cost" className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${location === "/cost" ? "bg-secondary text-secondary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"}`}>
            Cost
          </Link>
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground">
            <Search className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground">
            <Settings className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  );
}
