# Orbit — Requirements Specification

**Version:** 1.0
**Status:** Draft
**Owner:** Platform Engineering
**Companion to:** `docs/architecture-spec.md` (v3)

This document specifies **what** Orbit must do. The architecture spec covers **how** it is built and deployed. Where the two disagree, this document defines product intent and the architecture spec defines implementation.

---

## 1. Purpose and Scope

### 1.1 Purpose

Orbit ("Orbit") is the single internal admin centre for every Kinisis-operated application. It gives engineering, operations, and FinOps a unified, real-time view of Azure infrastructure, application health, alerts, cost, and end-user engagement across every Kinisis app and every environment (prod / staging / dev).

### 1.2 In scope

- Live aggregation and presentation of operational data from Azure (Resource Graph, Monitor, Log Analytics, Network Watcher, Application Insights, Cost Management).
- Live aggregation of per-app employee activity from Microsoft Entra (one app registration + security group per `{app, environment}` in the corporate tenant, sign-in log stream via Event Hub, profile lookups via Microsoft Graph).
- Internal-only access governed by Microsoft Entra ID with MFA, RBAC, and Conditional Access.
- A FinOps boundary that segregates cost data from operational data by RBAC group.
- Per-environment scoping: prod and non-prod of the same app are independent first-class scopes.
- Stub surfaces for adjacent systems (ServiceNow incidents, future iOS/Android telemetry) so they have a recognised home in the UI.

### 1.3 Out of scope

- Long-term storage of telemetry, logs, customer data, or cost line items. Orbit aggregates, never warehouses.
- Authoring Azure Monitor alert rules, ServiceNow incidents, or budgets. Orbit reads and acknowledges; the systems of record stay where they are.
- Customer-facing surfaces. The entire Kinisis platform — Orbit *and* every app it monitors — is internal-only. No public or anonymous access anywhere.
- Mobile (iOS/Android) telemetry ingestion (deferred to v4).
- Two-way ServiceNow/PagerDuty actions (deferred).

### 1.4 Non-goals

- Replacing the Azure Portal. Orbit gives a unified, opinionated, Kinisis-shaped view; it does not attempt feature parity with the Portal.
- Acting as a CMDB. The `{app, environment}` registry is the lightweight inventory needed to drive aggregation, not a system of record for asset management.

---

## 2. Stakeholders and Personas

| Persona            | Primary group              | Goals                                                                                                  |
| ------------------ | -------------------------- | ------------------------------------------------------------------------------------------------------ |
| **Operator (SRE)** | `Orbit-Engineers`           | Spot degradations fast, drill into per-app health, acknowledge alerts, see deployments and incidents.  |
| **App Engineer**   | `Orbit-Authorized-Users`    | Check the status of their own app, find the failing component, jump to logs.                           |
| **FinOps / Finance** | `Orbit-Cost-Readers`, `Orbit-FinOps` | Track MTD spend, forecasts, and budget burn per app and per environment. Set / monitor budgets. |
| **Platform Admin** | `Orbit-Admins`              | Manage feature flags, simulate group membership, review the audit log, onboard new apps/envs.          |
| **Product / Growth** | `Orbit-Authorized-Users`  | Read DAU/WAU/MAU and stickiness per app to inform product decisions.                                   |
| **Security / Compliance** | `Orbit-Admins`         | Verify the FinOps boundary holds, audit privileged actions, confirm PII handling.                      |

---

## 3. Glossary

| Term            | Definition                                                                                                            |
| --------------- | --------------------------------------------------------------------------------------------------------------------- |
| **Scope**       | An `{app, environment}` pair (e.g. `grailbabe-prod`, `grailbabe-dev`). The unit of isolation throughout the product. |
| **Global view**  | The default scope; aggregates across every tracked `{app, environment}` pair.                                        |
| **Tracked app**  | A `{app, environment}` row in the inventory (see §6 in `architecture-spec.md`).                                      |
| **FinOps boundary** | The runtime + UI rules that prevent cost data from appearing anywhere outside `Orbit-Cost-Readers`.                 |
| **App user group** | One Entra security group per `{app, environment}`, named `<app>-<env>-users` (in the corporate tenant). The source of truth for engagement. |
| **Aggregate, never store** | Orbit's foundational rule: data is queried live from authoritative sources at request time and is not persisted (the only exception is the user-activity rollup; see §6.10). |

