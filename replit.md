# Orbit Command Center

The Kinisis admin center — an Azure operations dashboard giving operators a unified view of every Kinisis application's health, alerts, telemetry, and cost. (Previously branded "Kinisis Orbit"; internal slugs `gaac`/`GAAC-*` and the architecture spec retain the prior name.)

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

- `docs/architecture-spec.md` — Architecture spec v3 (Orbit Command Center). Source of truth for naming conventions (subscriptions, RGs, tags), Azure deployment topology, RBAC groups, the FinOps cost boundary, and the Clerk Organizations / user-activity pipeline.
- `lib/api-spec/` — OpenAPI contract. Run `pnpm --filter @workspace/api-spec run codegen` after changes.
- `artifacts/api-server/src/routes/gaac.ts` — All mock data (apps, telemetry, cost, alerts, revenue).
- `artifacts/gaac/src/lib/auth.tsx` — Mock Entra auth + `COST_READER_GROUP` definition.
- `artifacts/gaac/src/lib/scope.tsx` — Scope selector (Global vs per-app).

## Architecture decisions

_Populate as you build — non-obvious choices a reader couldn't infer from the code (3-5 bullets)._

## Product

_Describe the high-level user-facing capabilities of this app once they exist._

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
