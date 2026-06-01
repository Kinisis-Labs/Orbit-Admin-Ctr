# Orbit

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

- `docs/architecture-spec.md` — Architecture spec v3 (Orbit). Source of truth for naming conventions (subscriptions, RGs, tags), Azure deployment topology, RBAC groups, the FinOps cost boundary, and the corporate Entra sign-in / user-activity pipeline.
- `docs/requirements.md` — Requirements spec v1.0. Functional (FR-*) + non-functional (NFR-*) requirements, personas, acceptance criteria, release phases.
- `lib/api-spec/` — OpenAPI contract. Run `pnpm --filter @workspace/api-spec run codegen` after changes.
- `artifacts/api-server/src/routes/orbit.ts` — All mock data (apps, telemetry, cost, alerts, revenue).
- `artifacts/orbit/src/lib/auth.tsx` — Frontend auth provider: fetches `/api/auth/me`, real Entra sign-in or mock fallback, `COST_READER_GROUP` definition.
- `artifacts/orbit/src/lib/scope.tsx` — Scope selector (Global vs per-app).
- `artifacts/api-server/src/lib/entra.ts` — Entra OIDC config + cached discovery (`isEntraConfigured()` decides Entra vs mock mode).
- `artifacts/api-server/src/lib/session.ts` — express-session + connect-pg-simple Postgres session store.
- `artifacts/api-server/src/middlewares/auth.ts` — `requireAuth` / `requireCostReader` (no-ops in mock/dev mode).
- `artifacts/api-server/src/routes/auth.ts` — `/api/auth/me`, `/login`, `/callback`, `/logout` (auth code + PKCE).

## Architecture decisions

- **Audience: internal staff only.** Hosted at `orbit.kinisislabs.com` (subdomain of the primary public domain). No public sign-up, no SEO surface — all routes assume an authenticated Kinisis staff member. Auth gating is via Microsoft Entra ID group membership (`Orbit-Authorized-Users`); the `Orbit-Cost-Readers` group further gates FinOps surfaces.
- **Single corporate Entra tenant, internal-only end-to-end.** Both Orbit *and* every tracked Kinisis app (GrailBabe, Kinisis ID, Ops Portal, Ledger API, Atlas CMS, etc.) are internal Kinisis employee tools — no customer-facing surfaces anywhere in the platform. Sign-in for every app goes through the same corporate Entra tenant, with one **app registration** per `{app, environment}` and a backing security group `<app>-<env>-users` as the engagement source-of-truth. No External ID / CIAM tenant — **Entra ID is the sole authentication provider** (employee-only app). **Clerk is read-only activity/engagement information only**: it ingests session/user events (e.g. via a webhook at `/api/webhooks/clerk`, not yet built) and is *never* used to authenticate access to Orbit. Most of what Orbit reads about users is via **Microsoft Graph**.
- **Cookie domain when real auth lands:** scope session cookies to `.kinisislabs.com` so the same session can be shared with other internal subdomains (id.kinisislabs.com, etc.). `SameSite=Lax; Secure; HttpOnly`.
- **Deploy target:** Azure (Static Web Apps + Container Apps + PostgreSQL Flexible Server) behind the shared Front Door `afd-shared-prod` at `orbit.kinisislabs.com`. See **Deployment (Azure production)** below for the full topology, resources, and CI workflows.

## Deployment (Azure production)

Hosted on Azure in `rg-orbit-prod-eus2` (region East US 2), fronted by the shared Front Door `afd-shared-prod` at `https://orbit.kinisislabs.com`. The Replit environment remains the dev/iteration environment; production is Azure.

- **Frontend** (`artifacts/orbit`) → Azure Static Web App `stapp-orbit-prod-eus2`. Built/deployed by `.github/workflows/azure-static-web-apps.yml` (builds the pnpm monorepo, uploads with `skip_app_build`). SPA routing via `artifacts/orbit/public/staticwebapp.config.json`. Requires repo secret `AZURE_STATIC_WEB_APPS_API_TOKEN`.
- **API** (`artifacts/api-server`) → Azure Container App `ca-orbit-api-prod-eus2` (env `cae-orbit-prod-eus2`). Containerized via `artifacts/api-server/Dockerfile`; **set the Container App ingress targetPort to `8080`**. Built/deployed by `.github/workflows/deploy-api-container.yml` (image → GHCR by default). Dormant until the Entra app registration + GitHub OIDC creds exist (`AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`).
- **Database** → Azure Database for PostgreSQL Flexible Server `psql-orbit-prod-eus2`, database `orbit`. **Set `DATABASE_SSL=true`** on the Container App (TLS required). Connection string stored in `kv-shared-prod`. Apply schema with `pnpm --filter @workspace/db run push` against the Azure `DATABASE_URL`.
- **Routing:** Front Door `orbit.kinisislabs.com` → `/*` to the frontend origin group (SWA), `/api/*` to the API origin group (Container App). Because both share the host, the frontend's relative `/api` calls work with no base-URL change.
- **Identity for Azure data:** the API authenticates to Azure (Resource Graph, Monitor, Cost Management, Microsoft Graph, Key Vault, App Configuration) via the user-assigned managed identity `id-orbit-api-prod-eus2` — use `DefaultAzureCredential`, **no client secret**. (Integration code deferred; dashboard data is still mock.)
- **Also provisioned:** App Configuration `appcs-orbit-prod-eus2` (`APP_CONFIGURATION_ENDPOINT`) and Application Insights `appi-orbit-prod-eus2` (`APPLICATIONINSIGHTS_CONNECTION_STRING`) — SDK wiring not built yet.

**Pending on the Azure side:** Front Door routes + custom domain. Real Azure *data* integrations (Resource Graph, Monitor, Cost Management, Graph) are not yet built — the dashboard still serves mock data plus the live Stripe-backed ledger.

### Authentication (Entra ID) — built, config-gated

Real Microsoft Entra ID sign-in (OpenID Connect, auth code + PKCE) is implemented. It activates only when **all** of these are present; otherwise the app runs in **mock mode** (open data routes, simulated user) so the Replit dev preview keeps working. In production the API **fails closed**: it refuses to start if Entra is not fully configured.

Required env (shared, same in dev & prod): `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`, `ENTRA_AUTHORIZED_GROUP_ID` (Orbit-Authorized-Users object id), `ENTRA_COST_READER_GROUP_ID` (Orbit-Cost-Readers object id). Secret: `ENTRA_CLIENT_SECRET`. Per-environment: `ENTRA_REDIRECT_URI` (dev = `https://<replit-dev-domain>/api/auth/callback`, prod = `https://orbit.kinisislabs.com/api/auth/callback`). Optional: `ENTRA_SCOPES`, `ENTRA_POST_LOGOUT_REDIRECT_URI`. `SESSION_SECRET` is required in production (already set).

Entra app registration checklist: register both the dev and prod redirect URIs (Web platform), enable the **groups claim** (Token configuration → add groups claim → Security groups, for ID tokens), and create a client secret. The groups claim emits group **object IDs** (GUIDs) — `ENTRA_AUTHORIZED_GROUP_ID` / `ENTRA_COST_READER_GROUP_ID` must be those GUIDs.

## Product

_Describe the high-level user-facing capabilities of this app once they exist._

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