---

## 4. Assumptions and Dependencies

1. Microsoft Entra ID is the sole identity provider. Conditional Access, MFA, and group membership are all configured before Orbit goes live.
2. Every tracked app already forwards Activity Log, Application Insights, and Cost Management exports into a Log Analytics workspace Orbit can query.
3. Every tracked app already authenticates its users via its dedicated app registration in the corporate Entra tenant (a precondition for the Users & activity page). All tracked apps are employee-only; none are customer-facing.
4. Cost Management exports tag every resource with `workload` + `environment` per the architecture spec §5.1.
5. ServiceNow exposes a read API for the engineering instance the Incidents page will integrate with.
6. The Azure subscription topology in `architecture-spec.md` §5.2 is provisioned (subscriptions, RGs, tag policy) before Orbit's API roles are bound.

---

## 5. High-Level Capabilities

| #  | Capability                  | Description                                                                                                       |
| -- | --------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| C1 | Unified Home dashboard      | Status-only org-wide view: app count, global health, active alerts, active regions, App Services table.           |
| C2 | Per-app blade               | Azure-portal-styled app detail with Overview / Infrastructure / Network / Telemetry / Cost / Alerts tabs.         |
| C3 | Scope selector              | Switch between Global and any single `{app, environment}` from anywhere.                                          |
| C4 | Alerts                      | Centralised severity-tiered list of active alerts from Azure Monitor, App Insights, and per-app telemetry APIs.   |
| C5 | Deployments                 | Per-app deployment history (release id, env, status, started/finished, who triggered it).                          |
| C6 | Incidents (stub)            | Read-only surface for ServiceNow tickets affecting tracked apps; placeholder until the integration ships.         |
| C7 | Activity log                | Azure Activity Log slice for the selected scope.                                                                  |
| C8 | Health & SLOs               | Per-app SLO/SLI display (availability, latency, error budget burn).                                              |
| C9 | Network                     | Latency, packet loss, NSG/flow-log highlights from Network Watcher.                                              |
| C10 | Log search                 | KQL search UI bound to per-app Log Analytics workspaces.                                                          |
| C11 | Service health             | Azure Service Health advisories filtered to services Orbit + tracked apps depend on.                              |
| C12 | Users & activity           | DAU/WAU/MAU/stickiness per app from Entra sign-in logs; recent users roster; state Active/Idle/Inactive.          |
| C13 | Cost Management            | MTD spend, forecasts, daily spend chart, per-API allocation, revenue by channel. Gated by `Orbit-Cost-Readers`.   |
| C14 | Budgets                    | Per-RG budgets, thresholds, burn %. Gated by `Orbit-Cost-Readers`.                                                |
| C15 | Forecasts                  | 30/60/90 day cost forecasts. Gated by `Orbit-Cost-Readers`.                                                       |
| C16 | Subscriptions              | Read-only listing of Azure subscriptions Orbit aggregates from.                                                  |
| C17 | Tags                       | Tag inventory across tracked apps; surfaces tag-policy compliance.                                               |
| C18 | Identity & access          | Display of Entra groups governing Orbit; simulator for toggling `Orbit-Cost-Readers` in dev.                       |
| C19 | All resources              | Resource Graph–backed inventory of every Azure resource in tracked RGs.                                          |
| C20 | Preferences                | Per-user UI preferences (theme, scope default, density) persisted in the browser.                                |

---

## 6. Functional Requirements

Each requirement is identified `FR-<area>-<n>` and is **MUST** unless flagged otherwise.

### 6.1 Authentication & Session

- **FR-AUTH-1** Orbit MUST authenticate every user via Microsoft Entra ID OIDC with PKCE.
- **FR-AUTH-2** MFA MUST be enforced via Conditional Access; Orbit MUST NOT offer a local-account fallback.
- **FR-AUTH-3** Membership of `Orbit-Authorized-Users` MUST be confirmed before any page renders. Users without it MUST see an Azure-styled access-denied screen.
- **FR-AUTH-4** Group memberships MUST be cached in Postgres for ≤5 minutes and refreshed on cache miss.
- **FR-AUTH-5** Sessions MUST be HttpOnly, Secure, SameSite=Lax, signed with `SESSION_SECRET`, and idle-timeout after 60 minutes.
- **FR-AUTH-6** Sign-out MUST revoke the session server-side and redirect to the Entra logout endpoint.
- **FR-AUTH-7 (dev only)** An identity simulator MUST allow Platform Admins to toggle in/out of `Orbit-Cost-Readers` for testing the FinOps boundary without an Entra round-trip. The simulator MUST be disabled in production builds.

