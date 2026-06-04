---
name: Azure prod routing gotchas
description: DNS, Front Door, Container App port, and PostgreSQL firewall lessons from getting orbit.kinisislabs.com fully live.
---

## Front Door traffic only works if the DNS CNAME points to Front Door

`orbit.kinisislabs.com` was a CNAME to the SWA default domain (`nice-mushroom-0562a470f.7.azurestaticapps.net`) — bypassing Front Door entirely. All Front Door route priority changes had zero effect until the CNAME was updated to `afd-shared-prod.azurefd.net`.

**Signal:** `x-azure-ref` header absent from responses; Front Door route changes don't take effect.

**Fix:** In the DNS zone for `kinisislabs.com`, set the `orbit` CNAME to the Front Door endpoint hostname (found at Front Door → Overview → Endpoint hostname).

## Front Door route priority: lower number = higher priority

In Azure Front Door Standard/Premium, route matching uses a priority number where **1 = highest priority**. The `/api/*` → Container App route must have a lower priority number than the `/*` → SWA route, otherwise the SWA catches all traffic. Set API route to priority 1, SWA route to priority 2.

## Container App port must match health probe port

The Container Apps environment has startup health probes hardcoded to TCP port 80. If the app runs on 8080, the startup probe kills the container after ~240s even though it briefly appears Running. Fix: set `ENV PORT=80` / `EXPOSE 80` in the Dockerfile and `--target-port 80` in the deploy workflow.

## Azure PostgreSQL Flexible Server firewall blocks GitHub Actions runners

GitHub Actions runners are not Azure IPs, so the default PostgreSQL firewall blocks them. `drizzle-kit push` hangs on "Pulling schema from database..." and times out.

**Fix in CI workflow:** Before migrations, get the runner's public IP via `curl -s https://api.ipify.org` and add a temporary firewall rule with `az postgres flexible-server firewall-rule create`. Use `if: always()` on a cleanup step to delete the rule afterwards.

```yaml
- name: Open PostgreSQL firewall for runner
  uses: azure/cli@v2
  with:
    inlineScript: |
      RUNNER_IP=$(curl -s https://api.ipify.org)
      az postgres flexible-server firewall-rule create \
        --resource-group rg-orbit-prod-eus2 \
        --name pg-orbit-prod \
        --rule-name github-actions-ci \
        --start-ip-address "$RUNNER_IP" \
        --end-ip-address "$RUNNER_IP"

- name: Close PostgreSQL firewall for runner
  if: always()
  uses: azure/cli@v2
  with:
    inlineScript: |
      az postgres flexible-server firewall-rule delete \
        --resource-group rg-orbit-prod-eus2 \
        --name pg-orbit-prod \
        --rule-name github-actions-ci \
        --yes || true
```

## SESSION_SECRET and DATABASE_URL must be in --set-env-vars

`az containerapp update --set-env-vars` **replaces** the entire env var list. Any secret set manually in the Portal will be wiped on the next deploy unless it is also in the workflow's `--set-env-vars`. Both `DATABASE_URL` and `SESSION_SECRET` must be GitHub OrbitProduction environment secrets and referenced in the workflow.
