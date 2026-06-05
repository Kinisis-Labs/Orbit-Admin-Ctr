---
name: SWA CI deploy
description: Durable rules for deploying Azure Static Web Apps in this repo without portal/GitHub-App linkage.
---

## Core rule

Deploy via **SWA CLI** with a token fetched at runtime — NOT `Azure/static-web-apps-deploy@v1`.

**Why:** Portal-linked SWAs enforce OIDC validation against the Azure Static Web Apps GitHub App. If the GitHub App was never authorized (e.g. the Azure-generated workflow's first run failed before Oryx upload), the content service is unregistered and every deploy returns `BadRequest` regardless of token. Deleting and recreating the SWA without `--source` skips the GitHub App registration entirely.

**How to apply:** Any time the SWA deploy workflow fails with `BadRequest` / "No matching Static Web App found", check whether the SWA was portal-linked. If so, delete+recreate without `--source` and switch to the SWA CLI pattern below.

## Working workflow pattern

```yaml
- uses: azure/login@v2
  with: { client-id, tenant-id, subscription-id }

- id: swa-token
  run: |
    TOKEN=$(az staticwebapp secrets list --name swa-orbit-prod \
      --resource-group rg-orbit-prod-eus2 --query "properties.apiKey" -o tsv)
    echo "::add-mask::$TOKEN"
    echo "token=$TOKEN" >> "$GITHUB_OUTPUT"

- uses: Azure/static-web-apps-deploy@v3
  with:
    azure_static_web_apps_api_token: ${{ steps.swa-token.outputs.token }}
    action: upload
    app_location: artifacts/orbit/dist/public
    skip_app_build: true
    skip_api_build: true
    output_location: ""
```

**Do NOT use `@azure/static-web-apps-cli`** — both 1.x (including 1.1.10) and 2.x fail with "Could not find StaticSitesClient local binary" because they download a runtime binary from `swalocaldeploy.azureedge.net` which is unreliable from GitHub Actions runners. The `Azure/static-web-apps-deploy@v3` action uses a Node-based upload path and avoids this CDN entirely.

## Recreating a broken SWA

```bash
az staticwebapp delete --name swa-orbit-prod --resource-group rg-orbit-prod-eus2 --yes
az staticwebapp create --name swa-orbit-prod --resource-group rg-orbit-prod-eus2 \
  --location "eastus2" --sku Standard
# No --source = no GitHub App link = token-only deploys work
```

After recreation the hostname changes (new random suffix) — update the Front Door SWA origin to match.

## Front Door + custom domain

`orbit.kinisislabs.com` requires `orbit.kinisislabs.com` to be associated with Front Door **routes** (not just registered as a domain). Each route (frontend `/*` and API `/api/*`) must list the custom domain alongside the default `.azurefd.net` domain or requests for it won't match.

The SWA also needs the custom domain registered under its Custom Domains blade. Use the "Azure Front Door" type (not "Custom domain" / TXT-record type) so the SWA trusts the `X-Azure-FDID` from `afd-shared-prod`. If the AFD option isn't shown in the portal, re-add from the Front Door side instead.