### 6.2 Scope Selector

- **FR-SCOPE-1** Every page that displays per-app data MUST expose a scope selector with options: `Global — All Applications` and one entry per tracked `{app, environment}`.
- **FR-SCOPE-2** The selected scope MUST persist across navigation within a session.
- **FR-SCOPE-3** When the user navigates into a per-app blade (`/apps/<id>`), the scope MUST auto-set to that app and revert on exit.
- **FR-SCOPE-4** Pages that are inherently global (Subscriptions, Tags, Identity & access, Preferences) MUST hide the scope selector.

### 6.3 Home Dashboard

- **FR-HOME-1** Home MUST display four KPI tiles: Total Applications, Global Health (counts of healthy / degraded / unhealthy), Active Alerts (sum across scope), Active Regions.
- **FR-HOME-2** Home MUST display an App Services table: Name (link to per-app blade), Status pill, Environment, Location, Alerts count.
- **FR-HOME-3** Status pill colours MUST follow Azure semantics: Healthy = green, Degraded = orange, Unhealthy = red.
- **FR-HOME-4** Home MUST NOT display any cost or revenue figures, regardless of caller identity (FinOps boundary).
- **FR-HOME-5** Refresh, Add filter, and Export controls MUST be present in the table command bar.

### 6.4 Per-App Blade

- **FR-APP-1** The per-app blade MUST render a left-rail layout with tabs: Overview, Infrastructure, Network, Telemetry, Cost (gated), Alerts.
- **FR-APP-2** The command bar MUST expose Start / Restart / Stop / Configuration actions; the actions MAY be stubbed in v3 but MUST be wired to the audit log.
- **FR-APP-3** Overview MUST show: status pill, environment, location, subscription, resource group, tags, active alert count, last deployment, last incident.
- **FR-APP-4** Infrastructure MUST list the Azure resources in the app's RG via Resource Graph.
- **FR-APP-5** Cost tab MUST be gated by `Orbit-Cost-Readers`; non-members MUST see a lock icon on the tab and an access-denied panel if they navigate to it directly.

### 6.5 Alerts

- **FR-ALERTS-1** Alerts MUST display severity, source, title, app, age, status.
- **FR-ALERTS-2** Severity MUST use four tiers: Sev 0 (critical), Sev 1 (high), Sev 2 (medium), Sev 3 (low).
- **FR-ALERTS-3** Filters MUST include severity, status, app, source, and a free-text search.
- **FR-ALERTS-4** Acknowledging an alert MUST be audit-logged (action, actor, alert id, prior state).

### 6.6 Deployments / Activity log / Health / Network / Logs / Service health / Incidents

Each of these surfaces SHARES the following requirements:

- **FR-OPS-1** Respect the global scope selector.
- **FR-OPS-2** Render an Azure-portal-styled `PageHeader` with title + subtitle.
- **FR-OPS-3** Surface "no data" empty states (never blank pages or spinners that never resolve).
- **FR-OPS-4** Be reachable from the left nav under the "Monitoring" group.
- **FR-OPS-5 (Incidents)** MUST display a banner identifying ServiceNow as the system of record and link to the relevant ServiceNow queue.
- **FR-OPS-6 (Logs)** MUST scope KQL queries to the selected app's Log Analytics workspace; Global view fans out across all workspaces with a per-workspace tab.

### 6.7 Cost Management (FinOps-gated)

