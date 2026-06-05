---
name: Azure Container App managed identity setup
description: Three steps required to make DefaultAzureCredential work in Container Apps; arm-resourcegraph v4 AbortSignal bug; fine-grained PAT endpoint note.
---

## Three required steps for managed identity to work in Container Apps

1. **Create** the user-assigned managed identity (`id-orbit-api-prod`) — not enough on its own.
2. **Assign it to the Container App**: Portal → Container Apps → ca-orbit-api-prod → Identity → User assigned → Add. Until this step, the platform never injects `IDENTITY_ENDPOINT`/`IDENTITY_HEADER` into the container, so `DefaultAzureCredential` silently falls through to IMDS (which doesn't exist in Container Apps) and every Azure SDK call fails.
3. **Set `AZURE_CLIENT_ID`** on the container to the managed identity's client ID (Portal → Managed Identities → id-orbit-api-prod → Overview → Client ID). This is **different** from the Entra app registration client ID (`ENTRA_CLIENT_ID`). If they're the same value in diagnostics, `AZURE_MANAGED_IDENTITY_CLIENT_ID` is misconfigured.

**Why:** `DefaultAzureCredential` uses `IDENTITY_ENDPOINT` to detect the App Service/Container Apps credential path. If absent, it falls back to IMDS → "IMDS endpoint is not available" error.

**How to apply:** When Azure SDK calls fail in production with "IMDS endpoint not available", check `IDENTITY_ENDPOINT` in diagnostics first. If unset, the identity isn't attached to the Container App.

## @azure/arm-resourcegraph v4 AbortSignal incompatibility on Node.js 22+

`@azure/arm-resourcegraph@4.x` uses `@azure/core-http` (old HTTP client). Combined with `@azure/identity@4.x` (which uses `@azure/core-rest-pipeline`), this causes "Expected signal to be an instanceof AbortSignal" on Node.js 22+.

**Fix:** Upgrade to `@azure/arm-resourcegraph@5.0.0-beta.4` (latest v5; no stable release as of June 2026). v5 uses `@azure/core-rest-pipeline` consistently. Also update `result.data` casts to go through `unknown` first (`result.data as unknown as Record<string, unknown>[]`) — v5 tightened the return type. Remove `$top` from `ResourcesOptionalParams` calls (renamed in v5).

## Fine-grained PAT for GitHub Actions data

The `ORBIT_DEPLOYMENT_ID` PAT needs `Actions: Read` on `Orbit-Admin-Ctr` and `GrailBabe` repos. The diagnostics check must hit `/repos/{org}/{repo}/actions/runs` — NOT `/repos/{org}/{repo}` (repo metadata requires a different permission scope and returns 403 for Actions-only tokens).

`ORBIT_GITHUB_TOKEN` is a legacy secret name — not referenced anywhere in the codebase; safe to delete.
