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

export const sessionMiddleware: RequestHandler = session({
  name: "orbit.sid",
  secret: sessionSecret ?? "dev-insecure-secret-change-me",
  resave: false,
  saveUninitialized: false,
  // Behind Azure Front Door (and the Replit proxy) the app sits behind a TLS
  // terminator, so trust the proxy for secure-cookie handling.
  proxy: true,
  store: new PgSession({
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
  }),
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