- **FR-COST-1** Every cost surface (Cost Management, Budgets, Forecasts, per-app Cost tab) MUST be gated by `Orbit-Cost-Readers`.
- **FR-COST-2** When the caller is not in `Orbit-Cost-Readers`, the API MUST short-circuit cost endpoints with HTTP 403 and an `access-denied` payload before any data is fetched from Azure.
- **FR-COST-3** Cost data MUST be allocated per `{workload, environment}` tag pair, so `grailbabe` and `grailbabe-dev` show independent figures.
- **FR-COST-4** Cost Management MUST display: MTD spend, projected month-end, daily spend chart (last 30d), per-API allocation, revenue by channel (Stripe / App Store / Play Store).
- **FR-COST-5** Budgets MUST display: per-RG budget, MTD actuals, burn %, threshold status (Healthy / Warning / Breach).
- **FR-COST-6** Forecasts MUST display 30 / 60 / 90 day projections with confidence bands.
- **FR-COST-7** No cost or revenue numbers MAY appear on the Home dashboard, per-app Overview/Infrastructure/Network/Telemetry/Alerts/Users tabs, or any other surface.

### 6.8 Subscriptions / Tags / Identity & access (Governance)

- **FR-GOV-1** Subscriptions MUST list the seven subscriptions in `architecture-spec.md` §5.2 with name, purpose, owner, status.
- **FR-GOV-2** Tags MUST list the mandatory tags from architecture spec §5.1 and the compliance % per tracked app.
- **FR-GOV-3** Identity & access MUST list the five `Orbit-*` groups, their purpose, and the simulated user's membership (with toggles in dev).

### 6.9 All Resources

- **FR-RES-1** All resources MUST display name, type, resource group, region, subscription, tags.
- **FR-RES-2** Filter by type, region, RG, tag.
- **FR-RES-3** Clicking a row MUST link out to the Azure Portal for that resource.

### 6.10 Users & Activity (new in v3)

- **FR-USERS-1** The Users & activity page MUST be visible to all `Orbit-Authorized-Users` (NOT behind the FinOps boundary).
- **FR-USERS-2** Top tiles MUST show, for the current scope: Total members, DAU, WAU, MAU, DAU/MAU stickiness %.
- **FR-USERS-3** Engagement-by-application table MUST list: app, environment, members, DAU, WAU, MAU, inactive-30d, new-in-last-7d, DAU trend %.
- **FR-USERS-4** Recent users roster MUST list: name + email, app, state (Active / Idle / Inactive), last active, last sign-in, member-since.
- **FR-USERS-5** State definitions: Active = `last_active_at` within 1 day, Idle = within 30 days, Inactive = older.
- **FR-USERS-6** Roster MUST support search (name, email, app) and CSV export of the filtered view.
- **FR-USERS-7** Numbers MUST be computed from the `user_activity` rollup table fed by Entra `SignInLogs` + `NonInteractiveUserSignInLogs` streamed to Event Hub and filtered by `appId`.
- **FR-USERS-8** A banner MUST identify Microsoft Entra as the system of record and link to the corporate tenant in the Entra admin centre.
- **FR-USERS-9** Orbit MUST NOT persist user PII beyond Entra `objectId`, display name, email, last-active timestamp; the full user record is read on demand from Microsoft Graph (`/users/{id}`).

### 6.11 Preferences

- **FR-PREF-1** Users MUST be able to toggle theme (Azure Portal dark / light); preference persists in the browser.
- **FR-PREF-2** Users MAY set a default scope; if unset, Global is the default.

### 6.12 Audit Log

- **FR-AUDIT-1** Every privileged action (alert ack, group simulation toggle, feature-flag change, cost query, user search) MUST be written to `law-orbit-<env>` with: timestamp, actor (Entra OID), action, target, prior state, new state.
- **FR-AUDIT-2** Audit entries MUST be retained for 13 months minimum.

---

## 7. Non-Functional Requirements

### 7.1 Performance

- **NFR-PERF-1** Home dashboard p95 time-to-interactive ≤ 2.5 s on a warm cache, ≤ 5 s cold.
- **NFR-PERF-2** Per-app blade p95 ≤ 3 s warm.
- **NFR-PERF-3** API endpoints p95 ≤ 800 ms server time, excluding upstream Azure latency.
- **NFR-PERF-4** Pages MUST render a skeleton state within 200 ms of route change; never a blank screen.

### 7.2 Availability

- **NFR-AVAIL-1** Orbit availability target: 99.5 % monthly (planned maintenance excluded). Non-prod has no SLO.
- **NFR-AVAIL-2** No single Azure region failure SHOULD take Orbit fully offline; Front Door MUST be the entry point.

