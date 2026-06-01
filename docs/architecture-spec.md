# Orbit — Architecture Specification

**Version:** 3.0
**Status:** Draft — supersedes _Kinisis Orbit Architecture Specification v2_
**Owner:** Platform Engineering

> **Rebrand note.** The product previously codenamed **Global App Admin Center (GAAC)** and then **Kinisis Orbit** is now **Orbit** (or "Orbit" for short). All user-facing copy, Azure resource names, Entra security groups, and internal workspace identifiers have been renamed to the `orbit` / `Orbit-*` convention as part of v3 (see §5 and §7).

---

## 1. Executive Summary

Orbit is the centralised admin centre for every Kinisis-operated application. It gives engineers and operators a unified, real-time view of Azure infrastructure, network health, application telemetry, alerts, cost, and end-user engagement across all environments (prod, staging, dev) of every Kinisis app from a single Azure Portal–styled dashboard.

The platform aggregates live operational data directly from Azure, Microsoft Entra (via Microsoft Graph, for staff RBAC), Clerk (consumer end-user activity, via webhooks), and per-application telemetry APIs. **No monitoring, telemetry, or customer PII is persisted inside Orbit** — operational data is queried live from authoritative sources at request time. The lone persisted category is **anonymous** end-user activity rollups (opaque ids + timestamps only, no PII; see §9).

---

## 2. Objectives

- One pane of glass for every Kinisis-hosted application, across **all environments**.
- Per-environment isolation: `prod` and `dev` (and `staging` where applicable) of the same app are tracked as **independent scopes** with their own status, alerts, infrastructure, cost, and user engagement.
- Live infrastructure, network, telemetry, cost, and end-user-engagement visibility — no internal data warehousing.
- Centralised, severity-tiered alerting across all monitored apps.
- Secure, internal-only access via Microsoft Entra ID with MFA and group-based authorisation.
- **Cost data segregated** from operational data by RBAC group (FinOps boundary).
- Scalable to additional apps, environments, and future mobile telemetry sources without re-architecting.

---

## 3. High-Level Architecture

```
Internal Engineers / Operators
            │
            ▼
   Microsoft Entra ID (SSO + MFA + Conditional Access)
            │
            ▼
   Azure Front Door / Static Web App  ← Orbit web UI (React + Vite + wouter)
            │
            ▼
   Azure Container Apps               ← Orbit API (Express 5 / Node 24)
       │
       ├──► Azure Monitor             (infrastructure & app metrics)
       ├──► Azure Resource Graph      (resource inventory & topology)
       ├──► Log Analytics             (logs, KQL queries)
       ├──► Network Watcher           (latency, packet loss, NSG flow logs)
       ├──► Application Insights      (RUM, traces, exceptions)
       ├──► Azure Cost Management     (MTD spend, forecast, per-API allocation)
       ├──► Microsoft Graph           (group membership for staff RBAC)
       ├──► Clerk webhooks            (consumer end-user events → Orbit DB rollup)            ← new in v3
       └──► Per-app telemetry APIs    (custom KPIs exposed by each app)
```

Frontend and API are deployed as a single logical unit per environment. The API performs all Azure-facing calls server-side via **managed identity**, so no Azure tokens are ever issued to the browser. Microsoft Graph is called via the same managed identity using application permissions — no static API keys, no third-party IdP, no secrets in the browser.

---

## 4. Tracked Applications (Tenant Inventory)

Orbit treats each `{app, environment}` pair as a first-class **scope**, a first-class **Entra app registration** (with a backing security group), and a first-class Cost-Management tag pair. The seeded inventory is:

