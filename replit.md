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
- `artifacts/api-server/src/routes/orbit.ts` — All mock data (apps, telemetry, cost, alerts, revenue); the `APPS` inventory with the `userAuth: "clerk" | "entra"` flag + `clerkApps()`, and the optional `androidPackage` flag + `playApps()` (apps tracked in Google Play).
- `artifacts/api-server/src/lib/clerkActivity.ts` — Clerk webhook ingestion + anonymous activity rollups (DAU/WAU/MAU/new-7d); per-app signing-secret resolution.
- `artifacts/api-server/src/routes/clerkWebhook.ts` — `POST /api/webhooks/clerk/:appId` (raw-body Svix verify); mounted in `app.ts` **before** `express.json()`.
- `artifacts/api-server/src/routes/users.ts` — `GET /api/users/activity` (counts only, no PII).
- `artifacts/api-server/src/lib/playSubscriptions.ts` — Google Play subscription metrics per tracked Android app (active/canceled/expired subscribers + MRR/revenue); `isPlayConfigured()` config-gate, deterministic placeholder generator, and a dormant `fetchLivePlaySubscriptions()` real-ingestion seam.
- `artifacts/api-server/src/routes/playSubscriptions.ts` — `GET /api/play/subscriptions` (requireAuth; parses through `ListPlaySubscriptionsResponse`).
- `artifacts/orbit/src/pages/play-subscriptions.tsx` — Play subscriptions page (financial surface, gated by `Orbit-Cost-Readers`, scope-aware via `useScope()`).
- `lib/db/src/schema/clerk.ts` — `app_users`, `clerk_events`, `clerk_activity_daily` (anonymous, opaque id + timestamps only).
- `scripts/src/seed-clerk-activity.ts` — dev seed for anonymous activity (`pnpm --filter @workspace/scripts run seed-clerk-activity`).
- `artifacts/orbit/src/lib/auth.tsx` — Frontend auth provider: fetches `/api/auth/me`, real Entra sign-in or mock fallback, `COST_READER_GROUP` definition.
- `artifacts/orbit/src/lib/scope.tsx` — Scope selector (Global vs per-app).
- `artifacts/api-server/src/lib/entra.ts` — Entra OIDC config + cached discovery (`isEntraConfigured()` decides Entra vs mock mode).
- `artifacts/api-server/src/lib/session.ts` — express-session + connect-pg-simple Postgres session store.
- `artifacts/api-server/src/middlewares/auth.ts` — `requireAuth` / `requireCostReader` (no-ops in mock/dev mode).
- `artifacts/api-server/src/routes/auth.ts` — `/api/auth/me`, `/login`, `/callback`, `/logout` (auth code + PKCE).

## Architecture decisions

