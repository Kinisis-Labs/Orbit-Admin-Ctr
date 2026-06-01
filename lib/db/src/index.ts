import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

// Azure Database for PostgreSQL (Flexible Server) requires TLS. Enable SSL when
// DATABASE_SSL=true (or PGSSLMODE=require) — the Replit-hosted dev database does
// not use TLS, so SSL stays off there. Azure's server cert chains to a
// publicly-trusted root bundled with Node, so cert validation is on by default;
// set DATABASE_SSL_REJECT_UNAUTHORIZED=false to opt out if needed.
const wantSsl =
  process.env.DATABASE_SSL === "true" ||
  process.env.DATABASE_SSL === "1" ||
  process.env.PGSSLMODE === "require";

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ...(wantSsl
    ? {
        ssl: {
          rejectUnauthorized:
            process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== "false",
        },
      }
    : {}),
});
export const db = drizzle(pool, { schema });

export * from "./schema";