| App ID            | Display Name      | Env     | Region    | Resource Group              | Subscription                    | Entra App Reg / User Group |
| ----------------- | ----------------- | ------- | --------- | --------------------------- | ------------------------------- | -------------------------- |
| `grailbabe`       | GrailBabe         | prod    | eastus2   | `rg-grailbabe-prod-eus2`    | `sub-kinisis-platform-prod`     | `app-grailbabe-prod` / `grailbabe-prod-users`    |
| `grailbabe-dev`   | GrailBabe (dev)   | dev     | eastus2   | `rg-grailbabe-dev-eus2`     | `sub-kinisis-platform-nonprod`  | `app-grailbabe-dev` / `grailbabe-dev-users`      |
| `kinisis-id`      | Kinisis ID        | prod    | eastus2   | `rg-kid-prod-eus2`          | `sub-kinisis-platform-prod`     | `app-kinisis-id-prod` / `kinisis-id-prod-users`  |
| `ops-portal`      | Ops Portal        | prod    | centralus | `rg-ops-prod-cus`           | `sub-kinisis-internal-prod`     | `app-ops-portal-prod` / `ops-portal-prod-users`  |
| `ledger-api`      | Ledger API        | prod    | westus2   | `rg-ledger-prod-wus2`       | `sub-kinisis-finance-prod`      | `app-ledger-api-prod` / `ledger-api-prod-users`  |
| `atlas-cms`       | Atlas CMS         | staging | eastus2   | `rg-atlas-stg-eus2`         | `sub-kinisis-internal-nonprod`  | `app-atlas-cms-stg` / `atlas-cms-stg-users`      |

**Internal-only platform.** Every tracked application is a Kinisis employee tool — none are customer-facing. The whole estate (Orbit and every app it monitors) sits behind the **single corporate Entra ID tenant**; there is no Entra External ID / CIAM tenant, no third-party IdP, no anonymous access anywhere. App-assignment + Conditional Access policies restrict each app registration to the employees who need it.

**New in v3:** every tracked pair binds to a real subscription name plus an app registration and a security group in the corporate tenant. The security group is the source-of-truth for *staff* access ("can this employee operate GrailBabe (prod)"); end-user engagement on the Users & activity page instead comes from Clerk webhook ingestion (§9), since these consumer apps' real users are external end users, not employees. v2 placeholder subscription IDs (`a1f4-shared-platform`, `b203-internal-tools`, `c508-finance`) map onto `sub-kinisis-platform-prod`, `sub-kinisis-internal-prod`, and `sub-kinisis-finance-prod` respectively.

Future environments (`kinisis-id-dev`, `ledger-api-stg`, …) onboard by the same pattern — one row per `{app, environment}`, one app registration, one user group, one resource group.

---

## 5. Azure Deployment Architecture

Orbit (the platform) deploys into the **Shared Platform** subscriptions and runs a **single production environment** — it is an internal staff tool with no Orbit nonprod/dev. v3 formalises the subscription topology (which retains a prod/nonprod split for the customer-facing apps Orbit monitors) and applies a Cloud Adoption Framework–aligned naming and tagging scheme.

### 5.1 Naming convention (new in v3)

All v3 infrastructure follows Microsoft's [Cloud Adoption Framework](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/azure-best-practices/resource-naming) naming pattern. Adopt these **before** provisioning anything.

Tokens:

- `<workload>` — `orbit`, `grailbabe`, `kid`, `ops`, `ledger`, `atlas`.
- `<env>` — `prod`, `nonprod`, `dev`, `stg`. (Orbit itself is prod-only; `nonprod`/`dev`/`stg` are used by the tracked apps and their shared infra.)
- `<region>` — `eus2`, `cus`, `wus2`.
- `<instance>` — numeric suffix when more than one of the same resource exists.

Patterns:

- **Subscriptions:** `sub-kinisis-<purpose>-<env>` — one per business purpose, never per app.
- **Resource groups:** `rg-<workload>-<env>-<region>` — one per `{workload, environment, region}` tuple; never spans environments.
- **General resources:** `<type>-<workload>-<purpose?>-<env>-<region?>` using CAF abbreviations (`afd-`, `stapp-`, `cae-`, `ca-`, `psql-`, `kv-`, `appcs-`, `appi-`, `law-`, `id-`, `pe-`, `pdnsz-`, `vnet-`, `snet-`, `nsg-`).
- **Globally-unique no-hyphen types** (Storage, ACR): `<type><workload><env><suffix>` (e.g. `storbitprod01`, `acrkinisis01`).

