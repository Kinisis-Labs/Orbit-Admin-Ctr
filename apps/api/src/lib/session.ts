import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import type { RequestHandler } from "express";

export interface SessionUser {
  id: string;
  displayName: string;
  userPrincipalName: string;
  jobTitle: string;
  groupIds: string[];
  isCostReader: boolean;
  isAdmin: boolean;
  isEngineer: boolean;
  accessToken?: string;
  tokenExpiresAt?: number;
  refreshToken?: string;
  groupsLastChecked?: number;
  idToken?: string;
}

declare module "express-session" {
  interface SessionData {
    user?: SessionUser;
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

const wantSsl =
  process.env.DATABASE_SSL === "true" ||
  process.env.DATABASE_SSL === "1" ||
  process.env.PGSSLMODE === "require";

const entraActive =
  !!process.env.ENTRA_TENANT_ID &&
  !!process.env.ENTRA_CLIENT_ID &&
  !!process.env.ENTRA_CLIENT_SECRET &&
  !!process.env.ENTRA_REDIRECT_URI;

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
  proxy: true,
  store: buildStore(),
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: isProd,
    maxAge: 1000 * 60 * 60 * 8,
    domain: process.env.SESSION_COOKIE_DOMAIN || undefined,
  },
});
