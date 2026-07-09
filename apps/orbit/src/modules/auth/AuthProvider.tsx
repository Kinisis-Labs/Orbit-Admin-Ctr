import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  AccessContactContext,
  AuthContext,
  type AuthContextValue,
  type AuthMode,
} from "./auth-context";
import type { EntraGroup, EntraUser } from "./auth-types";

export type { EntraGroup, EntraUser } from "./auth-types";

const AUTH_ME = "/api/auth/me";
const AUTH_LOGIN = "/api/auth/login";
const AUTH_LOGOUT = "/api/auth/logout";

export const ORBIT_ACCESS_EMAIL = "support@kinisislabs.com";

type MeResponse =
  | { mode: "entra"; authenticated: false; accessContact?: string }
  | { mode: "entra"; authenticated: true; user: EntraUser; groups: EntraGroup[]; accessContact?: string };

type AuthError = "denied" | "error" | "expired" | "unavailable" | "revoked";

function parseAuthError(): AuthError | null {
  const v = new URLSearchParams(window.location.search).get("auth");
  return v === "denied" || v === "error" || v === "expired" || v === "revoked" ? v : null;
}

const NOTICE_BTN: React.CSSProperties = {
  display: "inline-block",
  padding: "8px 20px",
  borderRadius: 6,
  border: "1px solid #334155",
  background: "#1e293b",
  color: "#e2e8f0",
  fontSize: 13,
  fontFamily: "var(--app-font-sans, system-ui, sans-serif)",
  cursor: "pointer",
  textDecoration: "none",
};

const NOTICE_BTN_PRIMARY: React.CSSProperties = {
  ...NOTICE_BTN,
  background: "linear-gradient(135deg, #7C3AED, #4361EE)",
  border: "1px solid #6D28D9",
  color: "#fff",
};

const LOADING_SCREEN: React.CSSProperties = {
  minHeight: "100vh",
  display: "grid",
  placeItems: "center",
  background: "#0B1120",
  color: "#9CA3AF",
  fontFamily: "var(--app-font-sans, system-ui, sans-serif)",
  fontSize: 14,
};

