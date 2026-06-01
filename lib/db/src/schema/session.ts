import { pgTable, varchar, json, timestamp, index } from "drizzle-orm/pg-core";

// express-session store backing table for connect-pg-simple.
//
// connect-pg-simple normally creates this table itself via its bundled
// `table.sql`, but the API server is shipped as a single esbuild bundle (no
// node_modules at runtime), so that file isn't present and auto-create fails.
// We instead own the table here so `db push` provisions it in dev and prod,
// and set `createTableIfMissing: false` in lib/session.ts. The column shape
// (sid / sess / expire) must match what connect-pg-simple expects.
export const userSessionsTable = pgTable(
  "user_sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: json("sess").notNull(),
    expire: timestamp("expire", { precision: 6, withTimezone: false }).notNull(),
  },
  (t) => [index("IDX_user_sessions_expire").on(t.expire)],
);

export type UserSessionRow = typeof userSessionsTable.$inferSelect;
