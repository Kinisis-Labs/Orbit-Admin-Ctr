import { useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  AccessContactContext,
  AuthContext,
  type AuthContextValue,
  type AuthMode,
} from "./auth-context";
import type { EntraGroup, EntraUser } from "./auth-types";
import {
  AUTHORIZED_USERS_GROUP,
  TOGGLEABLE_GROUPS,
} from "./auth-groups";

export type { EntraGroup, EntraUser } from "./auth-types";

const AUTH_ME = "/api/auth/me";
const AUTH_LOGIN = "/api/auth/login";
const AUTH_LOGOUT = "/api/auth/logout";

const MOCK_LS_KEY = "orbit-mock-groups";

const MOCK_USER: EntraUser = {
  id: "dev-mock-user",
  displayName: "Dev User",
  userPrincipalName: "dev@kinisislabs.com",
  jobTitle: "Developer",
  initial: "D",
};

/** Persist the set of toggled-on group IDs to localStorage. */
function saveMockGroups(ids: Set<string>) {
  try {
    localStorage.setItem(MOCK_LS_KEY, JSON.stringify([...ids]));
  } catch {
    /* ignore */
  }
}

/**
 * Load the set of toggled-on group IDs from localStorage.
 * On first load (no key yet) we default to AUTHORIZED_USERS so the app
 * starts in a usable state, but the user can revoke it too.
 */
function loadMockGroups(): Set<string> {
  try {
    const raw = localStorage.getItem(MOCK_LS_KEY);
    if (raw === null) {
      return new Set([AUTHORIZED_USERS_GROUP.id]);
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set([AUTHORIZED_USERS_GROUP.id]);
    return new Set(parsed.filter((x): x is string => typeof x === "string"));
  } catch {
    return new Set([AUTHORIZED_USERS_GROUP.id]);
  }
}

type MeResponse =
  | { mode: "mock"; accessContact?: string }
  | { mode: "entra"; authenticated: false; accessContact?: string }
  | { mode: "entra"; authenticated: true; user: EntraUser; groups: EntraGroup[]; accessContact?: string };

type AuthError = "denied" | "error" | "expired" | "unavailable" | "revoked";

function parseAuthError(): AuthError | null {
  const v = new URLSearchParams(window.location.search).get("auth");
  return v === "denied" || v === "error" || v === "expired" ? v : null;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<AuthMode | null>(null);
  const [entra, setEntra] = useState<{ user: EntraUser; groups: EntraGroup[] } | null>(null);
  const [authError, setAuthError] = useState<AuthError | null>(null);
  const [accessContact, setAccessContact] = useState<string>(ORBIT_ACCESS_EMAIL);

  // Mock mode — extra toggled groups (AUTHORIZED_USERS is always on)
  const [mockExtras, setMockExtras] = useState<Set<string>>(() => loadMockGroups());

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
          // Try to read accessContact from the 401 body before handling the error.
          try {
            const body = (await res.clone().json()) as MeResponse;
            if (body.accessContact) setAccessContact(body.accessContact);
          } catch {
            /* ignore — body may not be JSON */
          }
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
        if (data.accessContact) setAccessContact(data.accessContact);
        if (data.mode === "mock") {
          setMode("mock");
          return;
        }
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

  // Poll /auth/me every 15 min while the tab is visible (entra mode only).
  // Updates badges immediately when group membership changes; redirects on 401.
  useEffect(() => {
    if (mode !== "entra") return;

    const POLL_MS = 15 * 60 * 1000;

    const poll = async () => {
      if (document.visibilityState === "hidden") return;
      try {
        const res = await fetch(AUTH_ME, {
          credentials: "same-origin",
          headers: { accept: "application/json" },
        });
        if (res.status === 401 || res.status === 403) {
          setAuthError("revoked");
          return;
        }
        if (!res.ok) return;
        const data = (await res.json()) as MeResponse;
        if (data.mode === "entra" && "authenticated" in data) {
          if (data.authenticated) {
            setEntra({ user: data.user, groups: data.groups });
          } else {
            setAuthError("revoked");
          }
        }
      } catch {
        // Transient network error — skip this tick, try again next interval
      }
    };

    const id = setInterval(() => void poll(), POLL_MS);
    return () => clearInterval(id);
  }, [mode]);

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

  const grantGroup = useCallback((id: string) => {
    setMockExtras((prev) => {
      const next = new Set(prev);
      next.add(id);
      saveMockGroups(next);
      return next;
    });
  }, []);

  const revokeGroup = useCallback((id: string) => {
    setMockExtras((prev) => {
      const next = new Set(prev);
      next.delete(id);
      saveMockGroups(next);
      return next;
    });
  }, []);

  const value = useMemo<AuthContextValue | null>(() => {
    if (mode === null) return null;

    if (mode === "mock") {
      const toggleableIds = new Set(TOGGLEABLE_GROUPS.map((g) => g.id));
      const groups: EntraGroup[] = TOGGLEABLE_GROUPS.filter((g) => mockExtras.has(g.id));
      const ids = new Set(groups.map((g) => g.id));
      return {
        user: MOCK_USER,
        groups,
        hasGroup: (id: string) => ids.has(id),
        mode: "mock",
        isMock: true,
        signOut,
        accessContact,
        grantGroup: (id: string) => toggleableIds.has(id) && grantGroup(id),
        revokeGroup: (id: string) => toggleableIds.has(id) && revokeGroup(id),
      };
    }

    if (!entra) return null;
    const ids = new Set(entra.groups.map((g) => g.id));
    return {
      user: entra.user,
      groups: entra.groups,
      hasGroup: (id: string) => ids.has(id),
      mode: "entra",
      isMock: false,
      signOut,
      accessContact,
    };
  }, [mode, entra, mockExtras, signOut, grantGroup, revokeGroup, accessContact]);

  if (authError) {
    return (
      <AccessContactContext.Provider value={accessContact}>
        <AuthNotice kind={authError} onSignOut={signOut} />
      </AccessContactContext.Provider>
    );
  }

  if (!value) {
    return (
      <AccessContactContext.Provider value={accessContact}>
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
      </AccessContactContext.Provider>
    );
  }

  return (
    <AccessContactContext.Provider value={accessContact}>
      <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
    </AccessContactContext.Provider>
  );
}

const NOTICE_BTN: React.CSSProperties = {
  display: "inline-block",
  padding: "8px 20px",
  borderRadius: 6,
  border: "1px solid #334155",
  background: "#1e293b",
  color: "#e2e8f0",
  fontSize: 13,
  fontFamily: "system-ui, sans-serif",
  cursor: "pointer",
  textDecoration: "none",
};

const NOTICE_BTN_PRIMARY: React.CSSProperties = {
  ...NOTICE_BTN,
  background: "#3b82f6",
  border: "1px solid #2563eb",
  color: "#fff",
};

const REQUEST_ACCESS_SUBJECT = "Request access to Orbit";
const REQUEST_ACCESS_BODY =
  "Hi,\n\nI successfully signed in with my Microsoft account but do not have access to Orbit.\n\nPlease add me to the Orbit-Authorized-Users group.\n\nThanks";
export const ORBIT_ACCESS_EMAIL = "orbit-access@kinisislabs.com";

function DeniedNotice({ onSignOut }: { onSignOut: () => void }) {
  const accessContact = useContext(AccessContactContext);
  const mailtoHref = `mailto:${accessContact}?subject=${encodeURIComponent(REQUEST_ACCESS_SUBJECT)}&body=${encodeURIComponent(REQUEST_ACCESS_BODY)}`;
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
      <div style={{ maxWidth: 480, textAlign: "center" }}>
        <div
          style={{
            width: 52,
            height: 52,
            borderRadius: "50%",
            background: "#1e293b",
            border: "1px solid #334155",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            margin: "0 auto 20px",
          }}
        >
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#94a3b8"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </div>
        <div style={{ fontSize: 20, fontWeight: 600, marginBottom: 10 }}>
          Access not granted
        </div>
        <p
          style={{
            fontSize: 14,
            color: "#94a3b8",
            marginBottom: 6,
            lineHeight: 1.6,
          }}
        >
          You signed in successfully with your Microsoft account, but your
          account hasn't been added to the{" "}
          <span
            style={{
              fontFamily: "monospace",
              background: "#1e293b",
              padding: "1px 5px",
              borderRadius: 3,
              color: "#cbd5e1",
              fontSize: 12,
            }}
          >
            Orbit-Authorized-Users
          </span>{" "}
          group yet.
        </p>
        <p
          style={{
            fontSize: 14,
            color: "#64748b",
            marginBottom: 28,
            lineHeight: 1.6,
          }}
        >
          Ask a Kinisis administrator to grant you access, or use the button
          below to send a request.
        </p>
        <div
          style={{
            display: "flex",
            gap: 10,
            justifyContent: "center",
            flexWrap: "wrap",
          }}
        >
          <a href={mailtoHref} style={NOTICE_BTN_PRIMARY}>
            Request access
          </a>
          <button type="button" style={NOTICE_BTN} onClick={onSignOut}>
            Sign out
          </button>
        </div>
        <p
          style={{
            marginTop: 24,
            fontSize: 12,
            color: "#475569",
            lineHeight: 1.5,
          }}
        >
          Once access is granted, sign back in with the same Microsoft account.
          If you believe this is a mistake, contact{" "}
          <a
            href={`mailto:${accessContact}`}
            style={{ color: "#60a5fa", textDecoration: "none" }}
          >
            {accessContact}
          </a>
          .
        </p>
      </div>
    </div>
  );
}