function DeniedNotice({ onSignOut }: { onSignOut: () => void }) {
  const accessContact = useContext(AccessContactContext);
  const REQUEST_SUBJECT = "Request access to Orbit";
  const REQUEST_BODY =
    "Hi,\n\nI successfully signed in with my Microsoft account but do not have access to Orbit.\n\nPlease add me to the Orbit-Authorized-Users group.\n\nThanks";
  const mailtoHref = `mailto:${accessContact}?subject=${encodeURIComponent(REQUEST_SUBJECT)}&body=${encodeURIComponent(REQUEST_BODY)}`;
  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#0B1120", color: "#E5E7EB", fontFamily: "var(--app-font-sans, system-ui, sans-serif)", padding: 24 }}>
      <div style={{ maxWidth: 480, textAlign: "center" }}>
        <div style={{ width: 52, height: 52, borderRadius: "50%", background: "#1e293b", border: "1px solid #334155", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px" }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </div>
        <div style={{ fontSize: 20, fontWeight: 600, marginBottom: 10 }}>Access not granted</div>
        <p style={{ fontSize: 14, color: "#9CA3AF", marginBottom: 6, lineHeight: 1.6 }}>
          You signed in successfully with your Microsoft account, but your account hasn't been added to the{" "}
          <span style={{ fontFamily: "monospace", background: "#1e293b", padding: "1px 5px", borderRadius: 3, color: "#CBD5E1", fontSize: 12 }}>
            Orbit-Authorized-Users
          </span>{" "}
          group yet.
        </p>
        <p style={{ fontSize: 14, color: "#6B7280", marginBottom: 28, lineHeight: 1.6 }}>
          Ask a Kinisis administrator to grant you access, or use the button below to send a request.
        </p>
        <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
          <a href={mailtoHref} style={NOTICE_BTN_PRIMARY}>Request access</a>
          <button type="button" style={NOTICE_BTN} onClick={onSignOut}>Sign out</button>
        </div>
        <p style={{ marginTop: 24, fontSize: 12, color: "#475569", lineHeight: 1.5 }}>
          Once access is granted, sign back in with the same Microsoft account. If you believe this is a mistake, contact{" "}
          <a href={`mailto:${accessContact}`} style={{ color: "#818CF8", textDecoration: "none" }}>{accessContact}</a>.
        </p>
      </div>
    </div>
  );
}

function RevokedNotice() {
  const returnTo = window.location.pathname + window.location.search;
  const loginHref = `${AUTH_LOGIN}?returnTo=${encodeURIComponent(returnTo)}`;
  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#0B1120", color: "#E5E7EB", fontFamily: "var(--app-font-sans, system-ui, sans-serif)", padding: 24 }}>
      <div style={{ maxWidth: 440, textAlign: "center" }}>
        <div style={{ width: 52, height: 52, borderRadius: "50%", background: "#1e293b", border: "1px solid #334155", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px" }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </div>
        <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>Session ended</div>
        <p style={{ fontSize: 14, color: "#9CA3AF", marginBottom: 20, lineHeight: 1.5 }}>
          Your session is no longer active. Sign in again to continue.
        </p>
        <a href={loginHref} style={NOTICE_BTN_PRIMARY}>Sign in again</a>
      </div>
    </div>
  );
}

function ErrorNotice({ kind }: { kind: "error" | "expired" | "unavailable" }) {
  const unavailable = kind === "unavailable";
  const title = unavailable ? "Orbit is temporarily unavailable" : "Sign-in could not be completed";
  const body = unavailable
    ? "Could not reach the Orbit API. Check that the service is running and try again."
    : "Something went wrong while signing you in. Please try again.";
  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#0B1120", color: "#E5E7EB", fontFamily: "var(--app-font-sans, system-ui, sans-serif)", padding: 24 }}>
      <div style={{ maxWidth: 440, textAlign: "center" }}>
        <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>{title}</div>
        <p style={{ fontSize: 14, color: "#9CA3AF", marginBottom: 20, lineHeight: 1.5 }}>{body}</p>
        <a href={AUTH_LOGIN} style={NOTICE_BTN}>Try again</a>
      </div>
    </div>
  );
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<AuthMode | null>(null);
  const [entra, setEntra] = useState<{ user: EntraUser; groups: EntraGroup[] } | null>(null);
  const entraRef = useRef(entra);
  useEffect(() => { entraRef.current = entra; }, [entra]);
  const [authError, setAuthError] = useState<AuthError | null>(null);
  const [accessContact, setAccessContact] = useState<string>(ORBIT_ACCESS_EMAIL);

  useEffect(() => {
    let cancelled = false;
    const postCallbackError = parseAuthError();
    (async () => {
      try {
        const res = await fetch(AUTH_ME, { credentials: "same-origin", headers: { accept: "application/json" } });
        if (res.status === 401 || res.status === 503) {
          if (cancelled) return;
          try {
            const body = (await res.clone().json()) as MeResponse;
            if ("accessContact" in body && body.accessContact) setAccessContact(body.accessContact);
          } catch { /* ignore */ }
          if (postCallbackError) { setAuthError(postCallbackError); setMode("entra"); return; }
          const returnTo = window.location.pathname + window.location.search;
          window.location.assign(`${AUTH_LOGIN}?returnTo=${encodeURIComponent(returnTo)}`);
          return;
        }
        const data = (await res.json()) as MeResponse;
        if (cancelled) return;
        if ("accessContact" in data && data.accessContact) setAccessContact(data.accessContact);
        if (data.mode === "entra" && "authenticated" in data && data.authenticated) {
          setEntra({ user: data.user, groups: data.groups });
          setMode("entra");
        } else {
          if (postCallbackError) { setAuthError(postCallbackError); setMode("entra"); return; }
          const returnTo = window.location.pathname + window.location.search;
          window.location.assign(`${AUTH_LOGIN}?returnTo=${encodeURIComponent(returnTo)}`);
        }
      } catch {
        if (!cancelled) setAuthError("unavailable");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (mode !== "entra") return;
    const POLL_MS = 15 * 60 * 1000;
    const poll = async () => {
      if (document.visibilityState === "hidden") return;
      try {
        const res = await fetch(AUTH_ME, { credentials: "same-origin", headers: { accept: "application/json" } });
        if (res.status === 401 || res.status === 403) { setAuthError("revoked"); return; }
        if (!res.ok) return;
        const data = (await res.json()) as MeResponse;
        if (data.mode === "entra" && "authenticated" in data) {
          if (data.authenticated) {
            const prevIds = new Set((entraRef.current?.groups ?? []).map((g) => g.id));
            const newIds = new Set(data.groups.map((g) => g.id));
            const changed = prevIds.size !== newIds.size || [...newIds].some((id) => !prevIds.has(id));
            setEntra({ user: data.user, groups: data.groups });
            if (changed) console.info("[Orbit] Access groups updated");
          } else {
            setAuthError("revoked");
          }
        }
      } catch { /* transient — retry next interval */ }
    };
    const id = setInterval(() => void poll(), POLL_MS);
    return () => clearInterval(id);
  }, [mode]);

  const signOut = useCallback(() => {
    void (async () => {
      try {
        const res = await fetch(AUTH_LOGOUT, { method: "POST", credentials: "same-origin", headers: { accept: "application/json" } });
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
    return { user: entra.user, groups: entra.groups, hasGroup: (id: string) => ids.has(id), mode: "entra", signOut, accessContact };
  }, [mode, entra, signOut, accessContact]);

  if (authError) {
    return (
      <AccessContactContext.Provider value={accessContact}>
        {authError === "denied" && <DeniedNotice onSignOut={signOut} />}
        {authError === "revoked" && <RevokedNotice />}
        {(authError === "error" || authError === "expired" || authError === "unavailable") && (
          <ErrorNotice kind={authError} />
        )}
      </AccessContactContext.Provider>
    );
  }

  if (!value) {
    return (
      <AccessContactContext.Provider value={accessContact}>
        <div style={LOADING_SCREEN}>Signing in…</div>
      </AccessContactContext.Provider>
    );
  }

  return (
    <AccessContactContext.Provider value={accessContact}>
      <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
    </AccessContactContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
