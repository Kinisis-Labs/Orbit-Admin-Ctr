---
name: Azure subscription config pattern
description: How AZURE_SUBSCRIPTION_IDS is wired and the isAzureConfigured() gate pitfall
---

## Rule

`isAzureConfigured()` only checks `AZURE_SUBSCRIPTION_IDS`. Network (and other) Azure queries silently return `null` — appearing as empty — if that var is unset, even when per-app subscription vars (`AZURE_SUB_GRAILBABE`, `AZURE_SUB_SHARED_INFRA`, etc.) are correctly set.

**Why:** `isAzureConfigured()` was written as the sole gate for all Azure calls. Per-app sub vars are used by the APPS inventory to set each app's `subscriptionId` field, but `fetchNetworkEndpoints` (and others) check `isAzureConfigured()` first and bail before ever reading those per-app vars.

**How to apply:**

- In the deploy workflow, compose `AZURE_SUBSCRIPTION_IDS` from the per-sub secrets so `isAzureConfigured()` returns true:
  ```
  AZURE_SUBSCRIPTION_IDS="${{ secrets.AZURE_SUB_GRAILBABE }},${{ secrets.AZURE_SUB_SHARED_INFRA }}"
  ```
- Do NOT require a separate standalone `AZURE_SUBSCRIPTION_IDS` secret from the user — build it from the existing per-app sub secrets.
- `azureNetwork.ts` also has a defense-in-depth guard: builds the sub list first and only bails when the assembled list is empty (removing the `isAzureConfigured()` gate inside that function). This handles edge cases but the workflow change is the primary fix.

## Subscription topology (as confirmed)

| Env var | Subscription contains |
|---|---|
| `AZURE_SUB_SHARED_INFRA` | Front Door, Orbit/Kinisis Network Watcher, VNet, Load Balancer, Container Apps env |
| `AZURE_SUB_GRAILBABE` | GrailBabe Network Watcher, Load Balancer, SWA, VNet |

`AZURE_SUBSCRIPTION_IDS` is NOT a separate secret — it is synthesised in the workflow from the two per-sub vars above.
