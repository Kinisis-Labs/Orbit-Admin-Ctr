import { useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  AuthContext,
  type AuthContextValue,
  type AuthMode,
} from "./auth-context";
import type { EntraGroup, EntraUser } from "./auth-types";

export type { EntraGroup, EntraUser } from "./auth-types";

/**
 * Identity + Entra ID group memberships.
 *
 * Two runtime modes, decided by the API's `/api/auth/me`:
 * - **entra**: real Microsoft Entra ID sign-in. `user`/`groups` come from the
 *   server session; an unauthenticated visit redirects to `/api/auth/login`.
 * - **mock**: the API has no Entra config (Replit dev preview). A fake user is
 *   used and the cost-readers group can be toggled to demo access control.
 */

// Required group for the Cost Management dashboard. The `id` is a stable
// client-facing key — the API echoes this same id in Entra mode (see
// COST_READER_CLIENT_ID in artifacts/api-server/src/routes/auth.ts) so the
// hasGroup() check below works identically in both modes.
export const COST_READER_GROUP: EntraGroup = {
  id: "b7e3-aad-cost-readers",
  displayName: "Orbit-Cost-Readers",
  description: "Allowed to view cost, billing, and revenue data in Orbit.",
};

const STORAGE_KEY = "orbit-mock-groups";

const AUTH_ME = "/api/auth/me";
const AUTH_LOGIN = "/api/auth/login";
const AUTH_LOGOUT = "/api/auth/logout";

const MOCK_USER: EntraUser = {
  id: "user-arielle-mendez",
  displayName: "Arielle Mendez",
  userPrincipalName: "arielle.mendez@kinisis.io",
  jobTitle: "Platform Engineer",
  initial: "A",
};

// All groups the mock user could potentially be a member of.
const MOCK_BASE_GROUPS: EntraGroup[] = [
  { id: "all-staff", displayName: "All-Staff", description: "Everyone at the company." },
  { id: "platform-engineering", displayName: "Platform-Engineering", description: "Platform engineering team." },
];

type MeResponse =
  | { mode: "mock" }
  | { mode: "entra"; authenticated: false }
  | { mode: "entra"; authenticated: true; user: EntraUser; groups: EntraGroup[] };

function loadStoredGroupIds(): string[] {
  if (typeof window === "undefined") return [COST_READER_GROUP.id];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [COST_READER_GROUP.id];
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((v) => typeof v === "string")) return parsed;
    return [COST_READER_GROUP.id];
  } catch {
    return [COST_READER_GROUP.id];
  }
}

type AuthError = "denied" | "error" | "expired";

function parseAuthError(): AuthError | null {
  const v = new URLSearchParams(window.location.search).get("auth");
  return v === "denied" || v === "error" || v === "expired" ? v : null;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  // null while /api/auth/me is in flight.
  const [mode, setMode] = useState<AuthMode | null>(null);
  const [entra, setEntra] = useState<{ user: EntraUser; groups: EntraGroup[] } | null>(null);
  const [authError, setAuthError] = useState<AuthError | null>(null);
  const [toggleableIds, setToggleableIds] = useState<string[]>(loadStoredGroupIds);

  useEffect(() => {
    let cancelled = false;
    const postCallbackError = parseAuthError();
    (async () => {
      try {
        const res = await fetch(AUTH_ME, {
          credentials: "same-origin",
          headers: { accept: "application/json" },
        });
        if (res.status === 401) {
          if (cancelled) return;
          // A failed/denied callback lands here (no session). Do NOT bounce back
          // to login — that would loop. Show a stable notice instead.
          if (postCallbackError) {
            setAuthError(postCallbackError);
            setMode("entra");
            return;
          }
          // Entra mode, not signed in — start the Entra login.
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
          setMode("mock");
        }
      } catch {
        // Network/parse error — fall back to mock so dev keeps working.
        if (!cancelled) setMode("mock");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(toggleableIds));
    } catch {
      /* ignore */
    }
  }, [toggleableIds]);

  const grantGroup = useCallback((group: EntraGroup) => {
    setToggleableIds((ids) => (ids.includes(group.id) ? ids : [...ids, group.id]));
  }, []);

  const revokeGroup = useCallback((groupId: string) => {
    setToggleableIds((ids) => ids.filter((id) => id !== groupId));
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
    if (mode === null) return null;

    if (mode === "entra" && entra) {
      const ids = new Set(entra.groups.map((g) => g.id));
      return {
        user: entra.user,
        groups: entra.groups,
        hasGroup: (id: string) => ids.has(id),
        grantGroup: () => {},
        revokeGroup: () => {},
        mode: "entra",
        signOut,
      };
    }

    // Mock mode: fake user + client-side toggleable cost-readers group.
    const toggleable: EntraGroup[] = [];
    if (toggleableIds.includes(COST_READER_GROUP.id)) toggleable.push(COST_READER_GROUP);
    const groups = [...MOCK_BASE_GROUPS, ...toggleable];
    const groupIds = new Set(groups.map((g) => g.id));
    return {
      user: MOCK_USER,
      groups,
      hasGroup: (id: string) => groupIds.has(id),
      grantGroup,
      revokeGroup,
      mode: "mock",
      signOut: () => window.location.reload(),
    };
  }, [mode, entra, toggleableIds, grantGroup, revokeGroup, signOut]);

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
  const title = denied
    ? "You don't have access to Orbit"
    : "Sign-in could not be completed";
  const body = denied
    ? "Your account isn't a member of the Orbit-Authorized-Users group. Ask a Kinisis administrator to grant access, then sign in again."
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
