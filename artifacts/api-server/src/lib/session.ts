import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import type { RequestHandler } from "express";

/**
 * Authenticated user persisted in the session after a successful Entra sign-in.
 */
export interface SessionUser {
  id: string;
  displayName: string;
  userPrincipalName: string;
  jobTitle: string;
  groupIds: string[];
  isCostReader: boolean;
  isAdmin: boolean;
  isEngineer: boolean;
  /**
   * The delegated Graph access token acquired during sign-in (or last refresh).
   * Stored server-side (Postgres session store) only — never sent to the
   * browser. Used to re-fetch group membership at configurable intervals so
   * that badge changes take effect without requiring a full sign-out/sign-in.
   */
  accessToken?: string;
  /**
   * Unix timestamp (ms) at which the current access token expires.
   * Computed as Date.now() + expires_in * 1000 at token issuance/renewal.
   * Used to decide whether a token refresh is needed before a Graph re-check.
   */
  tokenExpiresAt?: number;
  /**
   * The refresh token issued alongside the access token (requires the
   * offline_access scope). Used to silently obtain a fresh access token when
   * the current one is near expiry, so group re-checks keep working throughout
   * the session without forcing a full sign-out.
   */
  refreshToken?: string;
  /**
   * Unix timestamp (ms) of the last Graph group-membership re-check.
   * Populated at sign-in and updated whenever /auth/me triggers a re-check.
   */
  groupsLastChecked?: number;
}

declare module "express-session" {
  interface SessionData {
    user?: SessionUser;
    /** Transient OIDC handshake state, cleared after the callback completes. */
    oidc?: {
      codeVerifier: string;
      state: string;
      nonce: string;
      returnTo: string;
    };
  }
}

const PgSession = connectPgSimple(session);
const isProd = process.env.NODE_ENV === "production";

const sessionSecret = process.env.SESSION_SECRET;
if (isProd && !sessionSecret) {
  throw new Error(
    "SESSION_SECRET must be set in production; refusing to start with an insecure session secret.",
  );
}

// Mirror lib/db's SSL gate so the session store reaches Azure Postgres over TLS
// while staying plain on the Replit dev database.
const wantSsl =
  process.env.DATABASE_SSL === "true" ||
  process.env.DATABASE_SSL === "1" ||
  process.env.PGSSLMODE === "require";

/**
 * True when all four required Entra env vars are present (mirrors isEntraConfigured()
 * without importing from entra.ts to keep this module free of circular deps).
 * When false the app is in mock/dev mode and the session store does not need
 * to be backed by a real database — use MemoryStore so the middleware never
 * errors due to a missing DATABASE_URL or unprovided user_sessions table.
 */
const entraActive =
  !!process.env.ENTRA_TENANT_ID &&
  !!process.env.ENTRA_CLIENT_ID &&
  !!process.env.ENTRA_CLIENT_SECRET &&
  !!process.env.ENTRA_REDIRECT_URI;

/**
 * Build the session store appropriate for the current environment:
 * - Entra configured (production): PgSession backed by DATABASE_URL.
 * - Mock/dev mode: in-memory store that never requires a database.
 *   MemoryStore leaks memory under sustained load, which is irrelevant for the
 *   single-developer Replit preview; it is never selected in production because
 *   Entra is always configured there.
 */
function buildStore(): session.Store {
  if (entraActive && process.env.DATABASE_URL) {
    return new PgSession({
      conObject: {
        connectionString: process.env.DATABASE_URL,
        ssl: wantSsl
          ? {
              rejectUnauthorized:
                process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== "false",
            }
          : undefined,
      },
      tableName: "user_sessions",
      // The table is owned by lib/db's schema and provisioned via `db push`
      // (see lib/db/src/schema/session.ts). connect-pg-simple's auto-create
      // can't run here because the bundled server has no `table.sql` on disk.
      createTableIfMissing: false,
    });
  }
  return new session.MemoryStore();
}

export const sessionMiddleware: RequestHandler = session({
  name: "orbit.sid",
  secret: sessionSecret ?? "dev-insecure-secret-change-me",
  resave: false,
  saveUninitialized: false,
  // Behind Azure Front Door (and the Replit proxy) the app sits behind a TLS
  // terminator, so trust the proxy for secure-cookie handling.
  proxy: true,
  store: buildStore(),
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: isProd,
    maxAge: 1000 * 60 * 60 * 8,
    // In prod, scope to .kinisislabs.com so the session is shared across
    // internal subdomains (set SESSION_COOKIE_DOMAIN=.kinisislabs.com).
    domain: process.env.SESSION_COOKIE_DOMAIN || undefined,
  },
});