Mandatory tags on every RG and tagged resource: `workload`, `environment`, `owner`, `cost-center`, `data-class`, `criticality`. Enforce via Azure Policy "Require a tag and its value" — Cost Management exports and the FinOps boundary in §8 depend on `workload` + `environment` being set on every resource.

### 5.2 Subscriptions (new in v3)

One subscription per business purpose, not per app. This keeps Cost Management, Policy, and RBAC tractable as the estate grows.

| Subscription                   | Purpose                                                                                   | Owner          |
| ------------------------------ | ----------------------------------------------------------------------------------------- | -------------- |
| `sub-kinisis-platform-prod`    | Shared platform: Orbit, Kinisis ID, GrailBabe (prod) and other shared customer-facing apps | Platform Eng   |
| `sub-kinisis-platform-nonprod` | Shared platform non-prod: GrailBabe (dev) and per-app dev environments (no Orbit nonprod)  | Platform Eng   |
| `sub-kinisis-internal-prod`    | Internal tools: Ops Portal, Atlas CMS (when promoted), other staff-only apps              | Internal Tools |
| `sub-kinisis-internal-nonprod` | Internal tools non-prod / staging                                                          | Internal Tools |
| `sub-kinisis-finance-prod`     | Finance-isolated workloads (Ledger API and any future PCI-scoped systems)                 | Finance Eng    |
| `sub-kinisis-finance-nonprod`  | Finance non-prod                                                                           | Finance Eng    |
| `sub-kinisis-sandbox`          | Engineer playground; no production data, no SLAs, auto-shutdown policies                  | Platform Eng   |

### 5.3 Production resources

Orbit runs a **single production environment** only — no separate Azure nonprod/dev (the Replit environment is used for dev/iteration). Resource names follow §5.1.

| Resource Type                  | Name                     | Purpose                                                                 |
| ------------------------------ | ------------------------ | ----------------------------------------------------------------------- |
| Resource Group                 | `rg-orbit-prod-eus2`     | Container for all Orbit prod resources                                  |
| Azure Front Door (Standard)    | `afd-orbit-prod`         | TLS termination, WAF, custom domain                                     |
| Static Web App                 | `swa-orbit-prod`         | React/Vite frontend hosting                                             |
| Container Apps Environment     | `cae-orbit-prod-eus2`    | Runtime for the Express API                                             |
| Container App                  | `ca-orbit-api-prod`      | Orbit API service                                                       |
| Azure Container Registry       | `acrkinisis01` (shared)  | API container image registry — single, organisation-wide                |
| Azure Database for PostgreSQL  | `pg-orbit-prod`          | Sessions, group-cache, audit log, **Entra sign-in rollups (`user_activity`)** |
| Key Vault                      | `kv-orbit-prod-eus2`     | DB credentials, signing keys, Event Hub SAS / consumer credentials, downstream secrets |
| App Configuration              | `appcs-orbit-prod-eus2`  | Feature flags, scoped app inventory                                     |
| Application Insights           | `appi-oribit-prod` (sic) | Telemetry for the Orbit platform itself                                 |
| Log Analytics Workspace        | `law-orbit-prod-eus2`    | Centralised logs/queries for the Orbit platform                         |
| Storage Account                | `storbitprod01`          | Static asset overflow, export buckets                                   |
| User-Assigned Managed Identity | `id-orbit-api-prod`      | Identity used by the API to call downstream Azure services              |
| Private Endpoint(s)            | `pe-orbit-*-prod-eus2`   | Private connectivity to Postgres, Key Vault, App Config                 |

