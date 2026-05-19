# Kinisis Orbit — Architecture Specification

**Version:** 2.0
**Status:** Draft — supersedes _Global App Admin Center (GAAC) Executive Technical Specification v1_
**Owner:** Platform Engineering

> **Rebrand note.** The product previously codenamed **Global App Admin Center (GAAC)** is now **Kinisis Orbit**. Internal identifiers (workspace slug `gaac`, Entra group prefix `GAAC-*`, resource-name prefix `gaac`) are intentionally retained to minimise churn in deployment pipelines, RBAC bindings, and existing Azure resources. Only user-facing surfaces have been rebranded.

---

## 1. Executive Summary

Kinisis Orbit is the centralised admin centre for every Kinisis-operated application. It gives engineers and operators a unified, real-time view of Azure infrastructure, network health, application telemetry, alerts, and cost across all environments (prod, staging, dev) of every Kinisis app from a single Azure Portal–styled dashboard.

The platform aggregates live operational data directly from Azure and per-application telemetry APIs. **No monitoring, telemetry, or customer data is persisted inside Kinisis Orbit** — all data is queried live from authoritative sources at request time.

---

## 2. Objectives

- One pane of glass for every Kinisis-hosted application, across **all environments**.
- Per-environment isolation: `prod` and `dev` (and `staging` where applicable) of the same app are tracked as **independent scopes** with their own status, alerts, infrastructure, and cost.
- Live infrastructure, network, telemetry, and cost visibility — no internal data warehousing.
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
   Azure Front Door / Static Web App  ← Kinisis Orbit web UI (React + Vite + wouter)
            │
            ▼
   Azure Container Apps               ← Kinisis Orbit API (Express 5 / Node 24)
       │
       ├──► Azure Monitor            (infrastructure & app metrics)
       ├──► Azure Resource Graph     (resource inventory & topology)
       ├──► Log Analytics            (logs, KQL queries)
       ├──► Network Watcher          (latency, packet loss, NSG flow logs)
       ├──► Application Insights     (RUM, traces, exceptions)
       ├──► Azure Cost Management    (MTD spend, forecast, per-API allocation)
       ├──► Microsoft Graph          (group membership for RBAC checks)
       └──► Per-app telemetry APIs   (custom KPIs exposed by each app)
