import { LogOut, ChevronDown } from "lucide-react";
import { useAuth } from "../auth/AuthProvider";
import { NotificationCenter } from "../../components/NotificationCenter";

export function Topbar() {
  const { user, signOut } = useAuth();

  return (
    <header
      className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-5"
      style={{
        height: "var(--orbit-topbar-height)",
        background: "var(--orbit-topbar-bg)",
        borderBottom: "1px solid var(--orbit-border)",
      }}
    >
      {/* Logo */}
      <div className="flex items-center gap-3">
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center text-white font-bold text-sm"
          style={{ background: "linear-gradient(135deg, #7C3AED, #4361EE)" }}
        >
          O
        </div>
        <span
          className="text-base font-semibold tracking-tight"
          style={{ color: "var(--orbit-text-primary)" }}
        >
          Orbit
        </span>
        <span
          className="text-xs px-1.5 py-0.5 rounded font-medium"
          style={{
            background: "rgba(124,58,237,0.15)",
            color: "#A78BFA",
            border: "1px solid rgba(124,58,237,0.3)",
          }}
        >
          Enterprise
        </span>
      </div>

      {/* Right side controls */}
      <div className="flex items-center gap-2">
        <NotificationCenter />

        {/* User menu */}
        <div className="relative flex items-center gap-2 pl-2">
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold"
            style={{
              background: "linear-gradient(135deg, #7C3AED, #4361EE)",
              color: "#fff",
            }}
          >
            {user.initial}
          </div>
          <div className="hidden sm:block">
            <div
              className="text-sm font-medium leading-none"
              style={{ color: "var(--orbit-text-primary)" }}
            >
              {user.displayName}
            </div>
            {user.jobTitle && (
              <div
                className="text-xs mt-0.5 leading-none"
                style={{ color: "var(--orbit-text-muted)" }}
              >
                {user.jobTitle}
              </div>
            )}
          </div>
          <ChevronDown className="w-3 h-3 hidden sm:block" style={{ color: "var(--orbit-text-muted)" }} />

          {/* Simple sign-out — Phase C will replace with a proper dropdown menu */}
          <button
            type="button"
            onClick={signOut}
            className="ml-1 w-8 h-8 rounded-lg flex items-center justify-center transition-colors"
            style={{ color: "var(--orbit-text-muted)" }}
            title="Sign out"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </header>
  );
}

export function TopbarSkeleton() {
  return (
    <header
      className="fixed top-0 left-0 right-0 z-50 flex items-center px-5"
      style={{
        height: "var(--orbit-topbar-height)",
        background: "var(--orbit-topbar-bg)",
        borderBottom: "1px solid var(--orbit-border)",
      }}
    >
      <div
        className="w-8 h-8 rounded-lg"
        style={{ background: "linear-gradient(135deg, #7C3AED, #4361EE)" }}
      />
    </header>
  );
}
