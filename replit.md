# Orbit

The Kinisis admin center — an Azure operations dashboard giving operators a unified view of every Kinisis application's health, alerts, telemetry, and cost. (Previously branded "Orbit Command Center" / "Kinisis Orbit" / "GAAC".)

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages (**always use this, not per-package `typecheck`** — it rebuilds lib declarations first; running a leaf package's `typecheck` in isolation against stale `lib/*/dist/` will produce spurious errors)
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
- `artifacts/api-server/src/routes/orbit.ts` — All mock data (apps, telemetry, cost, alerts, revenue); the `APPS` inventory with the `userAuth: "clerk" | "entra" | "none"` flag + `clerkApps()`, the optional `androidPackage` flag + `playApps()` (apps tracked in Google Play), and the optional `group` field that drives the scope-selector grouping (e.g. the "Platform" section). Launch inventory: GrailBabe (prod, Clerk), Orbit (Entra), and Kinisis Labs (public marketing site `kinisislabs.com`, `userAuth: "none"`, no revenue, grouped under "Platform"). GrailBabe-dev has been removed entirely.
- `artifacts/api-server/src/lib/clerkActivity.ts` — Clerk webhook ingestion + anonymous activity rollups (DAU/WAU/MAU/new-7d); per-app signing-secret resolution.
- `artifacts/api-server/src/routes/clerkWebhook.ts` — `POST /api/webhooks/clerk/:appId` (raw-body Svix verify); mounted in `app.ts` **before** `express.json()`.
- `artifacts/api-server/src/routes/users.ts` — `GET /api/users/activity` (counts only, no PII).
- `artifacts/api-server/src/lib/playSubscriptions.ts` — Google Play subscription metrics per tracked Android app (active/canceled/expired subscribers + MRR/revenue); `isPlayConfigured()` config-gate, deterministic placeholder generator, and a dormant `fetchLivePlaySubscriptions()` real-ingestion seam.
- `artifacts/api-server/src/routes/playSubscriptions.ts` — `GET /api/play/subscriptions` (requireAuth + requireCostReader; parses through `ListPlaySubscriptionsResponse`).
- `artifacts/orbit/src/pages/play-subscriptions.tsx` — Play subscriptions page (financial surface, gated by `Orbit-Cost-Readers`, scope-aware via `useScope()`).
- `artifacts/api-server/src/lib/appleSubscriptions.ts` — Apple App Store subscription metrics per tracked iOS app (active/canceled/expired subscribers + MRR/revenue); `isAppleConfigured()` config-gate, deterministic placeholder generator, and a dormant `fetchLiveAppleSubscriptions()` real-ingestion seam.
- `artifacts/api-server/src/routes/appleSubscriptions.ts` — `GET /api/apple/subscriptions` (requireAuth + requireCostReader; parses through `ListAppleSubscriptionsResponse`).
- `artifacts/orbit/src/pages/apple-subscriptions.tsx` — App Store subscriptions page (financial surface, gated by `Orbit-Cost-Readers`, scope-aware via `useScope()`).
- `lib/db/src/schema/clerk.ts` — `app_users`, `clerk_events`, `clerk_activity_daily` (anonymous, opaque id + timestamps only).
- `scripts/src/seed-clerk-activity.ts` — dev seed for anonymous activity (`pnpm --filter @workspace/scripts run seed-clerk-activity`).
- `artifacts/orbit/src/lib/auth.tsx` — Frontend auth provider: fetches `/api/auth/me`, real Entra sign-in or mock fallback, `COST_READER_GROUP` definition.
- `artifacts/orbit/src/lib/scope.tsx` — Scope selector (Global vs per-app).
- `artifacts/api-server/src/lib/entra.ts` — Entra OIDC config + cached discovery (`isEntraConfigured()` decides Entra vs mock mode).
- `artifacts/api-server/src/lib/session.ts` — express-session + connect-pg-simple Postgres session store.
- `artifacts/api-server/src/middlewares/auth.ts` — `requireAuth` / `requireCostReader` (no-ops in mock/dev mode).
- `artifacts/api-server/src/routes/auth.ts` — `/api/auth/me`, `/login`, `/callback`, `/logout` (auth code + PKCE).
- `artifacts/api-server/src/lib/budgetAlerts.ts` — Budget overrun alert scheduler: polls all apps hourly, sends Teams Adaptive Card and/or SMTP email when forecast > budget. Opt-in via env vars (see below). Cooldown prevents duplicate alerts. Started automatically from `index.ts` after the server is listening.

## Architecture decisions

- **Audience: internal staff only.** Hosted at `orbit.kinisislabs.com` (subdomain of the primary public domain). No public sign-up, no SEO surface — all routes assume an authenticated Kinisis staff member. Auth gating is via Microsoft Entra ID group membership (`Orbit-Authorized-Users`); the `Orbit-Cost-Readers` group further gates FinOps surfaces.
- **Two identity planes: Entra for staff, Clerk for consumer end users.** *Orbit itself* and other internal employee tools authenticate Kinisis staff via the single corporate **Entra ID** tenant (one **app registration** per `{app, environment}`; RBAC via the `Orbit-*` groups). The tracked **consumer apps** (e.g. GrailBabe) are customer-facing and authenticate their **end users via Clerk** — one Clerk instance per app/environment. **Entra never authenticates consumer end users, and Clerk never authenticates Orbit.** The *Users & activity* counts come from **Clerk webhooks**: each Clerk instance posts to `/api/webhooks/clerk/:appId` (Svix-signature-verified with a per-app signing secret `CLERK_WEBHOOK_SECRET__<APPID>`), and Orbit stores only **anonymous aggregate rollups** — an opaque Clerk user id + timestamps, never emails or names. Microsoft Graph remains relevant only for staff/RBAC group membership.
- **Google Play subscriptions are config-gated, placeholder until live.** The *Play subscriptions* surface (`/play-subscriptions`, gated by `Orbit-Cost-Readers`) reports subscription financials (MRR, trailing-30d revenue) and subscriber states (active / canceled / expired) for the tracked Android apps (apps with an `androidPackage` in the `APPS` inventory; GrailBabe (prod) today). GrailBabe is in Play **testing, not live**, so there is no real feed yet and the surface serves deterministic placeholder data. The real connection is dormant and **auto-activates** when configured (mirrors the Entra pattern): `getPlaySubscriptions()` calls the live seam only when `isPlayConfigured()` is true, otherwise it falls back to placeholders. **Org policy blocks downloadable JSON service-account keys**, so the real path is **keyless Workload Identity Federation** (same philosophy as Orbit's Azure managed identity) to the **Android Publisher API** (subscriber states, RTDN-backed) + **Play earnings reports** (revenue) — deferred until launch. Config gate env (all required to go live, deferred): `GOOGLE_PLAY_SA_EMAIL`, `GOOGLE_PLAY_WIF_AUDIENCE`, `GOOGLE_PLAY_DEVELOPER_ID`.
- **Apple App Store subscriptions are config-gated, placeholder until live.** The *App Store subscriptions* surface (`/apple-subscriptions`, gated by `Orbit-Cost-Readers`) mirrors the Play subscriptions surface for iOS apps (apps with an `iosBundle` in the `APPS` inventory; GrailBabe uses `com.kinisislabs.grailbabe` as its App Store bundle ID). The real feed uses the **App Store Connect API** (JWT authentication with an API key + `.p8` private key file). Config gate: `getAppleSubscriptions()` auto-activates the live seam when all three env vars are set, otherwise falls back to placeholders. **Important:** the `.p8` private key file is a **single-download** from App Store Connect (Users and Access → Keys) — it cannot be re-downloaded after the initial generation, so store it securely. Config gate env (all required to go live, deferred): `APPLE_CONNECT_ISSUER_ID` (Issuer ID from App Store Connect → Users and Access → Keys), `APPLE_CONNECT_KEY_ID` (Key ID of the `.p8` API key), `APPLE_CONNECT_PRIVATE_KEY` (PEM contents of the `.p8` file).
- **Cookie domain when real auth lands:** scope session cookies to `.kinisislabs.com` so the same session can be shared with other internal subdomains (id.kinisislabs.com, etc.). `SameSite=Lax; Secure; HttpOnly`.
- **Deploy target:** Azure (Static Web Apps + Container Apps + PostgreSQL Flexible Server) behind the shared Front Door `afd-shared-prod` at `orbit.kinisislabs.com`. See **Deployment (Azure production)** below for the full topology, resources, and CI workflows.

## Deployment (Azure production)

Hosted on Azure in `rg-orbit-prod-eus2` (region East US 2), fronted by the shared Front Door `afd-shared-prod` at `https://orbit.kinisislabs.com`. The Replit environment remains the dev/iteration environment; production is Azure. Orbit runs a **single production environment** only — there is no separate Azure nonprod/dev (internal staff tool).

- **Frontend** (`artifacts/orbit`) → Azure Static Web App `swa-orbit-prod`. Built/deployed by `.github/workflows/azure-static-web-apps.yml` (builds the pnpm monorepo, uploads with `skip_app_build`). SPA routing via `artifacts/orbit/public/staticwebapp.config.json`. Requires repo secret `AZURE_STATIC_WEB_APPS_API_TOKEN`.
- **API** (`artifacts/api-server`) → Azure Container App `ca-orbit-prod-v2` (env `cae-orbit-prod-eus2`), in the **shared-platform subscription** (`sub-sharedplatform`). Containerized via `artifacts/api-server/Dockerfile`; Container App ingress targetPort **80** (app binds `PORT=80`; health probes are hardcoded to TCP 80). Built/deployed by `.github/workflows/deploy-api-container.yml` (image → GHCR by default). Dormant until the Entra app registration + GitHub OIDC creds exist (`AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`).
- **Database** → Azure Database for PostgreSQL Flexible Server `pg-orbit-prod`, database `orbit`. **Set `DATABASE_SSL=true`** on the Container App (TLS required). Connection string stored in `kv-shared-prod`. Apply schema with `pnpm --filter @workspace/db run push` against the Azure `DATABASE_URL`. The deploy workflow runs `pnpm --filter @workspace/scripts run backfill-threshold-history` automatically after each `db push` — it seeds an initial audit-log entry for any `app_thresholds` row that predates the audit-log feature; idempotent (apps with existing history are skipped).
- **Routing:** Front Door `orbit.kinisislabs.com` → `/*` to the frontend origin group (SWA), `/api/*` to the API origin group (Container App). Because both share the host, the frontend's relative `/api` calls work with no base-URL change.
- **Identity for Azure data:** the API authenticates to Azure (Resource Graph, Monitor, Cost Management, Microsoft Graph, Key Vault, App Configuration) via the user-assigned managed identity `id-orbit-api-prod` — use `DefaultAzureCredential`, **no client secret**. (Integration code deferred; dashboard data is still mock.)
- **Also provisioned:** App Configuration `appcs-orbit-prod-eus2` (`APP_CONFIGURATION_ENDPOINT`) and Application Insights `appi-oribit-prod` (resource name is misspelled "oribit"; `APPLICATIONINSIGHTS_CONNECTION_STRING`) — App Insights SDK wiring not built yet. App Configuration is wired: set the key `COST_REFRESH_INTERVAL_MINUTES` in the store to tune the background cost-refresh cadence live without a redeploy (see `artifacts/api-server/src/lib/appConfig.ts`). A GitHub-OIDC federated managed identity (`…rg-orbit-prod-eus2Oidc`) also exists for the deploy workflow.
- **Prod resource names (confirmed from Azure portal, June 2026):** SWA `swa-orbit-prod`, Container App `ca-orbit-prod-v2` (in `sub-sharedplatform`, NOT `rg-orbit-prod-eus2`), Container Apps Env `cae-orbit-prod-eus2`, Postgres `pg-orbit-prod`, App Config `appcs-orbit-prod-eus2`, App Insights `appi-oribit-prod` (sic), API managed identity `id-orbit-api-prod`. Naming is inconsistent — several resources omit the `-eus2` suffix, the SWA uses `swa-` (not `stapp-`), and App Insights is misspelled. Shared/other resources (Front Door, Key Vault, ACR, Log Analytics, Storage, RG) were not in the portal listing and remain as specified above (unconfirmed).

**Azure data integrations (Cost, Resources, Subscriptions) — built, config-gated:** `azureCost.ts`, `azureResources.ts`, and `azureSubscriptions.ts` are fully implemented. They activate when `AZURE_SUBSCRIPTION_IDS` is set on the Container App; otherwise the dashboard falls back to mock/seeded data (Replit dev preview is unaffected). Add these secrets to the **OrbitProduction** GitHub environment and retrigger the deploy workflow to go live:

- `AZURE_SUBSCRIPTION_IDS` — comma-separated GUIDs of every subscription hosting tracked apps (e.g. the shared platform sub + the internal tools sub)
- `AZURE_MANAGED_IDENTITY_CLIENT_ID` — client ID of `id-orbit-api-prod` (Azure Portal → Managed Identities → id-orbit-api-prod → Overview → Client ID); tells DefaultAzureCredential which user-assigned identity to use
- `AZURE_SUB_GRAILBABE` — subscription GUID for GrailBabe's resource group `rg-grailbabeprod-compute-prod-eus2` (optional if it's the same sub as orbit)
- `AZURE_SUB_ORBIT` — subscription GUID for Orbit's resource group `rg-orbit-prod-eus2` (optional)
- `AZURE_SUB_KINISIS_LABS` — subscription GUID for `rg-kinisislabs-web-prod-eus2` (optional)
- `AZURE_SUB_SHARED_INFRA` — subscription GUID for the shared-platform subscription (`sub-sharedplatform`) that hosts `ca-orbit-prod-v2`, `afd-shared-prod`, and shared VNets/Network Watchers. **Required for the network page to find any resources.** When set, every network Resource Graph query includes this subscription regardless of which app is in scope. Set it to the same GUID as `AZURE_SUB_ORBIT` if both live in `sub-sharedplatform`, or to a distinct GUID if they differ. Deduplicated automatically — no double-query if it matches a value already in `AZURE_SUBSCRIPTION_IDS`.

Required Azure RBAC for `id-orbit-api-prod` on each subscription in `AZURE_SUBSCRIPTION_IDS` **and on the `AZURE_SUB_SHARED_INFRA` subscription** (sub-sharedplatform): **Cost Management Reader** (Cost Management queries) + **Reader** (Resource Graph queries). The shared-platform sub hosts Container Apps, Front Door, and Network Watchers — without `Reader` on it, network-page Resource Graph queries will throw `AuthorizationFailed`. Assign via Azure Portal → Subscriptions → IAM → Add role assignment → Members tab → select Managed identity → `id-orbit-api-prod`.

Also ensure `id-orbit-api-prod` is **assigned to the Container App**: Azure Portal → Container Apps → ca-orbit-prod-v2 → Identity → User assigned → Add → select `id-orbit-api-prod`.

**Live time-series charts — config-gated:** The telemetry and infrastructure routes query real hourly time-series from Log Analytics when `AZURE_LOG_ANALYTICS_WORKSPACE_ID` is set (the workspace **customer ID / GUID**, shown as "Workspace ID" in the Azure portal — not the resource ID). Set this on the Container App alongside the base Azure vars. When unset (or when any live query fails / returns empty data), the routes fall back to deterministic seeded mock series — Replit dev preview is unaffected. Managed identity `id-orbit-api-prod` needs **Log Analytics Reader** on the workspace to run the KQL queries.

**Deployments surface — requires `ORBIT_DEPLOY_ID` GitHub secret (OrbitProduction env):** The deployments page fetches GitHub Actions run history via the GitHub API. The token must be a fine-grained PAT with Actions: Read-only on the tracked repos (`Orbit-Admin-Ctr`, `GrailBabe`). Named `ORBIT_DEPLOY_ID` in the OrbitProduction environment secrets to avoid collision with the built-in `GITHUB_TOKEN` that Actions uses for GHCR login. The deploy workflow passes it to the Container App as the env var `GITHUB_TOKEN`.

**Domain live (June 2026):** `orbit.kinisislabs.com` is resolving and the SWA is serving traffic. Front Door routing is in place.

**API deploy OIDC — requires federated credential on the app registration:** The `deploy-api-container.yml` workflow uses `azure/login@v2` with OIDC (no client secret). This requires a **federated credential** on the Entra app registration: Certificates & secrets → Federated credentials → Add → scenario "GitHub Actions deploying Azure resources", org `Kinisis-Labs`, repo `Orbit-Admin-Ctr`, entity type **Environment**, environment name **OrbitProduction**. The subject must be `repo:Kinisis-Labs/Orbit-Admin-Ctr:environment:OrbitProduction` (NOT a branch subject — because the job declares `environment: OrbitProduction`, GitHub's OIDC token uses the environment subject, not a ref subject). The app registration also needs **Reader** on the subscription (so `az account set` can find it) and **Contributor** on `rg-orbit-prod-eus2` (for actual deploy). All three OrbitProduction environment secrets (`AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`) were verified working in run #9 (June 2026); login step ✓.

### Authentication (Entra ID) — built, config-gated

Real Microsoft Entra ID sign-in (OpenID Connect, auth code + PKCE) is implemented. It activates only when **all** of these are present; otherwise the app runs in **mock mode** (open data routes, simulated user) so the Replit dev preview keeps working. In production the API **fails closed**: it refuses to start if Entra is not fully configured.

Required env (shared, same in dev & prod): `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`, `ENTRA_AUTHORIZED_GROUP_ID` (Orbit-Authorized-Users object id), `ENTRA_COST_READER_GROUP_ID` (Orbit-Cost-Readers object id). Secret: `ENTRA_CLIENT_SECRET`. Per-environment: `ENTRA_REDIRECT_URI` (dev = `https://<replit-dev-domain>/api/auth/callback`, prod = `https://orbit.kinisislabs.com/api/auth/callback`). Optional: `ENTRA_SCOPES`, `ENTRA_POST_LOGOUT_REDIRECT_URI`. `SESSION_SECRET` is required in production (already set).

Optional RBAC group env (shared, GUID object ids — only resolve membership when set): `ENTRA_ADMIN_GROUP_ID` (Orbit-Admins), `ENTRA_ENGINEER_GROUP_ID` (Orbit-Engineers), `ENTRA_FINOPS_GROUP_ID` (Orbit-FinOps). All five Orbit-* groups are resolved in `routes/auth.ts` (`resolveOrbitGroups`) and surfaced to the frontend via `/api/auth/me` so `hasGroup()` and the Access page reflect real membership in Entra mode. These three are membership-aware only — no API route is gated on them yet (only `Orbit-Authorized-Users` baseline + `Orbit-Cost-Readers` FinOps gate are enforced).

Entra app registration checklist: register both the dev and prod redirect URIs (Web platform), enable the **groups claim** (Token configuration → add groups claim → Security groups, for ID tokens), and create a client secret. The groups claim emits group **object IDs** (GUIDs) — every `ENTRA_*_GROUP_ID` must be those GUIDs.

### Access-request contact — configurable without redeploy

The contact address shown on the access-denied screen is served via `/api/auth/me` (`accessContact` field). Set `ORBIT_ACCESS_CONTACT` on the Container App to override it without a code change or frontend redeploy. Falls back to `orbit-access@kinisislabs.com` when unset.

- `ORBIT_ACCESS_CONTACT` — email address shown on the "Access not granted" screen and used for the "Request access" mailto link (e.g. `it-helpdesk@kinisislabs.com`)

### Budget overrun alerts — config-gated, opt-in

A background scheduler (`lib/budgetAlerts.ts`) fires when `forecast > budget` for any tracked app. It starts automatically after server listen; if no channel is configured it logs a single info message and exits. Safe in dev with no env vars set.

**Teams (Adaptive Card via Incoming Webhook):**
- `ALERT_TEAMS_WEBHOOK_URL` — global incoming-webhook URL (create in a Teams channel → Manage channel → Connectors → Incoming Webhook)
- `ALERT_TEAMS_WEBHOOK_URL__<APPID>` — per-app override (upper-cased, hyphens → underscores; e.g. `ALERT_TEAMS_WEBHOOK_URL__GRAILBABE`)

**SMTP email:**
- `ALERT_SMTP_HOST` — SMTP server hostname (e.g. `smtp.office365.com`)
- `ALERT_SMTP_PORT` — port (default 587 for STARTTLS, 465 for implicit TLS)
- `ALERT_SMTP_USER` — SMTP username
- `ALERT_SMTP_PASS` — SMTP password / app password
- `ALERT_SMTP_FROM` — sender address (e.g. `orbit@kinisislabs.com`)
- `ALERT_SMTP_SECURE` — `"true"` for implicit TLS; omit or `"false"` for STARTTLS
- `ALERT_EMAIL_TO` — comma-separated recipient(s) (e.g. `ops@kinisislabs.com,finance@kinisislabs.com`)
- `ALERT_EMAIL_TO__<APPID>` — per-app recipient override

**Scheduler tuning:**
- `ALERT_CHECK_INTERVAL_MINUTES` — polling cadence (default `60`)
- `ALERT_COOLDOWN_HOURS` — minimum hours between repeat alerts per app (default `12`)
- `ALERT_COOLDOWN_HOURS__<APPID>` — per-app override (upper-cased, hyphens → underscores; e.g. `ALERT_COOLDOWN_HOURS__GRAILBABE=24`)

**Infra thresholds (two-tier resolution: env-var override → APPS inventory → global env var → default):**
- `ALERT_CPU_THRESHOLD_PCT` — global CPU % threshold (default `80`); used only when no per-app env-var override and no `cpuThreshold` in the APPS inventory for that app
- `ALERT_CPU_THRESHOLD_PCT__<APPID>` — highest-priority per-app override (upper-cased, hyphens → underscores; e.g. `ALERT_CPU_THRESHOLD_PCT__GRAILBABE=90`); overrides both the APPS inventory value and the global env var
- `ALERT_MEMORY_THRESHOLD_PCT` — global Memory % threshold (default `85`); same fallback rules as CPU
- `ALERT_MEMORY_THRESHOLD_PCT__<APPID>` — highest-priority per-app override (e.g. `ALERT_MEMORY_THRESHOLD_PCT__ORBIT=70`)
- `ALERT_INFRA_CONSECUTIVE_CHECKS` — consecutive over-threshold checks required before a notification fires (default `2`)
- `ALERT_INFRA_CONSECUTIVE_CHECKS__<APPID>` — per-app override (upper-cased, hyphens → underscores; e.g. `ALERT_INFRA_CONSECUTIVE_CHECKS__GRAILBABE=4`)

## Product

_Describe the high-level user-facing capabilities of this app once they exist._

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- **Session table is schema-owned, not auto-created.** The API ships as a single esbuild bundle (no `node_modules` at runtime), so `connect-pg-simple`'s `createTableIfMissing` can't find its `table.sql` (ENOENT) — symptom is sign-in failing at the OAuth callback ("Sign-in could not be completed"). The `user_sessions` table lives in `lib/db/src/schema/session.ts` and is provisioned by `pnpm --filter @workspace/db run push`; `createTableIfMissing` is `false`. Run a `db push` against any new environment's database (incl. Azure prod) before sign-in will work.
- **`ENTRA_TENANT_ID` must be the bare tenant GUID** — no `ID ` prefix or stray whitespace. A malformed value makes OIDC discovery build an invalid `login.microsoftonline.com/<tenant>/v2.0` URL and the whole app 500s on every auth route.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