function RevokedNotice() {
  const returnTo = window.location.pathname + window.location.search;
  const loginHref = `${AUTH_LOGIN}?returnTo=${encodeURIComponent(returnTo)}`;
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
        <div
          style={{
            width: 52,
            height: 52,
            borderRadius: "50%",
            background: "#1e293b",
            border: "1px solid #334155",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            margin: "0 auto 20px",
          }}
        >
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#94a3b8"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </div>
        <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>
          Session ended
        </div>
        <p
          style={{
            fontSize: 14,
            color: "#94a3b8",
            marginBottom: 20,
            lineHeight: 1.5,
          }}
        >
          Your session is no longer active. Sign in again to continue.
        </p>
        <a href={loginHref} style={NOTICE_BTN_PRIMARY}>
          Sign in again
        </a>
      </div>
    </div>
  );
}

function AuthNotice({
  kind,
  onSignOut,
}: {
  kind: AuthError;
  onSignOut: () => void;
}) {
  if (kind === "denied") {
    return <DeniedNotice onSignOut={onSignOut} />;
  }
  if (kind === "revoked") {
    return <RevokedNotice />;
  }
  const unavailable = kind === "unavailable";
  const title = unavailable
    ? "Orbit is temporarily unavailable"
    : "Sign-in could not be completed";
  const body = unavailable
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
        <a href={AUTH_LOGIN} style={NOTICE_BTN}>
          Try again
        </a>
      </div>
    </div>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