### 7.3 Security

- **NFR-SEC-1** All traffic MUST be HTTPS, HSTS preloaded, TLS 1.2+ at Front Door.
- **NFR-SEC-2** Azure tokens MUST NEVER be issued to the browser; all Azure calls use the API's managed identity.
- **NFR-SEC-3** Microsoft Graph access MUST use the API's managed identity with the minimum application permissions (`GroupMember.Read.All`, `User.Read.All`, `AuditLog.Read.All`, `Application.Read.All`); no static keys. Event Hub consumer credentials MUST live in Key Vault and be rotated automatically.
- **NFR-SEC-4** Public network access MUST be disabled on Postgres, Key Vault, App Configuration; access via private endpoints only.
- **NFR-SEC-5** WAF MUST be enabled on Front Door with the OWASP managed ruleset.
- **NFR-SEC-6** Penetration test MUST be passed before each major version GA.

### 7.4 Privacy and Data Handling

- **NFR-PRIV-1** No customer (end-user-of-Kinisis-app) PII is persisted in Orbit beyond §6.10 FR-USERS-9.
- **NFR-PRIV-2** No payment or financial PII is processed by Orbit.
- **NFR-PRIV-3** Data residency: all Orbit data stays in the customer's chosen Azure geography (default `eastus2`).

### 7.5 Accessibility

- **NFR-A11Y-1** WCAG 2.1 AA conformance for keyboard navigation, focus order, colour contrast.
- **NFR-A11Y-2** All interactive elements MUST have accessible names; status pills MUST not rely on colour alone.

### 7.6 Browser Support

- **NFR-BROWSER-1** Latest two versions of Chrome, Edge, Firefox, Safari on desktop.
- **NFR-BROWSER-2** Tablet (≥ 768 px) MUST render usefully; mobile is out of scope.

### 7.7 Observability

- **NFR-OBS-1** Every API request MUST be logged with request id, method, path, status, latency to `appi-orbit-<env>`.
- **NFR-OBS-2** Orbit MUST emit business KPIs to its own App Insights instance (active users, scope distribution, page load times, gated-page denials).

### 7.8 Localisation

- English-only at v3. The string layer MUST be extractable so a future localisation pass is mechanical.

---

## 8. Data Requirements

### 8.1 Persisted data (Orbit-owned)

The only data Orbit persists in `psql-orbit-<env>`:

| Table                  | Purpose                                                                          | Retention   |
| ---------------------- | -------------------------------------------------------------------------------- | ----------- |
| `sessions`             | Server-side session store                                                        | Idle 60 min |
| `group_cache`          | Cached Entra group memberships                                                   | ≤5 min      |
| `audit_log`            | Privileged actions (§6.12)                                                       | 13 months   |
| `feature_flags`        | Per-tenant feature flag values                                                   | Lifetime    |
| `user_activity`        | Append-only Entra sign-in events (`app_id`, `env`, `user_object_id`, `event_type`, `occurred_at`) | 13 months |

### 8.2 Aggregated data (read live, never stored)

Telemetry, alerts, deployment history, log entries, cost line items, resource inventory, ServiceNow tickets, end-user profile fields (read live from Microsoft Graph).

### 8.3 Data classification

| Data category                | Classification | Where it lives                  |
| ---------------------------- | -------------- | ------------------------------- |
| Session                      | Confidential   | Orbit Postgres                  |
| Audit log                    | Confidential   | Orbit Postgres + Log Analytics  |
| Group cache                  | Internal       | Orbit Postgres                  |
| User activity events         | Internal       | Orbit Postgres                  |
| Azure telemetry              | Internal       | Azure (read live)               |
| Cost data                    | Confidential   | Azure (read live, FinOps-gated) |
| Employee PII (Entra users)   | Confidential   | Corporate Entra tenant (read live on demand via Graph) |

---

## 9. External Interfaces

### 9.1 Inbound (consumed by Orbit)