```

Frontend and API are deployed as a single logical unit per environment. The API performs all Azure-facing calls server-side via **managed identity**, so no Azure tokens are ever issued to the browser.

---

## 4. Tracked Applications (Tenant Inventory)

Kinisis Orbit treats each `{app, environment}` pair as a first-class **scope**. The seeded inventory is:

| App ID            | Display Name        | Env     | Region     | Resource Group        | Subscription              |
| ----------------- | ------------------- | ------- | ---------- | --------------------- | ------------------------- |
| `grailbabe`       | GrailBabe           | prod    | eastus2    | `rg-grailbabe-prod`   | a1f4-shared-platform      |
| `grailbabe-dev`   | GrailBabe (dev)     | dev     | eastus2    | `rg-grailbabe-dev`    | a1f4-shared-platform      |
| `kinisis-id`      | Kinisis ID          | prod    | eastus2    | `rg-kid-prod`         | a1f4-shared-platform      |
| `ops-portal`      | Ops Portal          | prod    | centralus  | `rg-ops-prod`         | b203-internal-tools       |
| `ledger-api`      | Ledger API          | prod    | westus2    | `rg-ledger-prod`      | c508-finance              |
| `atlas-cms`       | Atlas CMS           | staging | eastus2    | `rg-atlas-stg`        | b203-internal-tools       |

**New in v2:** `grailbabe-dev` is now tracked as a peer of `grailbabe`. Future non-prod environments (e.g. `kinisis-id-dev`, `ledger-api-staging`) will be onboarded by the same pattern — one entry per `{app, environment}` pair, no shared state across environments.

---

## 5. Azure Deployment Architecture

Kinisis Orbit deploys into the **Shared Platform** Azure subscription. v2 introduces an explicit **non-production** deployment to support safe iteration without touching the prod admin centre.

### 5.1 Per-environment resources

Provision the following in **each** environment (`prod` and `nonprod`). Resource names follow the established `*-gaac-<env>` convention.

| Resource Type                    | Prod Name              | Nonprod Name             | Purpose                                                                 |
| -------------------------------- | ---------------------- | ------------------------ | ----------------------------------------------------------------------- |
| Resource Group                   | `rg-gaac-prod`         | `rg-gaac-nonprod`        | Container for all per-env resources                                     |
| Azure Front Door (Standard)      | `afd-gaac-prod`        | `afd-gaac-nonprod`       | TLS termination, WAF, custom domain                                     |
| Static Web App                   | `stapp-gaac-prod`      | `stapp-gaac-nonprod`     | React/Vite frontend hosting                                             |
| Container Apps Environment       | `cae-gaac-prod`        | `cae-gaac-nonprod`       | Runtime for the Express API                                             |
| Container App                    | `ca-gaac-api-prod`     | `ca-gaac-api-nonprod`    | Kinisis Orbit API service                                               |
| Azure Container Registry         | `acrgaac` (shared)     | `acrgaac` (shared)       | API container image registry                                            |
| Azure Database for PostgreSQL    | `psql-gaac-prod`       | `psql-gaac-nonprod`      | Session store, group-cache, audit log (**no telemetry data**)           |
| Key Vault                        | `kv-gaac-prod`         | `kv-gaac-nonprod`        | DB credentials, signing keys, downstream API secrets                    |
| App Configuration                | `appcs-gaac-prod`      | `appcs-gaac-nonprod`     | Feature flags, scoped app inventory                                     |
| Application Insights             | `appi-gaac-prod`       | `appi-gaac-nonprod`      | Telemetry for the Orbit platform itself                                 |
| Log Analytics Workspace          | `law-gaac-prod`        | `law-gaac-nonprod`       | Centralised logs/queries for the Orbit platform                         |
| Storage Account                  | `stgaacprod`           | `stgaacnonprod`          | Static asset overflow, export buckets                                   |
| User-Assigned Managed Identity   | `id-gaac-api-prod`     | `id-gaac-api-nonprod`    | Identity used by the API to call downstream Azure services              |
| Private Endpoint(s)              | `pe-gaac-*-prod`       | `pe-gaac-*-nonprod`      | Private connectivity to Postgres, Key Vault, App Config                 |

### 5.2 New resources required for v2 (delta from v1)

These are items v1 did not call out and must be added before deployment:

1. **Azure Container Apps** environment + Container App for the API.
   v1 specified Azure Functions; the implementation has standardised on a long-lived Express 5 service, so Container Apps is the correct runtime. Functions remain an option for individual event-driven jobs (e.g. scheduled cost-snapshot exports) but are not the primary API host.
2. **Azure Database for PostgreSQL — Flexible Server.**
   Required for session storage, cached Entra group memberships, and the audit log. Provision with HA enabled in prod, single-zone in nonprod. **No monitoring or telemetry data is ever written here** — this is platform-internal state only.
3. **Azure Container Registry** (single, subscription-wide).
   Stores API container images; both prod and nonprod Container Apps pull from the same registry using tagged images.
4. **User-Assigned Managed Identity per environment** for the API.
   Replaces system-assigned identities to keep RBAC bindings stable across container revisions.
5. **Azure Front Door (Standard)** in front of both the Static Web App and the Container App.
   Provides WAF, single custom domain (`orbit.kinisis.internal`), and routing between `/` (frontend) and `/api/*` (backend).
6. **Microsoft Graph application permissions** (`GroupMember.Read.All`).
   Required for live verification of `GAAC-Cost-Readers` membership on each cost-management request.
7. **New Entra security group: `GAAC-Cost-Readers`.**
   Gates all cost surfaces (see §7).
8. **Per-app diagnostic settings.**
   Every tracked `{app, environment}` pair must forward Activity Log, Application Insights, and Cost Management exports to the Orbit Log Analytics workspace so the dashboard can query them via Resource Graph + KQL.
9. **Private endpoints** for Postgres, Key Vault, and App Configuration — public network access disabled.
10. **Budgets & Cost Management exports** scoped per resource group, so the Cost Management page can attribute spend per `{app, environment}` instead of aggregating at the subscription level.

### 5.3 RBAC bindings the API identity needs

Assign to `id-gaac-api-<env>` at the **subscription** scope (or each monitored RG, if subscription-wide is rejected):

- `Reader` — for Resource Graph queries
- `Monitoring Reader` — Azure Monitor + Application Insights
- `Cost Management Reader` — Cost Management API
- `Log Analytics Reader` — KQL queries against per-app workspaces
- `Network Contributor` (read-only via custom role preferred) — Network Watcher data
- `Key Vault Secrets User` — on `kv-gaac-<env>`

---

## 6. Application Architecture (as built)

The repository is a pnpm monorepo with the following deployable artifacts:

| Path                          | Artifact            | Stack                                                  |
| ----------------------------- | ------------------- | ------------------------------------------------------ |
| `artifacts/gaac/`             | Kinisis Orbit web   | React 19, Vite, wouter, TanStack Query, Recharts, Tailwind |
| `artifacts/api-server/`       | Kinisis Orbit API   | Express 5, Node 24, Zod, Drizzle ORM                   |
| `lib/api-spec/`               | OpenAPI contract    | OpenAPI 3 source-of-truth, Orval codegen               |
| `lib/api-zod/`                | Zod schemas         | Generated from OpenAPI                                 |
| `lib/api-client-react/`       | React Query hooks   | Generated from OpenAPI                                 |
| `lib/db/`                     | Drizzle schema      | Postgres schema + migration helpers                    |

**Contract-first.** All HTTP surfaces are defined in `lib/api-spec`, with Zod validators and React Query hooks generated from it. The API server validates every request and response against the same Zod schemas.

**Mocked data layer (current).** All app, telemetry, network, alert, and cost data is currently produced by deterministic seed functions in `artifacts/api-server/src/routes/gaac.ts`. The intent is for those handlers to be replaced one-by-one by live Azure SDK calls without changing the OpenAPI contract.

---

## 7. Security, Identity, and RBAC

- **Authentication:** Microsoft Entra ID (OIDC), MFA enforced via Conditional Access. No local auth, no API keys for end users.
- **Authorisation model:** Group-based. Membership is verified per request via Microsoft Graph (cached in Postgres for ≤5 min).
- **HTTPS-only**, HSTS preload, TLS 1.2+ at Front Door.
- **Managed identity** for all Azure-facing calls — no service principal secrets in code or Key Vault.
- **Audit logging** of every privileged action (group changes, cost queries, alert acknowledgements) to Log Analytics.

### Required Entra security groups

| Group                    | Purpose                                                              |
| ------------------------ | -------------------------------------------------------------------- |
| `GAAC-Authorized-Users`  | Baseline access — required to load Kinisis Orbit at all              |
| `GAAC-Admins`            | Platform administration, group simulation, feature flags             |
| `GAAC-Engineers`         | Operational actions (acknowledge alerts, trigger refresh)            |
| `GAAC-Cost-Readers`      | **NEW in v2** — required to view any cost surface (see §8)           |
| `GAAC-FinOps`            | Cost Management write actions (budgets, allocations) — future use    |

---

## 8. Cost Visibility & FinOps Boundary (new in v2)

v1 surfaced cost data alongside operational telemetry on every page. v2 establishes an explicit FinOps boundary:

- **Cost Management is the only surface that displays cost data.** The Home dashboard, app-detail Overview/Infrastructure/Network/Telemetry/Alerts tabs show no monetary information of any kind, regardless of caller identity.
- The dedicated **Cost Management** page and the per-app **Cost** tab are both gated by membership in `GAAC-Cost-Readers`. Users without that group see an Azure-styled access-denied panel and a lock icon on the navigation entry / tab.
- Cost queries are short-circuited at the API layer when the caller is not in `GAAC-Cost-Readers`, so cost data never crosses the wire to unauthorised browsers.
- Cost is allocated per `{app, environment}` resource group, so `grailbabe` (prod) and `grailbabe-dev` show independent MTD spend, forecast, and budget burn.

---

## 9. Dashboard Capabilities (as built)

- **Scope selector** — Global view, or scoped to any single `{app, environment}` (e.g. GrailBabe prod vs GrailBabe dev).
- **Home (status-only):** Total Applications, Global Health (healthy/degraded/unhealthy), Active Alerts, Active Regions; App Services table with status, environment, location, alert count.
- **Per-app blade (Azure-portal styled):** Overview / Infrastructure / Network / Telemetry / Cost / Alerts tabs, with Azure-style command bar (Start / Restart / Stop / Configuration).
- **Alerts:** centralised list with severity, source, age, status; filterable by app and scope.
- **Cost Management:** MTD spend, forecast, daily spend chart, per-API allocation, budget tracking, revenue by channel (Stripe / App Store / Play Store) — all gated by `GAAC-Cost-Readers`.
- **Theme:** Azure Portal dark/light, persisted per user.
- **Identity simulator (dev only):** the avatar menu lets engineers toggle in/out of `GAAC-Cost-Readers` to exercise the gated surfaces without an Entra round-trip.

---

## 10. Alerting & Incident Sources

| Source                  | Monitoring area                                  |
| ----------------------- | ------------------------------------------------ |
| Azure Monitor           | Infrastructure & app health                      |
| Log Analytics           | Operational & network logs (KQL)                 |
| Network Watcher         | Connectivity, latency, packet loss               |
| Azure Cost Management   | Budget breaches, cost anomalies                  |
| Application Insights    | App performance, exceptions, availability        |
| Per-app telemetry APIs  | Custom app-defined health & KPI signals          |

All alerts are read live; Orbit does not own alert rules — those remain in each app's Azure Monitor configuration. Orbit only aggregates and presents.

---

## 11. Data-Flow Model

```
Operator opens Kinisis Orbit
        ↓
Entra ID SSO + MFA + group check (GAAC-Authorized-Users)
        ↓
Selects scope (Global or a specific {app, environment})
        ↓
Express API (managed identity) queries Azure APIs in parallel
        ↓
Responses validated against Zod schemas
        ↓
Unified dashboard rendered in the browser
```

**No monitoring data, telemetry history, customer data, or cost line items are persisted by Kinisis Orbit.** The only persisted state is platform-internal: sessions, cached group membership, audit log, feature flags.

---

## 12. Deployment Checklist (delta from v1)

Before promoting v2 to production, the following must be in place:

- [ ] `rg-gaac-nonprod` resource group + all per-env resources from §5.1 provisioned.
- [ ] Azure Container Apps environment + Container App for the API in both envs.
- [ ] PostgreSQL Flexible Server provisioned in both envs with HA on prod.
- [ ] Azure Container Registry created and CI/CD wired up to publish API images.
- [ ] User-assigned managed identities created and assigned the RBAC roles in §5.3.
- [ ] Front Door created with `/api/*` routing rule + WAF policy.
- [ ] Entra group `GAAC-Cost-Readers` created and populated with FinOps & engineering leads.
- [ ] Microsoft Graph `GroupMember.Read.All` consented for the Orbit app registration.
- [ ] Private endpoints for Postgres, Key Vault, App Config; public network access disabled.
- [ ] Cost Management exports + per-RG budgets configured for every tracked `{app, environment}` pair, including `grailbabe-dev`.
- [ ] Diagnostic settings on every monitored RG forwarding to `law-gaac-<env>`.
- [ ] Custom domain `orbit.kinisis.internal` bound to Front Door with managed certificate.

---

## 13. Future-State Enhancements

- iOS and Android telemetry ingest (per-app SDKs → Application Insights → Orbit).
- Predictive cost analytics & AI-driven anomaly detection.
- Automated remediation runbooks (Azure Automation / Logic Apps triggered from the Alerts page).
- Microsoft Teams and PagerDuty integrations for two-way alert acknowledgement.
- Historical trend analysis (would require introducing a time-series store — out of scope for v2).
- Self-service onboarding flow for new `{app, environment}` scopes.

---

## 14. Conclusion

Kinisis Orbit v2 is the production-grade evolution of GAAC. It carries forward v1's core principle — **aggregate, never store** — while adding per-environment scoping, a hard FinOps boundary around cost data, a non-production deployment, and the Azure infrastructure required to host an Express-based API on managed identity. With the resources in §5 provisioned and the checklist in §12 completed, Kinisis Orbit is ready to be the single operational pane of glass for every Kinisis-hosted application.