> **Resource naming — actual vs. intended.** Orbit runs a single prod environment (no nonprod/dev). The names above are the *intended* convention; **production** names confirmed from the Azure portal (June 2026) diverge: several omit the `-eus2` region suffix (`swa-orbit-prod`, `ca-orbit-api-prod`, `id-orbit-api-prod`, `pg-orbit-prod`, `appi-oribit-prod`), the Static Web App uses the `swa-` prefix (not `stapp-`), and Application Insights is **misspelled** `appi-oribit-prod` ("oribit"). `appcs-orbit-prod-eus2` and `cae-orbit-prod-eus2` match. A GitHub-OIDC federated managed identity (`…rg-orbit-prod-eus2Oidc`) also exists for the deploy workflow. Resources not visible in the portal listing (Front Door, Key Vault, ACR, Log Analytics, Storage, Private Endpoints) remain as specified above and are unconfirmed.

### 5.4 New resources required for v3 (delta from v2)

These are items v2 did not call out and must be added before deployment:

1. **Subscription topology and tag policy.**
   §5.2 subscriptions created (or existing ones renamed) and §5.1 tag-enforcement Azure Policy assigned at every subscription scope.
2. **Resource-group rename pass.**
   Every existing RG in §4 renamed to the `rg-<workload>-<env>-<region>` pattern; any legacy `-gaac-` named Azure resources re-provisioned (or aliased) under the new `-orbit-` names as part of v3 cutover.
3. **Microsoft Graph integration (staff/RBAC only).**
   Orbit uses Graph for **staff** group checks — resolving the `Orbit-*` RBAC groups for signed-in employees. It is **not** used for consumer end-user engagement (that comes from Clerk, §9). Application permission required: `GroupMember.Read.All`, via the API's managed identity — no static keys.
4. **Clerk webhook ingestion → Orbit API → Postgres.**
   Each tracked consumer app's Clerk instance posts user/session events (`user.created/updated/deleted`, `session.created`) to `POST /api/webhooks/clerk/:appId`. Orbit verifies the Svix signature with that app's signing secret, then writes **anonymous** activity (opaque Clerk user id + timestamps). No per-app code changes beyond configuring the webhook in Clerk.
5. **Clerk activity tables** in `pg-orbit-<env>`.
   `app_users` (one row per app + opaque Clerk user id, with `created_at` / `last_sign_in_at` / `last_active_at`), `clerk_events` (Svix-id-keyed event metadata for idempotent replay — no payload), and `clerk_activity_daily` (per-app daily snapshot for the DAU trend). DAU/WAU/MAU are aggregate COUNTs over `app_users`. **The only new persisted data category — anonymous, no PII.**
6. **One app registration + `<app>-<env>-users` security group per tracked `{app, environment}`** (§4) in the corporate Entra tenant. Each Kinisis app is configured to use that app registration for sign-in; app-assignment policies restrict access to the corresponding security group.
7. **API identity bindings extended** to every subscription that hosts a tracked app (platform-prod/nonprod, internal-prod/nonprod, finance-prod) — see §5.5.

### 5.5 RBAC bindings the API identity needs

Assign to `id-orbit-api-<env>` at the **subscription** scope of every subscription that contains a tracked app (or each monitored RG, if subscription-wide is rejected):

- `Reader` — Resource Graph queries
- `Monitoring Reader` — Azure Monitor + Application Insights
- `Cost Management Reader` — Cost Management API
- `Log Analytics Reader` — KQL queries against per-app workspaces
- `Network Contributor` (read-only via custom role preferred) — Network Watcher data
- `Key Vault Secrets User` — on `kv-orbit-<env>` (own-env only)

---

## 6. Application Architecture (as built)

The repository is a pnpm monorepo with the following deployable artifacts:

| Path                          | Artifact         | Stack                                                  |
| ----------------------------- | ---------------- | ------------------------------------------------------ |
| `artifacts/orbit/`             | Orbit web        | React 19, Vite, wouter, TanStack Query, Recharts, Tailwind |
| `artifacts/api-server/`       | Orbit API        | Express 5, Node 24, Zod, Drizzle ORM, Pino             |
| `lib/api-spec/`               | OpenAPI contract | OpenAPI 3 source-of-truth, Orval codegen               |
| `lib/api-zod/`                | Zod schemas      | Generated from OpenAPI                                 |
| `lib/api-client-react/`       | React Query hooks| Generated from OpenAPI                                 |
| `lib/db/`                     | Drizzle schema   | Postgres schema + migration helpers                    |

