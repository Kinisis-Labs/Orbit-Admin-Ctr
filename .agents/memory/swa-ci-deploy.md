---
name: SWA CI deploy
description: How Azure Static Web Apps CI deployment works in this repo — pitfalls and working approach.
---

## The working approach

Deploy via **SWA CLI** (`@azure/static-web-apps-cli`) using a deployment token fetched at runtime from Azure, NOT the `Azure/static-web-apps-deploy@v1` GitHub Action.

```yaml
- name: Login to Azure
  uses: azure/login@v2
  with:
    client-id: ${{ secrets.AZURE_CLIENT_ID }}
    tenant-id: ${{ secrets.AZURE_TENANT_ID }}
    subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID }}

- name: Get SWA deployment token
  id: swa-token
  run: |
    TOKEN=$(az staticwebapp secrets list \
      --name swa-orbit-prod \
      --resource-group rg-orbit-prod-eus2 \
      --query "properties.apiKey" -o tsv)
    echo "::add-mask::$TOKEN"
    echo "token=$TOKEN" >> "$GITHUB_OUTPUT"

- name: Deploy
  run: |
    npm install -g @azure/static-web-apps-cli
    swa deploy artifacts/orbit/dist/public \
      --deployment-token "${{ steps.swa-token.outputs.token }}" \
      --env production \
      --no-use-keychain
```

**Why:** `--env production` is required — in CI, SWA CLI defaults to "preview" environment.

## What failed and why

### `Azure/static-web-apps-deploy@v1` without `github_id_token`
Returns `BadRequest` / "No matching Static Web App found or api key invalid."
Portal-linked SWAs enforce OIDC validation — the API token alone isn't enough.

### `github_id_token` via `actions/github-script`
Returns `InternalServerError` / "unexpected error." Root cause: the Azure Static Web Apps GitHub App was not installed/authorized on the repo, so Azure's backend can't call back to GitHub to validate the OIDC token. The Azure-generated workflow's first run (which would have initialized the GitHub App link) failed at Oryx build before reaching the upload step, leaving the content service unregistered.

### SWA CLI with a portal-linked SWA
Also returns `BadRequest` — same OIDC requirement applies at the StaticSitesClient level.

## Recreating a broken SWA

If the content service returns persistent BadRequest/InternalServerError regardless of approach, the SWA resource is in a bad state (management plane created, content service not initialized). Fix: delete and recreate.

```bash
az staticwebapp delete --name swa-orbit-prod --resource-group rg-orbit-prod-eus2 --yes
az staticwebapp create --name swa-orbit-prod --resource-group rg-orbit-prod-eus2 \
  --location "eastus2" --sku Standard
# No --source flag = no GitHub linkage = no OIDC requirement
```

**After recreation:** hostname changes (new random suffix). Must update Front Door origin to the new `*.7.azurestaticapps.net` hostname.

**Why:** `az staticwebapp create` without `--source` skips the GitHub App registration, so the SWA accepts deployments with just the API token. The workflow fetches the token at runtime so no GitHub secrets need updating.

## Race condition on simultaneous runs
If two SWA Deploy runs happen at the same time (push + dispatch), the second gets "Deployment Canceled." Not a real failure — only one push runs at a time in normal operation.
