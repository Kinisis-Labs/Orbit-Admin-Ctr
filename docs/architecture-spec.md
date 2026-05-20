# Orbit Command Center — Architecture Specification

**Version:** 3.0
**Status:** Draft — supersedes _Kinisis Orbit Architecture Specification v2_
**Owner:** Platform Engineering

> **Rebrand note.** The product previously codenamed **Global App Admin Center (GAAC)** and then **Kinisis Orbit** is now **Orbit Command Center** (or "Orbit" for short). All user-facing copy, Azure resource names, and Entra security groups have been renamed to the `orbit` / `Orbit-*` convention as part of v3 (see §5 and §7). A small number of internal workspace filenames (e.g. `artifacts/gaac/`, `routes/gaac.ts`) remain pending a structural rename in a follow-up.

---

## 1. Executive Summary

Orbit Command Center is the centralised admin centre for every Kinisis-operated application. It gives engineers and operators a unified, real-time view of Azure infrastructure, network health, application telemetry, alerts, cost, and end-user engagement across all environments (prod, staging, dev) of every Kinisis app from a single Azure Portal–styled dashboard.

The platform aggregates live operational data directly from Azure, Clerk, and per-application telemetry APIs. **No monitoring, telemetry, end-user, or customer data is persisted inside Orbit** — all data is queried live from authoritative sources at request time.

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
       ├──► Microsoft Graph           (group membership for RBAC checks)
       ├──► Clerk Backend API         (Organizations, members, users)         ← new in v3
       ├──► Clerk Webhooks            (session / user events → Orbit DB)      ← new in v3
       └──► Per-app telemetry APIs    (custom KPIs exposed by each app)