**Contract-first.** All HTTP surfaces are defined in `lib/api-spec`, with Zod validators and React Query hooks generated from it. The API server validates every request and response against the same Zod schemas.

**Mocked data layer (current).** All app, telemetry, network, alert, and cost data is currently produced by deterministic seed functions in `artifacts/api-server/src/routes/orbit.ts` and `artifacts/orbit/src/lib/mock-data.ts`. The intent is for those handlers to be replaced one-by-one by live Azure + Microsoft Graph calls without changing the OpenAPI contract. **User-activity is no longer mock** — it is served from real Clerk webhook ingestion (§9), with a dev seed (`scripts/src/seed-clerk-activity.ts`) for the preview.

---

## 7. Security, Identity, and RBAC

- **Authentication (Orbit and every tracked app):** Microsoft Entra ID, corporate tenant, OIDC + PKCE, MFA enforced via Conditional Access. The entire platform is **employees-only** — no public access, no Entra External ID / CIAM tenant, no anonymous surfaces, no third-party IdP, no API keys for end users.
- **Authorisation model:** Group-based throughout. Orbit RBAC uses the `Orbit-*` groups below. Per-app membership uses `<app>-<env>-users` security groups. Membership is verified per request via Microsoft Graph (cached in Postgres for ≤5 min).
- **HTTPS-only**, HSTS preload, TLS 1.2+ at Front Door.
- **Managed identity** for all Azure-facing calls (including Microsoft Graph) — no service principal secrets in code or Key Vault.
- **Entra sign-in log stream** to Event Hub is consumed by the API using a managed-identity SAS; payload origin is implicitly trusted because the stream is private-endpoint-only and SAS-restricted. **(new in v3)**
- **Audit logging** of every privileged action (group changes, cost queries, alert acknowledgements, user-search) to Log Analytics.

### Required Entra security groups

| Group                    | Purpose                                                              |
| ------------------------ | -------------------------------------------------------------------- |
| `Orbit-Authorized-Users`  | Baseline access — required to load Orbit at all                      |
| `Orbit-Admins`            | Platform administration, group simulation, feature flags             |
| `Orbit-Engineers`         | Operational actions (acknowledge alerts, trigger refresh)            |
| `Orbit-Cost-Readers`      | Required to view any cost surface (see §8)                           |
| `Orbit-FinOps`            | Cost Management write actions (budgets, allocations) — future use    |

---

## 8. Cost Visibility & FinOps Boundary

v1 surfaced cost data alongside operational telemetry on every page. v2 established the FinOps boundary; v3 reinforces it by pinning cost allocation to the `workload` + `environment` tag pair from §5.1.

- **Cost Management is the only surface that displays cost data.** The Home dashboard and the app-detail Overview / Infrastructure / Network / Telemetry / Alerts / Users tabs show no monetary information of any kind, regardless of caller identity.
- The dedicated **Cost Management** page (Overview / Budgets / Forecasts) and the per-app **Cost** tab are both gated by membership in `Orbit-Cost-Readers`. Users without that group see an Azure-styled access-denied panel and a lock icon on the navigation entry / tab.
- Cost queries are short-circuited at the API layer when the caller is not in `Orbit-Cost-Readers`, so cost data never crosses the wire to unauthorised browsers.
- Cost is allocated per `{workload, environment}` tag pair, so `grailbabe` (prod) and `grailbabe-dev` show independent MTD spend, forecast, and budget burn.

---

## 9. Users & Activity (new in v3)