- **Audience: internal staff only.** Hosted at `orbit.kinisislabs.com` (subdomain of the primary public domain). No public sign-up, no SEO surface — all routes assume an authenticated Kinisis staff member. Auth gating is via Microsoft Entra ID group membership (`Orbit-Authorized-Users`); the `Orbit-Cost-Readers` group further gates FinOps surfaces.
- **Two identity planes: Entra for staff, Clerk for consumer end users.** *Orbit itself* and other internal employee tools authenticate Kinisis staff via the single corporate **Entra ID** tenant (one **app registration** per `{app, environment}`; RBAC via the `Orbit-*` groups). The tracked **consumer apps** (e.g. GrailBabe prod/dev) are customer-facing and authenticate their **end users via Clerk** — one Clerk instance per app/environment. **Entra never authenticates consumer end users, and Clerk never authenticates Orbit.** The *Users & activity* counts come from **Clerk webhooks**: each Clerk instance posts to `/api/webhooks/clerk/:appId` (Svix-signature-verified with a per-app signing secret `CLERK_WEBHOOK_SECRET__<APPID>`), and Orbit stores only **anonymous aggregate rollups** — an opaque Clerk user id + timestamps, never emails or names. Microsoft Graph remains relevant only for staff/RBAC group membership.
- **Google Play subscriptions are config-gated, placeholder until live.** The *Play subscriptions* surface (`/play-subscriptions`, gated by `Orbit-Cost-Readers`) reports subscription financials (MRR, trailing-30d revenue) and subscriber states (active / canceled / expired) for the tracked Android apps (apps with an `androidPackage` in the `APPS` inventory; GrailBabe prod/dev today). GrailBabe is in Play **testing, not live**, so there is no real feed yet and the surface serves deterministic placeholder data. The real connection is dormant and **auto-activates** when configured (mirrors the Entra pattern): `getPlaySubscriptions()` calls the live seam only when `isPlayConfigured()` is true, otherwise it falls back to placeholders. **Org policy blocks downloadable JSON service-account keys**, so the real path is **keyless Workload Identity Federation** (same philosophy as Orbit's Azure managed identity) to the **Android Publisher API** (subscriber states, RTDN-backed) + **Play earnings reports** (revenue) — deferred until launch. Config gate env (all required to go live, deferred): `GOOGLE_PLAY_SA_EMAIL`, `GOOGLE_PLAY_WIF_AUDIENCE`, `GOOGLE_PLAY_DEVELOPER_ID`.
- **Cookie domain when real auth lands:** scope session cookies to `.kinisislabs.com` so the same session can be shared with other internal subdomains (id.kinisislabs.com, etc.). `SameSite=Lax; Secure; HttpOnly`.
- **Deploy target:** Azure (Static Web Apps + Container Apps + PostgreSQL Flexible Server) behind the shared Front Door `afd-shared-prod` at `orbit.kinisislabs.com`. See **Deployment (Azure production)** below for the full topology, resources, and CI workflows.

## Deployment (Azure production)

Hosted on Azure in `rg-orbit-prod-eus2` (region East US 2), fronted by the shared Front Door `afd-shared-prod` at `https://orbit.kinisislabs.com`. The Replit environment remains the dev/iteration environment; production is Azure. Orbit runs a **single production environment** only — there is no separate Azure nonprod/dev (internal staff tool).

- **Frontend** (`artifacts/orbit`) → Azure Static Web App `swa-orbit-prod`. Built/deployed by `.github/workflows/azure-static-web-apps.yml` (builds the pnpm monorepo, uploads with `skip_app_build`). SPA routing via `artifacts/orbit/public/staticwebapp.config.json`. Requires repo secret `AZURE_STATIC_WEB_APPS_API_TOKEN`.
- **API** (`artifacts/api-server`) → Azure Container App `ca-orbit-api-prod` (env `cae-orbit-prod-eus2`). Containerized via `artifacts/api-server/Dockerfile`; **set the Container App ingress targetPort to `8080`**. Built/deployed by `.github/workflows/deploy-api-container.yml` (image → GHCR by default). Dormant until the Entra app registration + GitHub OIDC creds exist (`AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`).
- **Database** → Azure Database for PostgreSQL Flexible Server `pg-orbit-prod`, database `orbit`. **Set `DATABASE_SSL=true`** on the Container App (TLS required). Connection string stored in `kv-shared-prod`. Apply schema with `pnpm --filter @workspace/db run push` against the Azure `DATABASE_URL`.
- **Routing:** Front Door `orbit.kinisislabs.com` → `/*` to the frontend origin group (SWA), `/api/*` to the API origin group (Container App). Because both share the host, the frontend's relative `/api` calls work with no base-URL change.
- **Identity for Azure data:** the API authenticates to Azure (Resource Graph, Monitor, Cost Management, Microsoft Graph, Key Vault, App Configuration) via the user-assigned managed identity `id-orbit-api-prod` — use `DefaultAzureCredential`, **no client secret**. (Integration code deferred; dashboard data is still mock.)
- **Also provisioned:** App Configuration `appcs-orbit-prod-eus2` (`APP_CONFIGURATION_ENDPOINT`) and Application Insights `appi-oribit-prod` (resource name is misspelled "oribit"; `APPLICATIONINSIGHTS_CONNECTION_STRING`) — SDK wiring not built yet. A GitHub-OIDC federated managed identity (`…rg-orbit-prod-eus2Oidc`) also exists for the deploy workflow.
- **Prod resource names (confirmed from Azure portal, June 2026):** SWA `swa-orbit-prod`, Container App `ca-orbit-api-prod`, Container Apps Env `cae-orbit-prod-eus2`, Postgres `pg-orbit-prod`, App Config `appcs-orbit-prod-eus2`, App Insights `appi-oribit-prod` (sic), API managed identity `id-orbit-api-prod`. Naming is inconsistent — several resources omit the `-eus2` suffix, the SWA uses `swa-` (not `stapp-`), and App Insights is misspelled. Shared/other resources (Front Door, Key Vault, ACR, Log Analytics, Storage, RG) were not in the portal listing and remain as specified above (unconfirmed).

**Pending on the Azure side:** Front Door routes + custom domain. Real Azure *data* integrations (Resource Graph, Monitor, Cost Management, Graph) are not yet built — the dashboard still serves mock data plus the live Stripe-backed ledger.

### Authentication (Entra ID) — built, config-gated

Real Microsoft Entra ID sign-in (OpenID Connect, auth code + PKCE) is implemented. It activates only when **all** of these are present; otherwise the app runs in **mock mode** (open data routes, simulated user) so the Replit dev preview keeps working. In production the API **fails closed**: it refuses to start if Entra is not fully configured.

Required env (shared, same in dev & prod): `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`, `ENTRA_AUTHORIZED_GROUP_ID` (Orbit-Authorized-Users object id), `ENTRA_COST_READER_GROUP_ID` (Orbit-Cost-Readers object id). Secret: `ENTRA_CLIENT_SECRET`. Per-environment: `ENTRA_REDIRECT_URI` (dev = `https://<replit-dev-domain>/api/auth/callback`, prod = `https://orbit.kinisislabs.com/api/auth/callback`). Optional: `ENTRA_SCOPES`, `ENTRA_POST_LOGOUT_REDIRECT_URI`. `SESSION_SECRET` is required in production (already set).

Optional RBAC group env (shared, GUID object ids — only resolve membership when set): `ENTRA_ADMIN_GROUP_ID` (Orbit-Admins), `ENTRA_ENGINEER_GROUP_ID` (Orbit-Engineers), `ENTRA_FINOPS_GROUP_ID` (Orbit-FinOps). All five Orbit-* groups are resolved in `routes/auth.ts` (`resolveOrbitGroups`) and surfaced to the frontend via `/api/auth/me` so `hasGroup()` and the Access page reflect real membership in Entra mode. These three are membership-aware only — no API route is gated on them yet (only `Orbit-Authorized-Users` baseline + `Orbit-Cost-Readers` FinOps gate are enforced).

Entra app registration checklist: register both the dev and prod redirect URIs (Web platform), enable the **groups claim** (Token configuration → add groups claim → Security groups, for ID tokens), and create a client secret. The groups claim emits group **object IDs** (GUIDs) — every `ENTRA_*_GROUP_ID` must be those GUIDs.

## Product

_Describe the high-level user-facing capabilities of this app once they exist._

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- **Session table is schema-owned, not auto-created.** The API ships as a single esbuild bundle (no `node_modules` at runtime), so `connect-pg-simple`'s `createTableIfMissing` can't find its `table.sql` (ENOENT) — symptom is sign-in failing at the OAuth callback ("Sign-in could not be completed"). The `user_sessions` table lives in `lib/db/src/schema/session.ts` and is provisioned by `pnpm --filter @workspace/db run push`; `createTableIfMissing` is `false`. Run a `db push` against any new environment's database (incl. Azure prod) before sign-in will work.
- **`ENTRA_TENANT_ID` must be the bare tenant GUID** — no `ID ` prefix or stray whitespace. A malformed value makes OIDC discovery build an invalid `login.microsoftonline.com/<tenant>/v2.0` URL and the whole app 500s on every auth route.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
