# Orbit Command Center

The Kinisis admin center — an Azure operations dashboard giving operators a unified view of every Kinisis application's health, alerts, telemetry, and cost. (Previously branded "Kinisis Orbit" / "GAAC".)

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `docs/architecture-spec.md` — Architecture spec v3 (Orbit Command Center). Source of truth for naming conventions (subscriptions, RGs, tags), Azure deployment topology, RBAC groups, the FinOps cost boundary, and the corporate Entra sign-in / user-activity pipeline.
- `docs/requirements.md` — Requirements spec v1.0. Functional (FR-*) + non-functional (NFR-*) requirements, personas, acceptance criteria, release phases.
- `lib/api-spec/` — OpenAPI contract. Run `pnpm --filter @workspace/api-spec run codegen` after changes.
- `artifacts/api-server/src/routes/orbit.ts` — All mock data (apps, telemetry, cost, alerts, revenue).
- `artifacts/orbit/src/lib/auth.tsx` — Mock Entra auth + `COST_READER_GROUP` definition.
- `artifacts/orbit/src/lib/scope.tsx` — Scope selector (Global vs per-app).

## Architecture decisions

- **Audience: internal staff only.** Hosted at `orbit.kinisislabs.com` (subdomain of the primary public domain). No public sign-up, no SEO surface — all routes assume an authenticated Kinisis staff member. Auth gating is via Microsoft Entra ID group membership (`Orbit-Authorized-Users`); the `Orbit-Cost-Readers` group further gates FinOps surfaces.
- **Single corporate Entra tenant, internal-only end-to-end.** Both Orbit *and* every tracked Kinisis app (GrailBabe, Kinisis ID, Ops Portal, Ledger API, Atlas CMS, etc.) are internal Kinisis employee tools — no customer-facing surfaces anywhere in the platform. Sign-in for every app goes through the same corporate Entra tenant, with one **app registration** per `{app, environment}` and a backing security group `<app>-<env>-users` as the engagement source-of-truth. No External ID / CIAM tenant, no third-party IdP (no Clerk, no Auth0). Everything Orbit reads about users is via **Microsoft Graph**.
- **Cookie domain when real auth lands:** scope session cookies to `.kinisislabs.com` so the same session can be shared with other internal subdomains (id.kinisislabs.com, etc.). `SameSite=Lax; Secure; HttpOnly`.
- **Deploy target:** Replit Deployment with `orbit.kinisislabs.com` added as a custom domain in the Deployments UI (CNAME at the DNS provider, TLS auto-provisioned). Optionally fronted by Cloudflare Access / Entra App Proxy for an extra network-layer gate — no code change needed.

## Product

_Describe the high-level user-facing capabilities of this app once they exist._

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