```

Frontend and API are deployed as a single logical unit per environment. The API performs all Azure-facing calls server-side via **managed identity**, so no Azure tokens are ever issued to the browser. Clerk credentials are held in Key Vault and never reach the browser.

---

## 4. Tracked Applications (Tenant Inventory)

Orbit treats each `{app, environment}` pair as a first-class **scope**, a first-class Clerk **Organization**, and a first-class Cost-Management tag pair. The seeded inventory is:

| App ID            | Display Name      | Env     | Region    | Resource Group              | Subscription                    | Clerk Org           |
| ----------------- | ----------------- | ------- | --------- | --------------------------- | ------------------------------- | ------------------- |
| `grailbabe`       | GrailBabe         | prod    | eastus2   | `rg-grailbabe-prod-eus2`    | `sub-kinisis-platform-prod`     | `grailbabe-prod`    |
| `grailbabe-dev`   | GrailBabe (dev)   | dev     | eastus2   | `rg-grailbabe-dev-eus2`     | `sub-kinisis-platform-nonprod`  | `grailbabe-dev`     |
| `kinisis-id`      | Kinisis ID        | prod    | eastus2   | `rg-kid-prod-eus2`          | `sub-kinisis-platform-prod`     | `kinisis-id-prod`   |
| `ops-portal`      | Ops Portal        | prod    | centralus | `rg-ops-prod-cus`           | `sub-kinisis-internal-prod`     | `ops-portal-prod`   |
| `ledger-api`      | Ledger API        | prod    | westus2   | `rg-ledger-prod-wus2`       | `sub-kinisis-finance-prod`      | `ledger-api-prod`   |
| `atlas-cms`       | Atlas CMS         | staging | eastus2   | `rg-atlas-stg-eus2`         | `sub-kinisis-internal-nonprod`  | `atlas-cms-stg`     |

**New in v3:** every tracked pair now binds to a real subscription name and a Clerk Organization. v2 placeholder subscription IDs (`a1f4-shared-platform`, `b203-internal-tools`, `c508-finance`) map onto `sub-kinisis-platform-prod`, `sub-kinisis-internal-prod`, and `sub-kinisis-finance-prod` respectively.

Future environments (`kinisis-id-dev`, `ledger-api-stg`, …) onboard by the same pattern — one row per `{app, environment}`, one Clerk Organization, one resource group.

---

## 5. Azure Deployment Architecture

Orbit (the platform) deploys into the **Shared Platform** subscriptions. v3 keeps the v2 prod/nonprod split, formalises the subscription topology, and applies a Cloud Adoption Framework–aligned naming and tagging scheme.

### 5.1 Naming convention (new in v3)

All v3 infrastructure follows Microsoft's [Cloud Adoption Framework](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/azure-best-practices/resource-naming) naming pattern. Adopt these **before** provisioning anything.

Tokens:

- `<workload>` — `orbit`, `grailbabe`, `kid`, `ops`, `ledger`, `atlas`.
- `<env>` — `prod`, `nonprod`, `dev`, `stg`. (`nonprod` is used for shared Orbit infra; apps name their specific env.)
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
| `sub-kinisis-platform-nonprod` | Shared platform non-prod: Orbit nonprod, GrailBabe (dev), per-app dev environments        | Platform Eng   |
| `sub-kinisis-internal-prod`    | Internal tools: Ops Portal, Atlas CMS (when promoted), other staff-only apps              | Internal Tools |
| `sub-kinisis-internal-nonprod` | Internal tools non-prod / staging                                                          | Internal Tools |
| `sub-kinisis-finance-prod`     | Finance-isolated workloads (Ledger API and any future PCI-scoped systems)                 | Finance Eng    |
| `sub-kinisis-finance-nonprod`  | Finance non-prod                                                                           | Finance Eng    |
| `sub-kinisis-sandbox`          | Engineer playground; no production data, no SLAs, auto-shutdown policies                  | Platform Eng   |

### 5.3 Per-environment resources

Provision the following in **each** environment (`prod` and `nonprod`). Resource names follow §5.1.

| Resource Type                    | Prod Name                  | Nonprod Name                  | Purpose                                                                 |
| -------------------------------- | -------------------------- | ----------------------------- | ----------------------------------------------------------------------- |
| Resource Group                   | `rg-orbit-prod-eus2`       | `rg-orbit-nonprod-eus2`       | Container for all per-env resources                                     |
| Azure Front Door (Standard)      | `afd-orbit-prod`           | `afd-orbit-nonprod`           | TLS termination, WAF, custom domain                                     |
| Static Web App                   | `stapp-orbit-prod-eus2`    | `stapp-orbit-nonprod-eus2`    | React/Vite frontend hosting                                             |
| Container Apps Environment       | `cae-orbit-prod-eus2`      | `cae-orbit-nonprod-eus2`      | Runtime for the Express API                                             |
| Container App                    | `ca-orbit-api-prod-eus2`   | `ca-orbit-api-nonprod-eus2`   | Orbit API service                                                       |
| Azure Container Registry         | `acrkinisis01` (shared)    | `acrkinisis01` (shared)       | API container image registry — single, organisation-wide                |
| Azure Database for PostgreSQL    | `psql-orbit-prod-eus2`     | `psql-orbit-nonprod-eus2`     | Sessions, group-cache, audit log, **Clerk user-activity rollups**       |
| Key Vault                        | `kv-orbit-prod-eus2`       | `kv-orbit-nonprod-eus2`       | DB credentials, signing keys, Clerk API key + webhook secret, downstream secrets |
| App Configuration                | `appcs-orbit-prod-eus2`    | `appcs-orbit-nonprod-eus2`    | Feature flags, scoped app inventory                                     |
| Application Insights             | `appi-orbit-prod-eus2`     | `appi-orbit-nonprod-eus2`     | Telemetry for the Orbit platform itself                                 |
| Log Analytics Workspace          | `law-orbit-prod-eus2`      | `law-orbit-nonprod-eus2`      | Centralised logs/queries for the Orbit platform                         |
| Storage Account                  | `storbitprod01`            | `storbitnonprod01`            | Static asset overflow, export buckets                                   |
| User-Assigned Managed Identity   | `id-orbit-api-prod-eus2`   | `id-orbit-api-nonprod-eus2`   | Identity used by the API to call downstream Azure services              |
| Private Endpoint(s)              | `pe-orbit-*-prod-eus2`     | `pe-orbit-*-nonprod-eus2`     | Private connectivity to Postgres, Key Vault, App Config                 |

### 5.4 New resources required for v3 (delta from v2)

These are items v2 did not call out and must be added before deployment:

1. **Subscription topology and tag policy.**
   §5.2 subscriptions created (or existing ones renamed) and §5.1 tag-enforcement Azure Policy assigned at every subscription scope.
2. **Resource-group rename pass.**
   Every existing RG in §4 renamed to the `rg-<workload>-<env>-<region>` pattern; any legacy `-gaac-` named Azure resources re-provisioned (or aliased) under the new `-orbit-` names as part of v3 cutover.
3. **Clerk Backend API integration.**
   Orbit calls Clerk's Backend API for org rosters, user lookups, and active-session counts. Key + webhook signing secret stored in Key Vault.
4. **Clerk webhook receiver** on the Orbit API.
   New endpoint `POST /api/webhooks/clerk` (Svix-signed) consumes `session.created`, `session.ended`, `user.created`, `user.updated`, `user.deleted`, `organizationMembership.created`, `organizationMembership.deleted`.
5. **`user_activity` rollup table** in `psql-orbit-<env>`.
   Schema: `(org_id, user_id, event_type, occurred_at)` with daily materialised views (`dau_by_app`, `wau_by_app`, `mau_by_app`). Retention: 13 months. **The only new persisted data category in v3.**
6. **One Clerk Organization per tracked `{app, environment}`** (§4), named `<app>-<env>`. Each Kinisis app reconfigured to enrol users into its org.
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
| `artifacts/gaac/`             | Orbit web        | React 19, Vite, wouter, TanStack Query, Recharts, Tailwind |
| `artifacts/api-server/`       | Orbit API        | Express 5, Node 24, Zod, Drizzle ORM, Pino             |
| `lib/api-spec/`               | OpenAPI contract | OpenAPI 3 source-of-truth, Orval codegen               |
| `lib/api-zod/`                | Zod schemas      | Generated from OpenAPI                                 |
| `lib/api-client-react/`       | React Query hooks| Generated from OpenAPI                                 |
| `lib/db/`                     | Drizzle schema   | Postgres schema + migration helpers                    |

**Contract-first.** All HTTP surfaces are defined in `lib/api-spec`, with Zod validators and React Query hooks generated from it. The API server validates every request and response against the same Zod schemas.

**Mocked data layer (current).** All app, telemetry, network, alert, cost, and user-activity data is currently produced by deterministic seed functions in `artifacts/api-server/src/routes/gaac.ts` and `artifacts/gaac/src/lib/mock-data.ts`. The intent is for those handlers to be replaced one-by-one by live Azure + Clerk calls without changing the OpenAPI contract.

---

## 7. Security, Identity, and RBAC

- **Authentication:** Microsoft Entra ID (OIDC), MFA enforced via Conditional Access. No local auth, no API keys for end users.
- **Authorisation model:** Group-based. Membership is verified per request via Microsoft Graph (cached in Postgres for ≤5 min).
- **HTTPS-only**, HSTS preload, TLS 1.2+ at Front Door.
- **Managed identity** for all Azure-facing calls — no service principal secrets in code or Key Vault.
- **Clerk Backend API key + webhook secret** held in Key Vault; webhook requests verified with Svix HMAC signatures before any DB write. **(new in v3)**
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

Orbit's **Users & activity** page reports DAU / WAU / MAU, stickiness, inactive-user counts, and a recent-users roster per Kinisis app. Each tracked `{app, environment}` is modelled as a Clerk **Organization** (§4); "Active users for GrailBabe (prod)" = members of `grailbabe-prod` with `last_active_at` in the window.

Data flow:

```
Each Kinisis app (signs users in via Clerk)
        ↓  session.created / user.* webhooks (Svix-signed)
