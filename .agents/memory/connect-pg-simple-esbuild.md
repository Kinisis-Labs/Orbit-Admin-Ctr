---
name: connect-pg-simple under esbuild bundle
description: Why the Postgres session table must be schema-owned, not auto-created, in a bundled server.
---

# connect-pg-simple + esbuild bundling

`connect-pg-simple`'s `createTableIfMissing: true` reads a `table.sql` shipped
inside its package, resolved relative to `__dirname`. When the API server is
shipped as a single esbuild bundle (`dist/index.mjs`, no `node_modules` at
runtime), `__dirname` is `dist/`, so it looks for `dist/table.sql`, which
doesn't exist → `ENOENT` → the session table is never created.

**Symptom:** sign-in gets through the IdP redirect but fails at the OAuth
callback with a generic "sign-in could not be completed", and `/auth/me` stays
401. Root cause is that the PKCE/state stored in the session at `/login` is
never persisted (no session table), so the callback can't validate it.

**Fix (durable):** own the session table in the Drizzle schema
(`user_sessions`: `sid varchar pk`, `sess json`, `expire timestamp(6)` + index
on `expire`) so `db push` provisions it in dev and prod, and set
`createTableIfMissing: false`.
**Why:** the bundle will never have `table.sql`; relying on auto-create is
fragile in both dev and the Azure container.
**How to apply:** any bundled (esbuild/no-node_modules) server using
connect-pg-simple — define the table in schema, disable auto-create, and run
`db push` against each environment's database. The column shape must match what
connect-pg-simple expects exactly.
