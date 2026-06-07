import { useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  AuthContext,
  type AuthContextValue,
  type AuthMode,
} from "./auth-context";
import type { EntraGroup, EntraUser } from "./auth-types";

export type { EntraGroup, EntraUser } from "./auth-types";

const AUTH_ME = "/api/auth/me";
const AUTH_LOGIN = "/api/auth/login";
const AUTH_LOGOUT = "/api/auth/logout";

type MeResponse =
  | { mode: "entra"; authenticated: false }
  | { mode: "entra"; authenticated: true; user: EntraUser; groups: EntraGroup[] };

type AuthError = "denied" | "error" | "expired" | "unavailable";

function parseAuthError(): AuthError | null {
  const v = new URLSearchParams(window.location.search).get("auth");
  return v === "denied" || v === "error" || v === "expired" ? v : null;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<AuthMode | null>(null);
  const [entra, setEntra] = useState<{ user: EntraUser; groups: EntraGroup[] } | null>(null);
  const [authError, setAuthError] = useState<AuthError | null>(null);

  useEffect(() => {
    let cancelled = false;
    const postCallbackError = parseAuthError();
    (async () => {
      try {
        const res = await fetch(AUTH_ME, {
          credentials: "same-origin",
          headers: { accept: "application/json" },
        });
        if (res.status === 401 || res.status === 503) {
          if (cancelled) return;
          if (postCallbackError) {
            setAuthError(postCallbackError);
            setMode("entra");
            return;
          }
          const returnTo = window.location.pathname + window.location.search;
          window.location.assign(`${AUTH_LOGIN}?returnTo=${encodeURIComponent(returnTo)}`);
          return;
        }
        const data = (await res.json()) as MeResponse;
        if (cancelled) return;
        if (data.mode === "entra" && "authenticated" in data && data.authenticated) {
          setEntra({ user: data.user, groups: data.groups });
          setMode("entra");
        } else {
          if (postCallbackError) {
            setAuthError(postCallbackError);
            setMode("entra");
            return;
          }
          const returnTo = window.location.pathname + window.location.search;
          window.location.assign(`${AUTH_LOGIN}?returnTo=${encodeURIComponent(returnTo)}`);
        }
      } catch {
        if (!cancelled) setAuthError("unavailable");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const signOut = useCallback(() => {
    void (async () => {
      try {
        const res = await fetch(AUTH_LOGOUT, {
          method: "POST",
          credentials: "same-origin",
          headers: { accept: "application/json" },
        });
        const data: unknown = await res.json().catch(() => null);
        const redirect =
          data && typeof data === "object" && "redirect" in data && typeof (data as { redirect: unknown }).redirect === "string"
            ? (data as { redirect: string }).redirect
            : "/";
        window.location.assign(redirect);
      } catch {
        window.location.assign("/");
      }
    })();
  }, []);

  const value = useMemo<AuthContextValue | null>(() => {
    if (mode === null || !entra) return null;
    const ids = new Set(entra.groups.map((g) => g.id));
    return {
      user: entra.user,
      groups: entra.groups,
      hasGroup: (id: string) => ids.has(id),
      mode: "entra",
      signOut,
    };
  }, [mode, entra, signOut]);

  if (authError) {
    return <AuthNotice kind={authError} onSignOut={signOut} />;
  }

  if (!value) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          color: "#94a3b8",
          fontFamily: "system-ui, sans-serif",
          background: "#0b1120",
          fontSize: 14,
        }}
      >
        Signing in…
      </div>
    );
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

const NOTICE_BTN: React.CSSProperties = {
  display: "inline-block",
  padding: "8px 16px",
  borderRadius: 4,
  border: "1px solid #334155",
  background: "#1e293b",
  color: "#e2e8f0",
  fontSize: 13,
  fontFamily: "system-ui, sans-serif",
  cursor: "pointer",
  textDecoration: "none",
};

function AuthNotice({
  kind,
  onSignOut,
}: {
  kind: AuthError;
  onSignOut: () => void;
}) {
  const denied = kind === "denied";
  const unavailable = kind === "unavailable";
  const title = denied
    ? "You don't have access to Orbit"
    : unavailable
    ? "Orbit is temporarily unavailable"
    : "Sign-in could not be completed";
  const body = denied
    ? "Your account isn't a member of the Orbit-Authorized-Users group. Ask a Kinisis administrator to grant access, then sign in again."
    : unavailable
    ? "Could not reach the Orbit API. Check that the service is running and try again."
    : "Something went wrong while signing you in. Please try again.";
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        background: "#0b1120",
        color: "#e2e8f0",
        fontFamily: "system-ui, sans-serif",
        padding: 24,
      }}
    >
      <div style={{ maxWidth: 440, textAlign: "center" }}>
        <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>{title}</div>
        <p
          style={{
            fontSize: 14,
            color: "#94a3b8",
            marginBottom: 20,
            lineHeight: 1.5,
          }}
        >
          {body}
        </p>
        {denied ? (
          <button type="button" style={NOTICE_BTN} onClick={onSignOut}>
            Sign out
          </button>
        ) : (
          <a href={AUTH_LOGIN} style={NOTICE_BTN}>
            Try again
          </a>
        )}
      </div>
    </div>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