POST /api/webhooks/clerk        ← Orbit API
        ↓
psql-orbit-<env>.user_activity  ← append-only event log, 13-month retention
        ↓
materialised views (dau_by_app, wau_by_app, mau_by_app)
        ↓
GET /api/users/activity, GET /api/users  ← Orbit UI
```

- Orbit does **not** store user PII beyond what's required to render the recent-users table (display name, email, last-active timestamp). The full user record always lives in Clerk; Orbit reads it on demand via the Backend API.
- The Users & activity page is visible to all `Orbit-Authorized-Users`. It is **not** behind the FinOps boundary, because engagement metrics are operational data, not financial data.
- The Recent Users roster respects the global / per-app scope selector, identical to every other Orbit surface.

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
Operator opens Orbit Command Center
        ↓
Entra ID SSO + MFA + group check (Orbit-Authorized-Users)
        ↓
Selects scope (Global or a specific {app, environment})
        ↓
Express API (managed identity) queries Azure + Clerk APIs in parallel
        ↓
Responses validated against Zod schemas
        ↓
Unified dashboard rendered in the browser
```

**No monitoring data, telemetry history, customer data, or cost line items are persisted by Orbit.** The only persisted state is platform-internal: sessions, cached group membership, audit log, feature flags, and the Clerk user-activity rollup table (§9).

---

## 13. Deployment Checklist (delta from v2)

Before promoting v3 to production, the following must be in place (in this order):

- [ ] §5.2 subscriptions created or renamed; §5.1 tag-enforcement Azure Policy assigned at every subscription scope.
- [ ] Resource groups renamed / created per §5.1 for Orbit and every tracked app in §4.
- [ ] `rg-orbit-prod-eus2` and `rg-orbit-nonprod-eus2` populated with all resources in §5.3.
- [ ] Azure Container Apps environment + Container App for the API in both envs.
- [ ] PostgreSQL Flexible Server provisioned in both envs with HA on prod, including the new `user_activity` schema from §5.4.
- [ ] Azure Container Registry (`acrkinisis01`) created; CI/CD publishing API images.
- [ ] User-assigned managed identities created and assigned the §5.5 RBAC roles across **all subscriptions** that host tracked apps.
- [ ] Front Door created with `/api/*` routing rule + WAF policy.
- [ ] Entra group `Orbit-Cost-Readers` created and populated with FinOps & engineering leads.
- [ ] Microsoft Graph `GroupMember.Read.All` consented for the Orbit app registration.
- [ ] **Clerk Organizations** created for every tracked `{app, environment}` (`<app>-<env>`); each Kinisis app reconfigured to enrol users into its org.
- [ ] **Clerk webhook endpoint** registered (`/api/webhooks/clerk`) with signing secret stored in `kv-orbit-<env>`.
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
- Self-service onboarding flow for new `{app, environment}` scopes (new RG + Clerk Org + tag set + Orbit registry entry in one click).

---

## 15. Conclusion

Orbit Command Center v3 is the next evolution of the platform after v2's Kinisis Orbit. It carries forward v1/v2's core principle — **aggregate, never store** — while adding a Cloud Adoption Framework–aligned subscription, resource-group, and tagging scheme, end-user engagement visibility via Clerk Organizations, and the lone new persisted data category needed to support it (the `user_activity` rollup table). With the naming applied in §5.1, the resources in §5 provisioned, and the checklist in §13 completed, Orbit is ready to be the single operational pane of glass for every Kinisis-hosted application.