Orbit's **Users & activity** page reports DAU / WAU / MAU, stickiness, inactive-user counts, and new-user counts per tracked **consumer app**. The tracked consumer apps (e.g. GrailBabe prod/dev) are customer-facing products whose **end users authenticate via Clerk** — one Clerk instance per `{app, environment}`. Orbit itself is *not* in this dataset: Orbit and other internal employee tools authenticate staff via Entra (§8) and are not Clerk apps. "Users" here means *each consumer app's real end users*, counted **anonymously** — there is no roster, no names, no emails.

Data flow:

```
Each consumer app's Clerk instance (signs its end users in)
        ↓  Clerk webhook: user.created/updated/deleted, session.created
POST /api/webhooks/clerk/:appId   ← Svix signature verified with that app's per-app signing secret
        ↓  Orbit API ingestion (idempotent on the Svix message id)
pg-orbit-<env>:
   app_users             ← one row per (app, opaque Clerk user id) + timestamps
   clerk_events          ← event metadata for idempotent replay (no payload)
   clerk_activity_daily  ← per-app daily snapshot powering the DAU trend
        ↓  aggregate COUNTs over app_users (DAU / WAU / MAU / new-7d)
GET /api/users/activity   ← Orbit UI (counts only)
```

- Orbit stores **no consumer PII**. Only an **opaque Clerk user id** + timestamps (`created_at`, `last_sign_in_at`, `last_active_at`) are persisted — never emails, names, or the raw webhook payload. The dashboard shows aggregate counts only; there is **no recent-users roster**.
- Per-app webhook signing secrets are stored as env secrets keyed by app: `CLERK_WEBHOOK_SECRET__<APPID>` (app id upper-cased, non-alphanumerics → `_`, e.g. `CLERK_WEBHOOK_SECRET__GRAILBABE_DEV`). An app with no configured secret simply ingests nothing.
- The Users & activity page is visible to all `Orbit-Authorized-Users`. It is **not** behind the FinOps boundary, because engagement metrics are operational data, not financial data.
- Counts respect the global / per-app scope selector, identical to every other Orbit surface.

---

## 10. Dashboard Capabilities (as built)

- **Scope selector** — Global view, or scoped to any single `{app, environment}` (e.g. GrailBabe prod vs GrailBabe dev).
- **Home (status-only):** Total Applications, Global Health (healthy/degraded/unhealthy), Active Alerts, Active Regions; App Services table with status, environment, location, alert count.
- **Per-app blade (Azure-portal styled):** Overview / Infrastructure / Network / Telemetry / Cost / Alerts tabs, with Azure-style command bar (Start / Restart / Stop / Configuration).
- **Monitoring group:** Alerts, Deployments, Incidents (ServiceNow stub), Activity log, Health & SLOs, Network, Log search, Service health, **Users & activity (new in v3)**.
- **Cost group:** Cost Management — Overview / Budgets / Forecasts; all gated by `Orbit-Cost-Readers`.
- **Governance group:** Subscriptions, Tags, Identity & access.
- **Resources group:** All resources.
- **Settings group:** Preferences.
- **Theme:** Azure Portal dark/light, persisted per user.
- **Identity simulator (dev only):** the avatar menu lets engineers toggle in/out of `Orbit-Cost-Readers` to exercise the gated surfaces without an Entra round-trip.

---

## 11. Alerting & Incident Sources

| Source                  | Monitoring area                                  |
| ----------------------- | ------------------------------------------------ |
| Azure Monitor           | Infrastructure & app health                      |
| Log Analytics           | Operational & network logs (KQL)                 |
| Network Watcher         | Connectivity, latency, packet loss               |
| Azure Cost Management   | Budget breaches, cost anomalies                  |
| Application Insights    | App performance, exceptions, availability        |
| Per-app telemetry APIs  | Custom app-defined health & KPI signals          |
| ServiceNow              | Incident management (live tickets, ack flow)     |

All alerts are read live; Orbit does not own alert rules or incident state — those remain in each app's Azure Monitor and ServiceNow configuration. Orbit only aggregates and presents.

---

## 12. Data-Flow Model