| System / API                     | Purpose                                                  | Auth                                |
| -------------------------------- | -------------------------------------------------------- | ----------------------------------- |
| Microsoft Entra ID (OIDC)        | User sign-in, MFA, ID tokens                             | OIDC + Conditional Access           |
| Microsoft Graph                  | Staff group membership; end-user rosters, profiles, sign-in activity | Managed identity + app permissions (`GroupMember.Read.All`, `User.Read.All`, `AuditLog.Read.All`, `Application.Read.All`) |
| Azure Resource Graph             | Resource inventory                                       | Managed identity                    |
| Azure Monitor + App Insights     | Metrics, traces, exceptions, availability                | Managed identity                    |
| Azure Log Analytics              | KQL queries against per-app workspaces                    | Managed identity                    |
| Azure Network Watcher            | Latency, packet loss, NSG flow logs                       | Managed identity                    |
| Azure Cost Management            | MTD spend, forecast, line items                           | Managed identity                    |
| ServiceNow (read API)            | Active incident tickets per tracked app                   | OAuth / service account             |
| Entra Sign-In Logs (Event Hub)   | Per-app session events for the user-activity rollup       | Event Hub SAS (from Key Vault)      |

### 9.2 Inbound (push to Orbit)

Orbit exposes **no public webhook endpoints**. End-user activity is ingested by pulling from Azure Event Hub (`evh-orbit-signins-<env>`), which is private-endpoint-only and SAS-restricted. This removes a class of authentication-bypass risk versus public webhook endpoints.

### 9.3 Outbound (future v4)

| Target                         | Purpose                                       |
| ------------------------------ | --------------------------------------------- |
| ServiceNow (write)             | Acknowledge / resolve incidents from Orbit    |
| Microsoft Teams                | Alert push + ack-back                         |
| PagerDuty                      | Alert push + ack-back                         |

---

## 10. Compliance and Audit

- **CMP-1** Orbit's privileged-action audit log (§6.12) MUST be exportable to the SIEM in CEF format.
- **CMP-2** RBAC denials and FinOps boundary violations MUST be logged at WARN level for security review.
- **CMP-3** Annual access review MUST be supported by exporting current `Orbit-*` group membership snapshots.

---

## 11. Acceptance Criteria

Orbit v3 is accepted when:

1. All FR-* requirements pass UAT in the non-prod environment.
2. All NFR-* targets are demonstrated against synthetic load in non-prod.
3. The §13 checklist in `architecture-spec.md` is fully complete.
4. A walkthrough by each persona in §2 confirms their primary goals can be completed without leaving Orbit.
5. The FinOps boundary is verified: a user removed from `Orbit-Cost-Readers` cannot retrieve a single byte of cost data via any UI surface or any direct API request.
6. The Users & activity page reflects real Entra sign-in activity for at least one tracked app for ≥7 days.

---

## 12. Release Plan

| Phase           | Scope                                                                                       | Gate                                  |
| --------------- | ------------------------------------------------------------------------------------------- | ------------------------------------- |
| **Phase 0 — Mocked** _(current)_ | All UI surfaces backed by deterministic mock data in the API. No external integrations live. | Internal demo, design sign-off.       |
| **Phase 1 — Azure read-only**    | Resource Graph + Monitor + Cost Management + Log Analytics wired live, replacing mocks.        | UAT in non-prod by SRE + FinOps.      |
| **Phase 2 — Entra live**         | Per-app app registrations + `<app>-<env>-users` groups created in the corporate tenant, Event Hub sign-in stream consumed into `user_activity`, Users page live. | UAT by Product / Growth.              |
| **Phase 3 — Incidents live**     | ServiceNow read integration replaces the stub.                                                 | UAT by Operations.                    |
| **Phase 4 — GA**                 | Pen test passed, custom domain bound, prod RBAC migrated off the dev simulator.                | Sign-off by Platform Eng + Security.  |

---

## 13. Open Questions

1. Final custom domain — `orbit.kinisis.io` vs `orbit.kinisis.internal`?
2. Should the simulator be available to Platform Admins in non-prod, or strictly dev-only?
3. Does Atlas CMS get promoted to its own prod env in v3, or stays staging-only?
4. Budget thresholds — global default % values, or always set per app by FinOps?
5. KQL query timeouts — server-side cap, or pass through Log Analytics' default?

---

## 14. Revision History

| Version | Date       | Author              | Summary                                  |
| ------- | ---------- | ------------------- | ---------------------------------------- |
| 1.0     | 2026-05-19 | Platform Engineering | Initial requirements spec, paired with architecture spec v3. |
