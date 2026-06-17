# Orbit — Live Data Setup Guide

This document lists every environment variable required to activate each live data source. When any variable is absent the corresponding route falls back to an empty result or a mock/mock-flagged response so local development continues to work. **Production (`NODE_ENV=production`) fails closed on Entra only.**

---

## 1. Microsoft Entra ID (staff authentication)

Required for real sign-in. Without these the app runs in mock/open mode.

| Variable | Description |
|---|---|
| `ENTRA_TENANT_ID` | Bare tenant GUID (no prefix, no whitespace) |
| `ENTRA_CLIENT_ID` | App registration client ID |
| `ENTRA_CLIENT_SECRET` | Client secret (set in your local .env or Azure App Settings) |
| `ENTRA_REDIRECT_URI` | OAuth callback URL (`https://<domain>/api/auth/callback`) |
| `ENTRA_AUTHORIZED_GROUP_ID` | Object ID of `Orbit-Authorized-Users` Entra group |
| `ENTRA_COST_READER_GROUP_ID` | Object ID of `Orbit-Cost-Readers` Entra group |
| `SESSION_SECRET` | Long random string for session cookie signing |

Optional RBAC groups (membership-aware on the Access page):

| Variable | Description |
|---|---|
| `ENTRA_ADMIN_GROUP_ID` | Object ID of `Orbit-Admins` |
| `ENTRA_ENGINEER_GROUP_ID` | Object ID of `Orbit-Engineers` |
| `ENTRA_FINOPS_GROUP_ID` | Object ID of `Orbit-FinOps` |

---

## 2. Azure Data (Resource Graph, Cost Management, Monitor, Service Health)

All Azure data routes are gated by these three variables.

| Variable | Description |
|---|---|
| `AZURE_SUBSCRIPTION_IDS` | Comma-separated list of subscription GUIDs to query |
| `AZURE_CLIENT_ID` | User-assigned managed identity client ID (production) or service-principal client ID (dev) |
| `AZURE_TENANT_ID` | Entra tenant GUID |

When set, `DefaultAzureCredential` picks up the managed identity automatically in Azure. In dev, add `AZURE_CLIENT_SECRET` and `AZURE_CLIENT_ID` / `AZURE_TENANT_ID` for a service principal.

### Per-app subscription IDs

These override the fallback placeholder strings baked into the APPS inventory.

| Variable | App |
|---|---|
| `AZURE_SUB_GRAILBABE` | GrailBabe subscription GUID |
| `AZURE_SUB_ORBIT` | Orbit subscription GUID |
| `AZURE_SUB_KINISIS_LABS` | Kinisis Labs subscription GUID |

### Log Analytics (time-series telemetry + log search)

| Variable | Description |
|---|---|
| `AZURE_LOG_ANALYTICS_WORKSPACE_ID` | Workspace customer ID (GUID shown as "Workspace ID" in the portal — NOT the resource ID) |

Managed identity `id-orbit-api-prod` needs **Log Analytics Reader** on the workspace.

---

## 3. Stripe (GrailBabe revenue)

Live Stripe charges are synced into the ledger at most once every 15 minutes and read on demand from the DB. Only enabled for GrailBabe.

| Variable | Description |
|---|---|
| `STRIPE_SECRET_KEY` | Stripe secret key (set in your local .env or Azure App Settings) |

When absent, revenue in the cost report reads existing ledger entries (zero at startup).

---

## 4. Clerk Webhooks (end-user activity)

One signing secret per tracked Clerk app. The variable name must match the app ID exactly (uppercase).

| Variable | Description |
|---|---|
| `CLERK_WEBHOOK_SECRET__GRAILBABE` | Svix signing secret for the `grailbabe` Clerk app |

Configure the Clerk dashboard to POST `user.*` events to `https://orbit.kinisislabs.com/api/webhooks/clerk/grailbabe`.

---

## 5. GitHub Actions (deployment history)

| Variable | Description |
|---|---|
| `GITHUB_TOKEN` | Personal access token or GitHub Actions token with `repo:read` / `actions:read` scope |

When absent, the `/apps/:appId/deployments` route returns `[]` and the Deployments page shows an empty state.

GitHub org: `Kinisis-Labs`. Per-app repos: `GrailBabe` (grailbabe), `Orbit-Admin-Ctr` (orbit).

---

## 6. Google Play Subscriptions (deferred until GrailBabe launches)

All three vars must be set together to activate the live Play feed. Currently dormant — placeholder data is served when any is absent.

| Variable | Description |
|---|---|
| `GOOGLE_PLAY_SA_EMAIL` | Workload Identity service account email |
| `GOOGLE_PLAY_WIF_AUDIENCE` | Workload Identity Federation audience URL |
| `GOOGLE_PLAY_DEVELOPER_ID` | Google Play developer account ID |

---

## 7. Database

| Variable | Description |
|---|---|
| `DATABASE_URL` | Postgres connection string |
| `DATABASE_SSL` | Set to `true` in production (Azure PostgreSQL Flexible Server requires TLS) |

Run `pnpm --filter @workspace/db run push` against any new environment's database before first use.