```
Operator opens Orbit
        ↓
Entra ID SSO + MFA + group check (Orbit-Authorized-Users)
        ↓
Selects scope (Global or a specific {app, environment})
        ↓
Express API (managed identity) queries Azure + Microsoft Graph APIs in parallel
        ↓
Responses validated against Zod schemas
        ↓
Unified dashboard rendered in the browser
```

**No monitoring data, telemetry history, customer data, or cost line items are persisted by Orbit.** The only persisted state is platform-internal: sessions, cached group membership, audit log, feature flags, and the Entra sign-in rollup table (§9).

---

## 13. Deployment Checklist (delta from v2)

Before promoting v3 to production, the following must be in place (in this order):

- [ ] §5.2 subscriptions created or renamed; §5.1 tag-enforcement Azure Policy assigned at every subscription scope.
- [ ] Resource groups renamed / created per §5.1 for Orbit and every tracked app in §4.
- [ ] `rg-orbit-prod-eus2` populated with all resources in §5.3.
- [ ] Azure Container Apps environment + Container App for the API.
- [ ] PostgreSQL Flexible Server provisioned with HA, including the new `user_activity` schema from §5.4.
- [ ] Azure Container Registry (`acrkinisis01`) created; CI/CD publishing API images.
- [ ] User-assigned managed identities created and assigned the §5.5 RBAC roles across **all subscriptions** that host tracked apps.
- [ ] Front Door created with `/api/*` routing rule + WAF policy.
- [ ] Entra group `Orbit-Cost-Readers` created and populated with FinOps & engineering leads.
- [ ] Microsoft Graph `GroupMember.Read.All` consented for the Orbit app registration.
- [ ] One **app registration** + one `<app>-<env>-users` security group created in the corporate Entra tenant per tracked `{app, environment}` (§4); each Kinisis app reconfigured to authenticate against its app registration; app-assignment restricted to the matching group.
- [ ] **Clerk webhooks** configured on each consumer app's Clerk instance → `/api/webhooks/clerk/:appId`, with per-app signing secrets set as `CLERK_WEBHOOK_SECRET__<APPID>`.
- [ ] **Microsoft Graph application permissions** consented for the Orbit API managed identity: `GroupMember.Read.All` (staff RBAC group resolution).
- [ ] Private endpoints for Postgres, Key Vault, App Config; public network access disabled.
- [ ] Cost Management exports + per-RG budgets configured for every tracked `{app, environment}` pair, including `grailbabe-dev`.
- [ ] Diagnostic settings on every monitored RG forwarding to `law-orbit-<env>`.
- [ ] Custom domain `orbit.kinisis.io` bound to Front Door with managed certificate.

---

## 14. Future-State Enhancements

- iOS and Android telemetry ingest (per-app SDKs → Application Insights → Orbit).
- Predictive cost analytics & AI-driven anomaly detection.
- Automated remediation runbooks (Azure Automation / Logic Apps triggered from the Alerts page).
- Microsoft Teams and PagerDuty integrations for two-way alert acknowledgement.
- Two-way ServiceNow integration (acknowledge / resolve from Orbit).
- Historical trend analysis beyond 13 months (would require introducing a time-series store — out of scope for v3).
- Self-service onboarding flow for new `{app, environment}` scopes (new RG + Entra app registration + `<app>-<env>-users` group + tag set + Orbit registry entry in one click).

---

## 15. Conclusion

Orbit v3 is the next evolution of the platform after v2's Kinisis Orbit. It carries forward v1/v2's core principle — **aggregate, never store** — while adding a Cloud Adoption Framework–aligned subscription, resource-group, and tagging scheme, consumer end-user engagement visibility via Clerk webhooks, and the lone new persisted data category needed to support it (anonymous Clerk activity rollups — opaque ids + timestamps, no PII). With the single corporate Entra tenant as the only identity provider for the entire internal platform, the naming applied in §5.1, the resources in §5 provisioned, and the checklist in §13 completed, Orbit is ready to be the single operational pane of glass for every Kinisis-hosted application.
