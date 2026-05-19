# Orbit Command Center — Architecture Specification

**Version:** 3.0
**Status:** Draft — supersedes _Kinisis Orbit Architecture Specification v2_
**Owner:** Platform Engineering

> **Rebrand note.** The product previously codenamed **Global App Admin Center (GAAC)** and then **Kinisis Orbit** is now **Orbit Command Center** (or "Orbit" for short). Internal identifiers (workspace slug `gaac`, Entra group prefix `GAAC-*`) are intentionally retained to minimise churn in deployment pipelines and existing RBAC bindings. **New Azure resources provisioned for v3 use the `orbit` prefix** (see §5). Only user-facing surfaces and net-new infrastructure carry the rebrand.

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
       ├──► Clerk Backend API         (Organizations, members, users)
       ├──► Clerk Webhooks            (session.created / user.* → Orbit DB)
       └──► Per-app telemetry APIs    (custom KPIs exposed by each app)
```

Frontend and API are deployed as a single logical unit per environment. The API performs all Azure-facing calls server-side via **managed identity**, so no Azure tokens are ever issued to the browser. Clerk webhook secrets and the Clerk Backend API key are held in Key Vault.

---

## 4. Naming Conventions (start here)

All v3 infrastructure follows Microsoft's [Cloud Adoption Framework naming and tagging](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/azure-best-practices/resource-naming) conventions. Adopt these **before** provisioning anything.

### 4.1 Tokens

| Token       | Values                                              | Notes                                                       |
| ----------- | --------------------------------------------------- | ----------------------------------------------------------- |
| `<org>`     | `kinisis`                                           | Company prefix. Lowercase, no separators inside the token.  |
| `<workload>`| `orbit`, `grailbabe`, `kid`, `ops`, `ledger`, `atlas` | Short workload code. Matches the app's slug where possible. |
| `<env>`     | `prod`, `nonprod`, `dev`, `stg`                     | `nonprod` covers shared dev/test Orbit infra; apps use the specific env they run in. |
| `<region>`  | `eus2`, `cus`, `wus2`                               | Short Azure region codes (`eastus2`, `centralus`, `westus2`). |
| `<instance>`| `01`, `02`, …                                       | Numeric suffix when more than one of the same resource exists. |

### 4.2 Subscriptions

One subscription per **business purpose**, never per app. This keeps Cost Management exports, policy assignments, and RBAC tractable.

| Subscription Name              | Purpose                                                                                | Owner          |
| ------------------------------ | -------------------------------------------------------------------------------------- | -------------- |
| `sub-kinisis-platform-prod`    | Shared platform: Orbit, Kinisis ID, GrailBabe (prod) and other shared customer-facing apps | Platform Eng   |
| `sub-kinisis-platform-nonprod` | Shared platform non-prod: Orbit nonprod, GrailBabe (dev), per-app dev environments     | Platform Eng   |
| `sub-kinisis-internal-prod`    | Internal tools: Ops Portal, Atlas CMS (when promoted), other staff-only apps           | Internal Tools |
| `sub-kinisis-internal-nonprod` | Internal tools non-prod / staging                                                       | Internal Tools |
| `sub-kinisis-finance-prod`     | Finance-isolated workloads (Ledger API and any future PCI-scoped systems)              | Finance Eng    |
| `sub-kinisis-finance-nonprod`  | Finance non-prod                                                                        | Finance Eng    |
| `sub-kinisis-sandbox`          | Engineer playground; no production data, no SLAs, auto-shutdown policies               | Platform Eng   |

> The v2 placeholder subscription IDs (`a1f4-shared-platform`, `b203-internal-tools`, `c508-finance`) map onto `sub-kinisis-platform-prod`, `sub-kinisis-internal-prod`, and `sub-kinisis-finance-prod` respectively. The mocked Orbit UI will be updated to display these names once the real subscription IDs are issued.

### 4.3 Resource Groups

Pattern: **`rg-<workload>-<env>-<region>`** (lowercase, hyphen-separated).

Rules:
- One RG per `{workload, environment, region}` tuple. Cross-region resources for the same workload live in separate RGs.
- An RG never spans environments.
- The RG name must allow Cost Management to roll up spend cleanly per workload-env — so workload comes before env.

| Workload                   | Prod                       | Non-prod                       | Notes                                       |
| -------------------------- | -------------------------- | ------------------------------ | ------------------------------------------- |
| Orbit (platform itself)    | `rg-orbit-prod-eus2`       | `rg-orbit-nonprod-eus2`        | Hosts everything in §5.1                    |
| Orbit shared / global      | `rg-orbit-shared-eus2`     | —                              | ACR, DNS zones, Front Door (global)         |
| GrailBabe                  | `rg-grailbabe-prod-eus2`   | `rg-grailbabe-dev-eus2`        |                                              |
| Kinisis ID                 | `rg-kid-prod-eus2`         | `rg-kid-dev-eus2` _(future)_   |                                              |
| Ops Portal                 | `rg-ops-prod-cus`          | `rg-ops-dev-cus` _(future)_    | Lives in Internal subscription              |
| Ledger API                 | `rg-ledger-prod-wus2`      | `rg-ledger-dev-wus2` _(future)_| Lives in Finance subscription               |
| Atlas CMS                  | `rg-atlas-prod-eus2` _(future)_ | `rg-atlas-stg-eus2`        | Currently staging only                      |

### 4.4 Resource Naming (general pattern)

Pattern: **`<type>-<workload>-<purpose?>-<env>-<region?>-<instance?>`** using the abbreviations from the CAF cheat-sheet (`afd-`, `stapp-`, `cae-`, `ca-`, `psql-`, `kv-`, `appcs-`, `appi-`, `law-`, `id-`, `pe-`, `pdnsz-`, `vnet-`, `snet-`, `nsg-`).

Storage accounts and ACRs cannot contain hyphens and must be globally unique — use **`<type><workload><env><suffix>`** (e.g. `storbitprod01`, `acrkinisis01`).

### 4.5 Mandatory Tags

Every resource group and every resource that supports tags must carry:

| Tag             | Example                              | Source of truth         |
| --------------- | ------------------------------------ | ----------------------- |
| `workload`      | `orbit`                              | §4.1                    |
| `environment`   | `prod`                               | §4.1                    |
| `owner`         | `platform-eng@kinisis.io`            | Workload registry       |
| `cost-center`   | `cc-1042`                            | Finance system          |
| `data-class`    | `public` / `internal` / `confidential` | Data classification    |
| `criticality`   | `tier-1` / `tier-2` / `tier-3`       | SRE service catalogue   |

Cost Management exports group on `workload` + `environment`, which is what Orbit's per-app cost view depends on. Without these tags, the FinOps boundary in §8 cannot be enforced.

---

## 5. Azure Deployment Architecture

Orbit (the platform) deploys into the **Shared Platform** subscriptions. v3 keeps the v2 prod/nonprod split and applies the §4 naming.

### 5.1 Per-environment resources (Orbit platform)

Provision the following in **each** environment.

| Resource Type                    | Prod                          | Nonprod                          | Subscription                   | Purpose                                                                 |
| -------------------------------- | ----------------------------- | -------------------------------- | ------------------------------ | ----------------------------------------------------------------------- |
| Resource Group                   | `rg-orbit-prod-eus2`          | `rg-orbit-nonprod-eus2`          | platform-prod / platform-nonprod | Container for all per-env resources                                     |
| Azure Front Door (Standard)      | `afd-orbit-prod`              | `afd-orbit-nonprod`              | platform-prod / platform-nonprod | TLS termination, WAF, custom domain                                     |
| Static Web App                   | `stapp-orbit-prod-eus2`       | `stapp-orbit-nonprod-eus2`       | "                              | React/Vite frontend hosting                                             |
| Container Apps Environment       | `cae-orbit-prod-eus2`         | `cae-orbit-nonprod-eus2`         | "                              | Runtime for the Express API                                             |
| Container App                    | `ca-orbit-api-prod-eus2`      | `ca-orbit-api-nonprod-eus2`      | "                              | Orbit API service                                                       |
| Azure Container Registry         | `acrkinisis01` (shared)       | `acrkinisis01` (shared)          | platform-prod (in shared RG)   | API container image registry — single, organisation-wide                |
| Azure Database for PostgreSQL    | `psql-orbit-prod-eus2`        | `psql-orbit-nonprod-eus2`        | "                              | Sessions, group-cache, audit log, **Clerk user-activity rollups**       |
| Key Vault                        | `kv-orbit-prod-eus2`          | `kv-orbit-nonprod-eus2`          | "                              | DB credentials, signing keys, Clerk API key + webhook secret, downstream secrets |
| App Configuration                | `appcs-orbit-prod-eus2`       | `appcs-orbit-nonprod-eus2`       | "                              | Feature flags, scoped app inventory                                     |
| Application Insights             | `appi-orbit-prod-eus2`        | `appi-orbit-nonprod-eus2`        | "                              | Telemetry for the Orbit platform itself                                 |
| Log Analytics Workspace          | `law-orbit-prod-eus2`         | `law-orbit-nonprod-eus2`         | "                              | Centralised logs/queries for the Orbit platform                         |
| Storage Account                  | `storbitprod01`               | `storbitnonprod01`               | "                              | Static asset overflow, export buckets                                   |
| User-Assigned Managed Identity   | `id-orbit-api-prod-eus2`      | `id-orbit-api-nonprod-eus2`      | "                              | Identity used by the API to call downstream Azure services              |
| Private Endpoint(s)              | `pe-orbit-<svc>-prod-eus2`    | `pe-orbit-<svc>-nonprod-eus2`    | "                              | Private connectivity to Postgres, Key Vault, App Config                 |
| Private DNS Zones                | shared, in `rg-orbit-shared-eus2` | shared                       | platform-prod                  | One zone per private-endpoint-capable service                           |

### 5.2 New resources required for v3 (delta from v2)

These are items v2 did not call out and must be added before deployment:

1. **Clerk Backend API integration.**
   Orbit calls Clerk's Backend API (`api.clerk.com`) for org rosters, user lookups, and active-session counts. Key + webhook-signing-secret stored in Key Vault.
2. **Clerk webhook receiver** on the Orbit API.
   New endpoint `POST /api/webhooks/clerk` (Svix-signed) consumes `session.created`, `session.ended`, `user.created`, `user.updated`, `user.deleted`, `organizationMembership.created`, `organizationMembership.deleted`. Writes to the `user_activity` and `user_directory` tables in `psql-orbit-<env>`.
3. **`user_activity` rollup table** in Postgres.
   Schema: `(org_id, user_id, event_type, occurred_at)` with a daily aggregate materialised view (`dau_by_app`, `wau_by_app`, `mau_by_app`). Retention: 13 months, then dropped. This is the **only** new persisted data category in v3.
4. **Subscription naming + tagging applied retroactively** to all existing RGs (§4.2–4.5). Cost Management exports re-scoped to the new tag set.
5. **Clerk Organizations created**, one per tracked `{app, environment}` pair, named `<app>-<env>` (e.g. `grailbabe-prod`, `grailbabe-dev`, `kinisis-id-prod`).

### 5.3 New resources still required from v2 (carried forward)

Reaffirmed; complete before v3 cutover if not already done:

- Azure Container Apps environment + Container App for the API.
- Azure Database for PostgreSQL — Flexible Server, HA on prod.
- Azure Container Registry (`acrkinisis01`) shared across envs.
- User-assigned managed identity per env.
- Azure Front Door (Standard) routing `/` → Static Web App and `/api/*` → Container App.
- Microsoft Graph `GroupMember.Read.All` consented.
- Entra security group `GAAC-Cost-Readers` populated.
- Per-app diagnostic settings forwarding to `law-orbit-<env>`.
- Private endpoints for Postgres, Key Vault, App Config; public network access disabled.
- Budgets + Cost Management exports scoped per `{workload, environment}` tag pair.

### 5.4 RBAC bindings the API identity needs

Assign to `id-orbit-api-<env>` at the **subscription** scope of every subscription that contains a tracked app (platform-prod, platform-nonprod, internal-prod, finance-prod, …). Where subscription-scope is rejected, assign at each monitored RG.

- `Reader` — Resource Graph queries
- `Monitoring Reader` — Azure Monitor + Application Insights
- `Cost Management Reader` — Cost Management API
- `Log Analytics Reader` — KQL queries against per-app workspaces
- `Network Contributor` (read-only via custom role preferred) — Network Watcher data
- `Key Vault Secrets User` — on `kv-orbit-<env>` (own-env only)

---

## 6. Tracked Applications (Tenant Inventory)

Orbit treats each `{app, environment}` pair as a first-class **scope**, a first-class Clerk **Organization**, and a first-class Cost-Management tag pair.

| App ID            | Display Name      | Env     | Region    | Resource Group              | Subscription                    | Clerk Org           |
| ----------------- | ----------------- | ------- | --------- | --------------------------- | ------------------------------- | ------------------- |
| `grailbabe`       | GrailBabe         | prod    | eastus2   | `rg-grailbabe-prod-eus2`    | `sub-kinisis-platform-prod`     | `grailbabe-prod`    |
| `grailbabe-dev`   | GrailBabe (dev)   | dev     | eastus2   | `rg-grailbabe-dev-eus2`     | `sub-kinisis-platform-nonprod`  | `grailbabe-dev`     |
| `kinisis-id`      | Kinisis ID        | prod    | eastus2   | `rg-kid-prod-eus2`          | `sub-kinisis-platform-prod`     | `kinisis-id-prod`   |
| `ops-portal`      | Ops Portal        | prod    | centralus | `rg-ops-prod-cus`            | `sub-kinisis-internal-prod`     | `ops-portal-prod`   |
| `ledger-api`      | Ledger API        | prod    | westus2   | `rg-ledger-prod-wus2`       | `sub-kinisis-finance-prod`      | `ledger-api-prod`   |
| `atlas-cms`       | Atlas CMS         | staging | eastus2   | `rg-atlas-stg-eus2`         | `sub-kinisis-internal-nonprod`  | `atlas-cms-stg`     |

Future non-prod environments (`kinisis-id-dev`, `ledger-api-stg`, …) onboard by the same pattern — one row per `{app, environment}`, one Clerk Organization, one resource group.

---

## 7. Application Architecture (as built)

The repository is a pnpm monorepo with the following deployable artifacts:

| Path                          | Artifact         | Stack                                                  |
| ----------------------------- | ---------------- | ------------------------------------------------------ |
| `artifacts/gaac/`             | Orbit web        | React 19, Vite, wouter, TanStack Query, Recharts, Tailwind |
| `artifacts/api-server/`       | Orbit API        | Express 5, Node 24, Zod, Drizzle ORM, Pino             |
| `lib/api-spec/`               | OpenAPI contract | OpenAPI 3 source-of-truth, Orval codegen               |
| `lib/api-zod/`                | Zod schemas      | Generated from OpenAPI                                 |
| `lib/api-client-react/`       | React Query hooks| Generated from OpenAPI                                 |
| `lib/db/`                     | Drizzle schema   | Postgres schema + migration helpers                    |

**Contract-first.** All HTTP surfaces are defined in `lib/api-spec`, with Zod validators and React Query hooks generated from it.

**Mocked data layer (current).** All app, telemetry, network, alert, cost, and user-activity data is currently produced by deterministic seed functions in `artifacts/api-server/src/routes/gaac.ts` and `artifacts/gaac/src/lib/mock-data.ts`. The intent is for those handlers to be replaced one-by-one by live Azure + Clerk calls without changing the OpenAPI contract.

---

## 8. Security, Identity, and RBAC

- **Authentication:** Microsoft Entra ID (OIDC), MFA enforced via Conditional Access. No local auth, no API keys for end users.
- **Authorisation model:** Group-based. Membership verified per request via Microsoft Graph (cached in Postgres for ≤5 min).
- **HTTPS-only**, HSTS preload, TLS 1.2+ at Front Door.
- **Managed identity** for all Azure-facing calls — no service principal secrets in code or Key Vault.
- **Clerk Backend API key + webhook secret** held in Key Vault; webhook requests verified with Svix HMAC signatures before any DB write.
- **Audit logging** of every privileged action (group changes, cost queries, alert acknowledgements, user-search) to Log Analytics.

### Required Entra security groups

| Group                    | Purpose                                                              |
| ------------------------ | -------------------------------------------------------------------- |
| `GAAC-Authorized-Users`  | Baseline access — required to load Orbit at all                      |
| `GAAC-Admins`            | Platform administration, group simulation, feature flags             |
| `GAAC-Engineers`         | Operational actions (acknowledge alerts, trigger refresh)            |
| `GAAC-Cost-Readers`      | Required to view any cost surface (see §9)                           |
| `GAAC-FinOps`            | Cost Management write actions (budgets, allocations) — future use    |

---

## 9. Cost Visibility & FinOps Boundary

- **Cost Management is the only surface that displays cost data.** Home dashboard and the app-detail Overview / Infrastructure / Network / Telemetry / Alerts / Users tabs show no monetary information of any kind, regardless of caller identity.
- The dedicated **Cost Management** page (Overview / Budgets / Forecasts) and the per-app **Cost** tab are gated by membership in `GAAC-Cost-Readers`. Users without that group see an Azure-styled access-denied panel and a lock icon on the navigation entry / tab.
- Cost queries are short-circuited at the API layer when the caller is not in `GAAC-Cost-Readers`, so cost data never crosses the wire to unauthorised browsers.
- Cost is allocated per `{workload, environment}` tag pair (§4.5), so `grailbabe` (prod) and `grailbabe-dev` show independent MTD spend, forecast, and budget burn.

---

## 10. Users & Activity (new in v3)

Orbit's **Users & activity** page reports DAU / WAU / MAU, stickiness, inactive-user counts, and a recent-users roster per Kinisis app. Data flows:

```
Each Kinisis app (signs users in via Clerk)
        │
        ▼  session.created / user.* webhooks (Svix-signed)
POST /api/webhooks/clerk        ← Orbit API
        │
        ▼
psql-orbit-<env>.user_activity  ← append-only event log, 13-month retention
        │
        ▼
materialised views (dau_by_app, wau_by_app, mau_by_app)
        │
        ▼
GET /api/users/activity, GET /api/users  ← Orbit UI
```

Design rules:
- Each Kinisis app is modelled as a Clerk **Organization** named `<app>-<env>` (§6). "Active users for GrailBabe (prod)" = members of `grailbabe-prod` with `last_active_at` in the window.
- Orbit **does not** store user PII beyond what's required to render the recent-users table (display name, email, last-active timestamp). The full user record always lives in Clerk; Orbit reads it on demand via the Backend API.
- The Users & activity page is visible to all `GAAC-Authorized-Users`. It is **not** behind the FinOps boundary, because engagement metrics are operational data, not financial data.
- The Recent Users roster respects the global / per-app scope selector, identical to every other Orbit surface.

---

## 11. Dashboard Capabilities (as built)

- **Scope selector** — Global view, or scoped to any single `{app, environment}`.
- **Home (status-only):** Total Applications, Global Health, Active Alerts, Active Regions; App Services table with status, environment, location, alert count.
- **Per-app blade (Azure-portal styled):** Overview / Infrastructure / Network / Telemetry / Cost / Alerts tabs, with Azure-style command bar.
- **Monitoring group:** Alerts, Deployments, Incidents (ServiceNow stub), Activity log, Health & SLOs, Network, Log search, Service health, **Users & activity**.
- **Cost group:** Cost Management (Overview / Budgets / Forecasts) — all gated by `GAAC-Cost-Readers`.
- **Governance group:** Subscriptions, Tags, Identity & access.
- **Resources group:** All resources.
- **Settings group:** Preferences.
- **Theme:** Azure Portal dark/light, persisted per user.
- **Identity simulator (dev only):** the avatar menu lets engineers toggle in/out of `GAAC-Cost-Readers` to exercise the gated surfaces without an Entra round-trip.

---

## 12. Alerting & Incident Sources

| Source                  | Monitoring area                                  |
| ----------------------- | ------------------------------------------------ |
| Azure Monitor           | Infrastructure & app health                      |
| Log Analytics           | Operational & network logs (KQL)                 |
| Network Watcher         | Connectivity, latency, packet loss               |
| Azure Cost Management   | Budget breaches, cost anomalies                  |
| Application Insights    | App performance, exceptions, availability        |
| Per-app telemetry APIs  | Custom app-defined health & KPI signals          |
| ServiceNow              | Incident management (live tickets, ack flow)     |

Orbit does not own alert rules or incident state — those remain in each app's Azure Monitor and ServiceNow configuration. Orbit aggregates and presents.

---

## 13. Data-Flow Model

```
Operator opens Orbit Command Center
        ↓
Entra ID SSO + MFA + group check (GAAC-Authorized-Users)
        ↓
Selects scope (Global or a specific {app, environment})
        ↓
Express API (managed identity) queries Azure + Clerk APIs in parallel
        ↓
Responses validated against Zod schemas
        ↓
Unified dashboard rendered in the browser
```

**No monitoring data, telemetry history, customer data, or cost line items are persisted by Orbit.** The only persisted state is platform-internal: sessions, cached group membership, audit log, feature flags, and the Clerk user-activity rollup table (§10).

---

## 14. Deployment Checklist (delta from v2)

Before promoting v3 to production, the following must be in place (in this order):

- [ ] **Naming + subscriptions.** §4.2 subscriptions created or renamed; §4.5 tag policy enforced via Azure Policy (`Require a tag and its value`).
- [ ] **Resource groups renamed / created** per §4.3 for Orbit and every tracked app.
- [ ] `rg-orbit-prod-eus2` and `rg-orbit-nonprod-eus2` populated with all resources in §5.1.
- [ ] Azure Container Apps environment + Container App for the API in both envs.
- [ ] PostgreSQL Flexible Server provisioned in both envs with HA on prod, including the new `user_activity` schema from §5.2.
- [ ] Azure Container Registry (`acrkinisis01`) created; CI/CD publishing API images.
- [ ] User-assigned managed identities created and assigned the §5.4 RBAC roles across **all subscriptions** that host tracked apps.
- [ ] Front Door created with `/api/*` routing rule + WAF policy.
- [ ] Entra group `GAAC-Cost-Readers` created and populated.
- [ ] Microsoft Graph `GroupMember.Read.All` consented for the Orbit app registration.
- [ ] **Clerk Organizations** created for every tracked `{app, environment}` (`<app>-<env>`); each Kinisis app reconfigured to enrol users into its org.
- [ ] **Clerk webhook endpoint** registered (`/api/webhooks/clerk`) with signing secret stored in `kv-orbit-<env>`.
- [ ] Private endpoints for Postgres, Key Vault, App Config; public network access disabled.
- [ ] Cost Management exports + per-RG budgets configured for every tracked `{app, environment}` pair, including `grailbabe-dev`.
- [ ] Diagnostic settings on every monitored RG forwarding to `law-orbit-<env>`.
- [ ] Custom domain `orbit.kinisis.io` bound to Front Door with managed certificate.

---

## 15. Future-State Enhancements

- iOS and Android telemetry ingest (per-app SDKs → Application Insights → Orbit).
- Predictive cost analytics & AI-driven anomaly detection.
- Automated remediation runbooks (Azure Automation / Logic Apps triggered from the Alerts page).
- Microsoft Teams and PagerDuty integrations for two-way alert acknowledgement.
- Two-way ServiceNow integration (acknowledge / resolve from Orbit).
- Historical trend analysis beyond 13 months (requires a time-series store — out of scope for v3).
- Self-service onboarding flow for new `{app, environment}` scopes (new RG + Clerk Org + tag set + Orbit registry entry in one click).

---

## 16. Conclusion

Orbit Command Center v3 carries forward the v1/v2 core principle — **aggregate, never store** — adds end-user engagement visibility via Clerk Organizations, and locks down a Cloud Adoption Framework–aligned naming and tagging scheme that makes Cost Management, RBAC, and Policy assignments tractable as the Kinisis estate grows. With §4 naming applied, the resources in §5 provisioned, and the checklist in §14 completed, Orbit is the single operational pane of glass for every Kinisis-hosted application.
